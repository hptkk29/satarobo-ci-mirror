// tests/finance/pos-sai-ma-quyen.test.ts — VIỆC 3: QUYỀN GỬI / DUYỆT YÊU CẦU "NHẬP SAI MÃ" QUA ĐỘNG CƠ THẬT. Postgres THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
//
// VÌ SAO CÓ TỆP NÀY. Ba lớp kiểm quyền khác của Việc 3 đều ĐỨNG NGOÀI động cơ thật:
//   · `khai-bao-sai-ma.test.ts` [HN3-PERM-*] đọc `ROLE_SEED` trong mã (thuần) — đúng nguồn của `seed-prod-roles`, nhưng không đi qua DB;
//   · `_pos-sai-ma-actions.test.ts` (hai tệp) MOCK `checkPermission` — chứng minh hành động HỎI đúng khoá và đóng kín khi bị từ chối;
//   · `pos-hai-nut-sai-ma.test.ts` dựng `Actor` bằng tay (`actorCoSo`) cho ca cách ly cơ sở.
// Không lớp nào chạy `resolveActorUncached` (JOIN `UserOrgRole → RoleDef → RolePermission` + bộ lọc hiệu lực) rồi `evaluatePermission` —
// hàm quyết định mà `checkPermission` gọi ở production, với `RBAC_V2_ENABLED=true` (PROD) VÀ `false` (mặc định ở local / CI).
// Tệp này lấp đúng chỗ đó: RoleDef/RolePermission nằm trong DB đã seed bằng `seedRoles()` (cùng `prisma/seed-roles.ts` mà workflow
// `seed-prod-roles` chạy), `UserOrgRole` gán thật, người dùng thật. Mô hình: `tests/nen/position-permission.spec.ts`.
//
// ⚠️ GIỚI HẠN — nói thẳng: bộ này KHÔNG chạy `checkPermission` (nó cần phiên next-auth) và KHÔNG chạy bảng `PermissionGrant` (trống ở PROD
// lần đo gần nhất, và `resolveGrant` đứng TRƯỚC đường này ở production). Nó chạy phần còn lại: tải actor thật + quyết định theo cờ.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveActorUncached, type Actor } from "@/lib/auth/actor";
import { evaluatePermission } from "@/lib/auth/permission-eval";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

if (!RUN_DB_TESTS) console.warn(`[HN3-RBAC-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "ci-pos3q-";
const HOOK_TIMEOUT = 180_000;

type Khoa = "payments:pos-check" | "payments:manage" | "payments:record";
type Nguoi = "sale" | "qlcs" | "ktCoSo" | "ktHo" | "gv";

/** Năm người, mỗi người MỘT vai thật gán ở MỘT đơn vị thật. `role` là enum cũ — thứ mà v1 (matrix tĩnh) đọc. */
const NGUOI: Record<Nguoi, { email: string; role: Role; vai: string; donVi: "HO" | "CS1" }> = {
  sale: { email: `${P}sale@ci.test`, role: "SALES_CSM", vai: "CENTER_SALES_CSM", donVi: "CS1" },
  qlcs: { email: `${P}qlcs@ci.test`, role: "CENTER_MANAGER", vai: "CENTER_MANAGER", donVi: "CS1" },
  ktCoSo: { email: `${P}ktcs@ci.test`, role: "ACCOUNTANT", vai: "CENTER_ACCOUNTANT", donVi: "CS1" },
  ktHo: { email: `${P}ktho@ci.test`, role: "ACCOUNTANT", vai: "HO_ACCOUNTANT", donVi: "HO" },
  gv: { email: `${P}gv@ci.test`, role: "TEACHER", vai: "TEACHER", donVi: "CS1" },
};
const DS: Nguoi[] = ["sale", "qlcs", "ktCoSo", "ktHo", "gv"];

const id = {} as Record<Nguoi, string>;
const actor = {} as Record<Nguoi, Actor>;
let centerCS1 = "";

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = us.map((u) => u.id);
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

/** Hàm quyết định production cho một người × một khoá, theo cờ RBAC_V2. Cùng lõi mà `decidePermissionWithGrant` rơi về khi bảng grant không khớp. */
function quyet(n: Nguoi, khoa: Khoa, flagOn: boolean): boolean {
  return evaluatePermission({
    sessionUser: { role: NGUOI[n].role, roles: [NGUOI[n].role] },
    actor: actor[n],
    action: khoa,
    flagOn,
  });
}
/** Bảng {người → được/không} cho một khoá — để `toEqual` in ra CẢ bảng khi sai, không phải từng ô. */
function bang(khoa: Khoa, flagOn: boolean): Record<Nguoi, boolean> {
  return Object.fromEntries(DS.map((n) => [n, quyet(n, khoa, flagOn)])) as Record<Nguoi, boolean>;
}

describe.skipIf(!RUN_DB_TESTS)("[HN3-RBAC] quyền của Việc 3 qua actor THẬT (RoleDef trong DB) — v2 (PROD) và v1 (mặc định local/CI)", () => {
  beforeAll(async () => {
    assertTestDb();
    await don();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const donVi = Object.fromEntries(
      await Promise.all(
        (["HO", "CS1"] as const).map(async (code) => [code, (await db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true } })).id] as const),
      ),
    );
    centerCS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    for (const n of DS) {
      const u = await seedUser({ email: NGUOI[n].email, name: `${P}${n}`, role: NGUOI[n].role });
      id[n] = u.id;
      const vai = await db.roleDef.findUniqueOrThrow({ where: { code: NGUOI[n].vai }, select: { id: true } });
      // `effectiveFrom` TUYỆT ĐỐI (luật 19). Default của cột là `now()` của POSTGRES; `resolveActorUncached` lọc `effectiveFrom <= new Date()` của NODE. Trên
      // Windows đồng hồ Node thô hơn đồng hồ Postgres (cỡ 15 ms) nên resolve ngay sau khi gán có thể thấy vai "chưa có hiệu lực" ⇒ mọi quyền ra false.
      // Bộ chạy cấy lỗi bắt được đúng điều này: lượt baseline KHÔNG cấy gì vẫn đỏ `RBAC-00/01/03/05` một lần.
      await db.userOrgRole.create({
        data: { userId: u.id, orgUnitId: donVi[NGUOI[n].donVi]!, roleId: vai.id, status: "ACTIVE", grantedById: u.id, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
      });
      actor[n] = await resolveActorUncached(u.id);
    }
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await don();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  it("[HN3-RBAC-00] fixture: mỗi người nhận ĐÚNG vai đã gán (không có vai nào khác lọt vào) — nếu hỏng, mọi ca dưới nói về một người khác", () => {
    for (const n of DS) {
      expect(actor[n].userId).toBe(id[n]);
      expect([...new Set(actor[n].orgRoles.map((r) => r.roleCode))], n).toEqual([NGUOI[n].vai]);
    }
  });

  it("[HN3-RBAC-01] v2 (PROD): GỬI = payments:pos-check · DUYỆT = payments:manage — bảng năm người × hai khoá", () => {
    expect(bang("payments:pos-check", true)).toEqual({ sale: true, qlcs: true, ktCoSo: false, ktHo: true, gv: false });
    expect(bang("payments:manage", true)).toEqual({ sale: false, qlcs: false, ktCoSo: true, ktHo: true, gv: false });
  });

  it("[HN3-RBAC-02] v1 (mặc định local / CI): cùng hai khoá — matrix tĩnh, KHÔNG phân biệt kế toán cơ sở với kế toán HO", () => {
    expect(bang("payments:pos-check", false)).toEqual({ sale: true, qlcs: true, ktCoSo: true, ktHo: true, gv: false });
    expect(bang("payments:manage", false)).toEqual({ sale: false, qlcs: false, ktCoSo: true, ktHo: true, gv: false });
  });

  it("[HN3-RBAC-03] ĐỐI CHỨNG DƯƠNG của cờ: hai chế độ lệch nhau ĐÚNG một ô đã biết (kế toán cơ sở × pos-check) — bộ này không thể xanh nhờ bỏ qua cờ", () => {
    const lech: string[] = [];
    for (const khoa of ["payments:pos-check", "payments:manage"] as const) {
      for (const n of DS) if (quyet(n, khoa, true) !== quyet(n, khoa, false)) lech.push(`${n}×${khoa}`);
    }
    expect(lech).toEqual(["ktCoSo×payments:pos-check"]);
    // Hệ quả vận hành: ở v1 kế toán cơ sở GỬI được yêu cầu — vô hại, vì DUYỆT vẫn đòi người khác (`chanTuDuyet` + CHECK của DB).
  });

  it("[HN3-RBAC-04] SALE KHÔNG BAO GIỜ duyệt, ở CẢ HAI chế độ — mà sale GIỮ payments:record (lý do không dùng record để duyệt)", () => {
    for (const flagOn of [true, false]) {
      expect(quyet("sale", "payments:manage", flagOn), `sale × manage (flagOn=${flagOn})`).toBe(false);
      expect(quyet("sale", "payments:record", flagOn), `sale × record (flagOn=${flagOn})`).toBe(true);
      expect(quyet("sale", "payments:pos-check", flagOn), `sale × pos-check (flagOn=${flagOn})`).toBe(true);
      // Đối chứng dương cho vế "không duyệt": kế toán cơ sở DUYỆT được cùng điều kiện.
      expect(quyet("ktCoSo", "payments:manage", flagOn), `ktCoSo × manage (flagOn=${flagOn})`).toBe(true);
    }
  });

  it("[HN3-RBAC-05] phạm vi THẬT khớp hình dạng `actorCoSo` mà ca cách ly dựng tay: người cơ sở chỉ thấy CS1; kế toán HO cấp Hội sở", () => {
    for (const n of ["sale", "qlcs", "ktCoSo"] as const) {
      expect(actor[n].isHoLevel, `${n} không cấp Hội sở`).toBe(false);
      expect(actor[n].visibleCenterIds, `${n} chỉ thấy cơ sở của mình`).toEqual([centerCS1]);
    }
    expect(actor.ktHo.isHoLevel, "kế toán HO cấp Hội sở").toBe(true);
    // Quyền của kế toán cơ sở mang `centerScope` = đúng một cơ sở (không "ALL") — nền của `getModelVisibleCenterIds` cho tiền tố 'payments:'.
    const manage = actor.ktCoSo.permissions.find((p) => p.action === "payments:manage");
    expect(manage?.centerScope).toEqual([centerCS1]);
    const posCheck = actor.sale.permissions.find((p) => p.action === "payments:pos-check");
    expect(posCheck?.centerScope).toEqual([centerCS1]);
    // Đối chứng dương: ở Hội sở thì "ALL".
    expect(actor.ktHo.permissions.find((p) => p.action === "payments:manage")?.centerScope).toBe("ALL");
  });
});
