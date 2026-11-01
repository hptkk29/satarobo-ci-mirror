/**
 * A0-00 — Seed & reset helpers cho test (Postgres LOCAL).
 *
 * AN TOÀN: mọi hàm ghi/xóa đều qua `assertTestDb()` — chặn chạy nhầm trên
 * Supabase prod/dev. resetDb() CHỈ chạy khi DATABASE_URL trỏ localhost.
 *
 * Phụ thuộc model:
 * - resetDb / seedUser: dùng được NGAY (model User hiện có).
 * - seedOrg / seedRoles: CHỜ A0-01 (OrgUnit) / A0-02 (RoleDef, UserOrgRole) —
 *   ném lỗi rõ ràng cho tới khi bảng tồn tại, để spec phụ thuộc tự fail/skip.
 */
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { db } from "../../../lib/db";
import { laDbCucBo, laTenDbTest, loiTunnelVps } from "../../../lib/security/url-db-cuc-bo";
import { CENTERS, seedOrgUnits } from "../../../prisma/seed-orgunit";
import { seedRoles as seedRoleDefs } from "../../../prisma/seed-roles";
import { TEST_PASSWORD } from "./fixtures";

/** Chặn thao tác phá hủy nếu DATABASE_URL không trỏ DB test local. */
export function assertTestDb(): void {
  const url = process.env.DATABASE_URL ?? "";

  // 28/09/2026 — CHẶN TUNNEL VPS TRƯỚC MỌI VẾ KHÁC.
  //
  // DB prod/test nay trên VPS, tới được qua SSH tunnel 127.0.0.1:<cổng tunnel PROD> (PROD) / :<cổng tunnel TEST> (TEST của
  // test.satarobo.vn — tên ĐÚNG LÀ `satarobo_test`). Hai vế dưới hỏi "host 127.0.0.1" và "tên
  // satarobo_test" ⇒ tunnel qua trọn cả hai ⇒ Playwright `resetDb()` xoá sạch dữ liệu thật.
  // Ngoài Vitest không có cờ nào đứng thêm phía trước: đây là lớp DUY NHẤT. Nhận diện ở
  // `lib/security/url-db-cuc-bo.ts` — đừng chép biểu thức. `[ATD-TUN-*]` ghim.
  const tunnel = loiTunnelVps(url);
  if (tunnel) throw new Error(`[test] ${tunnel}`);

  const isLocal = laDbCucBo(url);
  const looksTest = laTenDbTest(url);

  // 30/08/2026 — CHẶN CỨNG THEO TÊN DB, không chỉ theo host.
  //
  // Vì sao thêm: `resetDb()` TRUNCATE sạch mọi bảng, và vế `isLocal` ở trên cho qua
  // MỌI database trên máy — kể cả cái mà dev server đang phục vụ. Đã xảy ra thật: chạy
  // bộ test trong lúc chủ dự án đang xem localhost là xoá trắng 16 tài khoản UAT ngay
  // dưới chân họ, và triệu chứng ném ra lại là "sai mật khẩu" chứ không phải "mất dữ
  // liệu" — mất công dò.
  //
  // Nay: chỉ đúng `satarobo_test` / `ci_test` mới cho reset. DB của localhost
  // (`satarobo_local`) và mọi tên khác bị TỪ CHỐI, dù nằm trên 127.0.0.1.
  if (isLocal && !looksTest) {
    const ten = url.split("/").pop()?.split("?")[0] ?? "<không đọc được>";
    throw new Error(
      `[test] TỪ CHỐI xoá dữ liệu: DATABASE_URL trỏ database "${ten}", không phải ` +
        `"satarobo_test". Bộ test chỉ được reset DB test riêng của nó — DB của dev ` +
        `server (satarobo_local) không bao giờ được đụng tới.`,
    );
  }

  if (!isLocal && !looksTest) {
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return "<unparseable>";
      }
    })();
    throw new Error(
      `[A0 test] Từ chối thao tác DB: DATABASE_URL không trỏ DB test local (host=${host}). ` +
        `Nạp .env.test (localhost) trước khi chạy. Xem .claude/rules/prisma-db.md.`,
    );
  }
}

/**
 * Xóa sạch toàn bộ bảng public (trừ `_prisma_migrations`) — RESTART IDENTITY CASCADE.
 * Tên bảng lấy từ pg catalog (không phải input người dùng) → an toàn dùng executeRawUnsafe.
 */
export async function resetDb(): Promise<void> {
  assertTestDb();
  // CỔNG THỨ HAI (04/09/2026) — địa chỉ ĐÚNG vẫn chưa đủ, phải đúng LÚC.
  //
  // `assertTestDb()` chỉ hỏi "URL có trỏ localhost / satarobo_test không" — mà DB làm
  // việc hằng ngày ở máy dev ĐÚNG LÀ `127.0.0.1/satarobo_test`. Hệ quả: `pnpm test:unit`
  // (gồm cả tests/chat, tests/nen, tests/lead-intake…) xoá sạch dữ liệu đang xem — 250
  // học viên, 100 lớp, 609 buổi, 12 tài khoản `uat.*` bay hết, đăng nhập báo "sai tài
  // khoản mật khẩu". Đã xảy ra thật.
  //
  // Chốt của chủ dự án: `pnpm test` KHÔNG được gọi resetDb, không được truncate.
  // Xoá DB nay phải là lựa chọn có chủ đích: `pnpm test:chat-db` / `test:nen-db` /
  // `test:lead-intake` / `test:elearning-db` / `test:inbox-db` (qua `vitest.db.config.ts`).
  // CHẶN ĐÚNG CHỖ: chỉ khi chạy dưới VITEST. Playwright E2E là bộ gá dùng-rồi-bỏ,
  // mọi spec của nó đều mở đầu bằng resetDb() và CI dựng Postgres riêng cho nó —
  // chặn ở đó là giết 7 job E2E mà không cứu thêm được gì (đo ở PR #220: 7 job đỏ
  // vì chính dòng này). Thứ cần chặn là `pnpm test:unit`, và đó là Vitest.
  const duoiVitest = process.env.VITEST === "true";
  if (duoiVitest && process.env.ALLOW_DB_RESET !== "1") {
    throw new Error(
      "[resetDb] Từ chối TRUNCATE: thiếu ALLOW_DB_RESET=1. " +
        "Chạy `pnpm test:chat-db` (hoặc test:nen-db / test:lead-intake / test:elearning-db) " +
        "thay vì `pnpm test:unit`. Xem tests/_helpers/db-gate.ts.",
    );
  }
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export type SeedUserInput = {
  email: string;
  /** Mặc định TEST_PASSWORD. */
  password?: string;
  name?: string;
  /** Vai trò chính. */
  role: Role;
  /** Union vai trò (mặc định [role]). */
  roles?: Role[];
  centerId?: string | null;
  isActive?: boolean;
  /**
   * AUTH-SĐT P3 — SĐT canonical `84XXXXXXXXX`. Không truyền → tự suy từ email
   * (deterministic nên upsert idempotent, 90 call-site cũ không phải sửa).
   * Truyền `null` → user KHÔNG có phone.
   */
  phone?: string | null;
};

/** SĐT test `849########` suy deterministic từ email — cùng email luôn cùng số. */
function phoneFromEmail(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return `849${String(h % 100_000_000).padStart(8, "0")}`;
}

/**
 * Tạo user test với password đã hash. Idempotent theo email (upsert).
 * Trả về { id, email } để loginAs dùng lại.
 *
 * NOTE (A0-02): gán user × orgUnit × role qua `UserOrgRole` sẽ thêm sau khi
 * bảng tồn tại; hiện chỉ set `role`/`roles[]`/`centerId` theo model User hiện hành.
 */
export async function seedUser(
  input: SeedUserInput,
): Promise<{ id: string; email: string; phone: string | null }> {
  assertTestDb();
  const password = await bcrypt.hash(input.password ?? TEST_PASSWORD, 10);
  const roles = input.roles && input.roles.length > 0 ? input.roles : [input.role];
  const phone = input.phone === undefined ? phoneFromEmail(input.email) : input.phone;
  const user = await db.user.upsert({
    where: { email: input.email },
    update: {
      role: input.role,
      roles,
      centerId: input.centerId ?? null,
      isActive: input.isActive ?? true,
      deletedAt: null,
      password,
      phone,
    },
    create: {
      email: input.email,
      name: input.name ?? input.email,
      role: input.role,
      roles,
      centerId: input.centerId ?? null,
      isActive: input.isActive ?? true,
      password,
      phone,
    },
    select: { id: true, email: true, phone: true },
  });
  return { id: user.id, email: user.email ?? input.email, phone: user.phone };
}

/** Đóng kết nối Prisma (gọi ở cuối spec/global-teardown nếu cần). */
export async function disconnectDb(): Promise<void> {
  await db.$disconnect();
}

/**
 * Seed cây OrgUnit: xương sống HO/DANANG + các cơ sở yêu cầu, idempotent.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ DỰNG `Center` TRƯỚC — đây là bản vá một lỗi PHỤ THUỘC THỨ TỰ, không phải tiện tay
 * [23/09/2026].
 *
 * `seedOrgUnits` **TRA** `Center` theo mã để gán `OrgUnit.centerId`; nó KHÔNG tạo dòng
 * `Center` nào (và đúng là không nên — trên prod danh mục cơ sở do người vận hành giữ).
 * Đường seed thật tôn trọng thứ tự đó: `prisma/seed.ts` dựng `Center` ở mục đầu rồi mới gọi
 * `seedOrgUnits`. Nhưng helper này thì KHÔNG, nên trên một database TRẮNG:
 *
 *     seedOrg(["HO","CS1","CS2"])  →  OrgUnit CS1/CS2 có centerId = **null**
 *     ⇒ `buildActor` ra `visibleCenterIds: []`
 *     ⇒ `[AC2]` của TS-08 và 2 ca của TS-11 ĐỎ
 *
 * Và nó **xanh trên CI** vì `test:nen-db` chạy SAU `test:chat-db` trong cùng job, mà bộ chat
 * có dựng `Center` — tức bộ này mượn trạng thái của bộ khác. Đúng lớp lỗi luật 18: một bộ
 * chỉ xanh nhờ thứ tự hiện tại sẽ nổ vào ngày ai đó tách job, đổi thứ tự, hay chạy riêng nó
 * để gỡ một lỗi khác — và lúc ấy triệu chứng (`visibleCenterIds` rỗng) chỉ thẳng vào mã
 * phân quyền chứ không chỉ vào fixture.
 *
 * `code` là khoá duy nhất của `Center`, `slug` cũng `@unique` nên đặt theo `code` viết
 * thường. Dữ liệu lấy từ CHÍNH `CENTERS` của `seed-orgunit` — không chép danh sách thứ hai.
 */
export async function seedOrg(codes: string[]): Promise<void> {
  assertTestDb();

  const muon = new Set(codes.map((c) => c.toUpperCase()));
  const coSo = CENTERS.filter((u) => muon.has(u.code) && u.centerCode);
  for (const u of coSo) {
    const ma = u.centerCode!;
    await db.center.upsert({
      where: { code: ma },
      update: {},
      create: {
        code: ma,
        name: u.name,
        slug: ma.toLowerCase(),
        address: u.address ?? "—",
        isActive: true,
      },
    });
  }

  await seedOrgUnits(db, codes);

  // Cổng FAIL-LOUD. Không có nó thì một lần lệch mã giữa `Center.code` và `UnitSpec.
  // centerCode` lại cho ra fixture hỏng ÂM THẦM, và ta quay về đúng chỗ vừa thoát ra:
  // triệu chứng hiện ở tầng phân quyền, nguyên nhân nằm ở tầng seed.
  const thieu = await db.orgUnit.findMany({
    where: { code: { in: coSo.map((u) => u.code) }, centerId: null },
    select: { code: true },
  });
  if (thieu.length > 0) {
    throw new Error(
      `[seedOrg] OrgUnit ${thieu.map((u) => u.code).join(", ")} không gắn được Center — ` +
        "fixture hỏng, `visibleCenterIds` sẽ rỗng. Kiểm `centerCode` trong prisma/seed-orgunit.ts.",
    );
  }
}

/** Seed 14 RoleDef + RolePermission mẫu (Doc 15 §2.3), idempotent + nguyên tử. (A0-02) */
export async function seedRoles(): Promise<void> {
  assertTestDb();
  await seedRoleDefs(db);
}
