// @vitest-environment node
/**
 * [ZC-CQ-*] — CẤP QUYỀN NGAY LÚC MỞ MÀN ZaloCRM (NỢ-9, phương án 1).
 * Tầng DB THẬT + `fetch` giả. Đối tượng đo: `capQuyenKhiMoMan`.
 *
 * ── VÌ SAO CÓ ĐƯỜNG NÀY ────────────────────────────────────────────────────────────
 * Tài khoản bên fork chỉ sinh ra ở LẦN SSO ĐẦU TIÊN, mà `capQuyenNickZalocrm` (cron
 * 5 phút) bỏ qua `externalId` fork chưa biết. Nên ai đăng nhập lần đầu SAU lượt cron
 * gần nhất mở hộp thư ra **RỖNG** — không lỗi, không dòng giải thích. Đo 17/09/2026:
 * `uat.giamdoc` vào lúc 16:39, cron gần nhất 10:41 ⇒ 0 nick; chạy cron lại ⇒ 2 nick.
 * Trên `test` cron không chạy theo lịch (NỢ-5) nên "chờ 5 phút" thành chờ mãi mãi.
 *
 * ── HAI RÀNG BUỘC CỨNG CỦA CHỦ DỰ ÁN, MỖI CÁI MỘT LƯỚI ─────────────────────────────
 *
 * ① FAIL-SAFE — `[ZC-CQ-01a…d]`. *"Fork chết, chậm, hay trả lỗi thì màn vẫn mở. Cấp
 *   quyền không được là điều kiện để vào hộp thư."* Trang `await` hàm này, nên "an
 *   toàn" ở đây có nghĩa rất cụ thể và ĐO ĐƯỢC: **không bao giờ ném, không bao giờ
 *   treo**. Bốn ca đo bốn kiểu hỏng khác nhau, vì bịt một kiểu không bịt ba kiểu kia.
 *
 * ② MỘT ĐƯỜNG CHÍNH SÁCH — `[ZC-CQ-02]`. *"Dùng ĐÚNG chính sách mà capQuyenNickZalocrm
 *   dùng, không viết đường thứ hai. PUT …/access thay cả tập — hai đường tính khác nhau
 *   là chúng gỡ quyền của nhau mỗi 5 phút."*
 *
 * 🔴 VÌ SAO LƯỚI ② PHẢI LÀ LƯỚI HÀNH VI, KHÔNG PHẢI LƯỚI GHIM MÃ NGUỒN.
 * Bản đầu của thiết kế định ghim bằng regex "có gọi `nguoiDuocDungNick(` không". Chủ dự
 * án bác đúng chỗ: *"lưới phải đỏ cả khi ai đó giữ nguyên lời gọi nhưng lọc lại kết quả
 * của nó trước khi gửi đi — đó cũng là một đường chính sách thứ hai, chỉ khó thấy hơn."*
 * Một `.filter(...)` chen vào giữa lời gọi và thân yêu cầu thì regex nào cũng vẫn xanh.
 * Nên lưới này chặn `fetch` và so **THÂN YÊU CẦU THẬT** với `nguoiDuocDungNick`.
 *
 * ⚠️ VÀ NÓ PHẢI CÓ HAI VẾ, nếu không là tautology: so thân yêu cầu với chính hàm chính
 * sách chỉ chứng minh "một đường", KHÔNG chứng minh đường ấy đúng — làm hỏng
 * `nguoiDuocDungNick` thì cả hai vế sai bằng nhau và lưới vẫn xanh. Vế thứ hai neo
 * `nguoiDuocDungNick` vào tập người ĐÃ DỰNG, với đủ bốn kiểu người KHÔNG đủ điều kiện.
 *
 * ⚠️ Bộ này TỰ SKIP khi không có Postgres local. Thấy SKIP nghĩa là CHƯA KIỂM ĐƯỢC GÌ,
 * không phải "xanh". KHÔNG `resetDb()` — dọn theo TIỀN TỐ riêng (`tests/inbox` chạy
 * tuần tự chung một DB với các file khác).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";

// ── Van "Redis chết" cho ca [ZC-CQ-01c] ──────────────────────────────────────────────
// `vi.hoisted` chứ không phải `let` trần: `vi.mock` được nâng lên TRÊN mọi import, nên
// một biến khai bằng `let` ở thân tệp vẫn nằm trong TDZ lúc nhà máy mock chạy.
const van = vi.hoisted(() => ({ tietCheNem: false }));

vi.mock("@/lib/rate-limit", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("@/lib/rate-limit")>();
  return {
    ...goc,
    // Chỉ `rateLimit` bị thay; `getRateLimitBackend` giữ nguyên bản thật vì
    // [ZC-CQ-03] đo đúng dòng nhật ký nó sinh ra.
    rateLimit: (args: Parameters<typeof goc.rateLimit>[0]) =>
      van.tietCheNem ? Promise.reject(new Error("Upstash chết")) : goc.rateLimit(args),
  };
});

const RUN = RUN_DB_TESTS;
if (!RUN) console.warn(`[zalocrm-cap-quyen] SKIP: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();

/** Bảng nick chưa có ⇒ SKIP kèm câu chỉ việc, đừng đổ một đống `P2021`. */
const CO_BANG =
  RUN &&
  (await db.zaloCrmNick
    .count()
    .then(() => true)
    .catch(() => {
      console.warn(
        "[zalocrm-cap-quyen] SKIP: chưa có bảng ZaloCrmNick. Chạy `prisma migrate deploy` " +
          "trên DB test trước (migration zalocrm_bang_nick_thread).",
      );
      return false;
    }));

/** Tiền tố RIÊNG — dùng lại `ZCRM_`/`ZCNA_` là ba tệp dọn dữ liệu của nhau. */
const P = "ZCCQ_";
const ORG = `${P}org1`;
const MA_CS = `${P}cs1`;
const MA_CS_KHAC = `${P}cs2`;
const KHOA_API = "khoa-test-cq";

// ── Gá `fetch` ───────────────────────────────────────────────────────────────────────

type LuotGoi = { url: string; method?: string; than: unknown };
let luot: LuotGoi[] = [];

const traOk = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => data }) as unknown as Response;

const traLoiHttp = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

/** Treo cho tới khi `goiZalocrm` tự huỷ (trần 10s của nó) — mô phỏng tunnel đứt. */
const treoChoToiKhiHuy = (init: RequestInit) =>
  new Promise<Response>((_, tuChoi) => {
    init.signal?.addEventListener("abort", () => {
      const e = new Error("The operation was aborted.");
      e.name = "AbortError";
      tuChoi(e);
    });
  });

function gaFetch(xuLy: (url: string, init: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", (url: unknown, init: RequestInit = {}) => {
    luot.push({
      url: String(url),
      method: init.method,
      than: init.body == null ? undefined : JSON.parse(String(init.body)),
    });
    return xuLy(String(url), init);
  });
}

/** Thân `PUT …/access` của một lượt — nơi tập người được cấp quyền thật sự đi qua. */
function thanAccess(): { access?: unknown }[] {
  return luot
    .filter((l) => l.method === "PUT" && l.url.includes("/access"))
    .map((l) => l.than as { access?: unknown });
}

/**
 * `externalId` trong một thân yêu cầu.
 *
 * 24/09/2026 thân đổi từ `{ externalIds: string[] }` sang
 * `{ access: [{ externalId, permission }] }` (mỗi người một mức). Bóc ở MỘT chỗ để đổi
 * dạng lần sau chỉ sửa một hàm — và để ca dưới còn đọc được.
 */
function idTrongThan(t: { access?: unknown }): string[] {
  const a = t.access;
  if (!Array.isArray(a)) return [];
  return a.map((x) => (x as { externalId?: unknown }).externalId as string);
}

// ── Dựng dữ liệu ─────────────────────────────────────────────────────────────────────

type NguoiDung = { id: string; nhan: string };
const duDieuKien: NguoiDung[] = [];
const khongDuDieuKien: NguoiDung[] = [];

async function purge() {
  const dv = await db.orgUnit.findMany({
    where: { code: { startsWith: P } },
    select: { id: true },
  });
  if (dv.length) {
    await db.userOrgRole.deleteMany({ where: { orgUnitId: { in: dv.map((d) => d.id) } } });
  }
  await db.user.deleteMany({ where: { name: { startsWith: P } } });
  await db.orgUnit.deleteMany({ where: { code: { startsWith: P } } });
  await db.zaloCrmNick.deleteMany({ where: { orgCode: { startsWith: P } } });
  await db.integrationLog.deleteMany({ where: { provider: { contains: P } } });
}

beforeAll(async () => {
  if (!CO_BANG) return;
  await purge();

  // `OrgUnit.code` khớp `Center.code` — cầu nối chuẩn của repo (`lib/org/center-bridge.ts`).
  const cs = await db.orgUnit.create({
    data: { code: MA_CS, name: `${P}CS1`, type: "CENTER" },
  });
  const csKhac = await db.orgUnit.create({
    data: { code: MA_CS_KHAC, name: `${P}CS2`, type: "CENTER" },
  });

  // `RoleDef.code` là @unique TOÀN CỤC và DB test thường đã seed sẵn ⇒ upsert, và
  // KHÔNG xoá ở `purge` (không phải của bộ này).
  const vai = async (code: string) =>
    db.roleDef.upsert({ where: { code }, update: {}, create: { code, name: code } });
  const vSale2 = await vai("CENTER_SALES_CSM"); // v2
  const vSale1 = await vai("SALES_CSM"); // v1
  const vQl = await vai("CENTER_MANAGER");
  const vGv = await vai("TEACHER"); // KHÔNG nằm trong VAI_DUOC_CAP_NICK

  const nguoi = async (nhan: string, them: { isActive?: boolean } = {}) => {
    const u = await db.user.create({
      data: { name: `${P}${nhan}`, isActive: them.isActive ?? true },
    });
    return { id: u.id, nhan };
  };
  const gan = async (
    u: NguoiDung,
    roleId: string,
    orgUnitId: string,
    them: { effectiveTo?: Date; status?: "ACTIVE" | "EXPIRED" } = {},
  ) =>
    db.userOrgRole.create({
      data: {
        userId: u.id,
        orgUnitId,
        roleId,
        grantedById: u.id,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: them.effectiveTo ?? null,
        status: them.status ?? "ACTIVE",
      },
    });

  // ── ĐỦ ĐIỀU KIỆN: BA người, BA mã vai KHÁC NHAU ────────────────────────────────
  // Ba chứ không phải một là có chủ đích. Mọi bộ lọc chen thêm mà người ta hay viết
  // ("chỉ tư vấn viên", "lấy người đầu", "bỏ quản lý") đều làm SỐ LƯỢNG đổi ⇒
  // [ZC-CQ-02] đỏ. Một người thì `.filter(x => x.role === 'sale')` vẫn xanh.
  const saleA = await nguoi("sale-a");
  await gan(saleA, vSale2.id, cs.id);
  const saleB = await nguoi("sale-b");
  await gan(saleB, vSale1.id, cs.id);
  const ql = await nguoi("qlcs");
  await gan(ql, vQl.id, cs.id);
  duDieuKien.push(saleA, saleB, ql);

  // ── KHÔNG ĐỦ ĐIỀU KIỆN: bốn LÝ DO khác nhau ────────────────────────────────────
  // Đây là vế chống NỚI: ai đó đổi `nguoiDuocDungNick` thành "mọi người của đơn vị"
  // thì tập gửi đi phình ra và lưới đỏ. Cũng là vế làm ca ② không thành tautology.
  const gvien = await nguoi("giao-vien");
  await gan(gvien, vGv.id, cs.id); // vai ngoài chính sách
  const nghiViec = await nguoi("nghi-viec", { isActive: false });
  await gan(nghiViec, vSale2.id, cs.id); // tài khoản đã khoá — dòng vai VẪN CÒN
  const hetNhiemKy = await nguoi("het-nhiem-ky");
  await gan(hetNhiemKy, vSale2.id, cs.id, { effectiveTo: new Date("2026-03-01T00:00:00.000Z") });
  const coSoKhac = await nguoi("co-so-khac");
  await gan(coSoKhac, vSale2.id, csKhac.id); // đúng vai, SAI cơ sở
  khongDuDieuKien.push(gvien, nghiViec, hetNhiemKy, coSoKhac);

  // Hai nick: chứng minh CÙNG MỘT tập đi tới MỌI nick của org, không phải mỗi nick một tập.
  await db.zaloCrmNick.createMany({
    data: [
      { zcrmAccountId: `${P}acc-1`, orgCode: ORG, displayName: "Nick 1" },
      { zcrmAccountId: `${P}acc-2`, orgCode: ORG, displayName: "Nick 2" },
    ],
  });

  vi.stubEnv("ZALOCRM_BASE_URL", "https://zalocrm.test.invalid");
  vi.stubEnv("ZALOCRM_API_KEYS", JSON.stringify({ [ORG]: KHOA_API }));
}, 60_000);

afterAll(async () => {
  if (CO_BANG) await purge();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await db.$disconnect();
});

beforeEach(() => {
  luot = [];
  van.tietCheNem = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Khoá tiết chế là `zalocrm:capquyen:<userId>`, cửa sổ MỘT GIỜ, kho là Map trong bộ
 * nhớ của tiến trình ⇒ dùng lại một `userId` giữa hai ca là ca sau bị chặn oan. Mỗi ca
 * lấy một người mới.
 */
let dem = 0;
const nguoiMoi = () => `${P}u-${Date.now()}-${dem++}`;

describe.skipIf(!CO_BANG)("[ZC-CQ] cấp quyền khi mở màn ZaloCRM", () => {
  // ══════════════════════════════════════════════════════════════════════════════════
  // ① FAIL-SAFE — bốn kiểu hỏng, bốn ca
  // ══════════════════════════════════════════════════════════════════════════════════
  describe("[ZC-CQ-01] FAIL-SAFE — cấp quyền KHÔNG được là điều kiện để vào hộp thư", () => {
    it("[ZC-CQ-01a] fork trả lỗi HTTP ⇒ trả về `loi`, KHÔNG ném", async () => {
      const { capQuyenKhiMoMan } = await import("@/lib/integrations/zalocrm/cap-quyen-nick");
      gaFetch(async () => traLoiHttp(500));

      // `resolves` chứ không `try/catch`: câu cần khoá là "hàm này không ném", và một
      // `try/catch` trong test sẽ nuốt mất đúng thứ đang phải chứng minh.
      await expect(
        capQuyenKhiMoMan({ userId: nguoiMoi(), centerCode: MA_CS, orgCode: ORG }),
        "fork trả 500 mà hàm ném ⇒ trang /zalo-crm sập theo",
      ).resolves.toBe("loi");
    });

    it("[ZC-CQ-01b] fork TREO ⇒ bỏ cuộc theo trần, không giữ lượt tải trang", async () => {
      const { capQuyenKhiMoMan } = await import("@/lib/integrations/zalocrm/cap-quyen-nick");
      gaFetch((_u, init) => treoChoToiKhiHuy(init));

      const t0 = Date.now();
      const kq = await capQuyenKhiMoMan({ userId: nguoiMoi(), centerCode: MA_CS, orgCode: ORG });
      const troi = Date.now() - t0;

      expect(kq).toBe("qua-han");
      // 🔴 NGƯỠNG LÀ 5s CÓ LÝ DO: trần riêng của `goiZalocrm` là 10s
      // (`ZALOCRM_TIMEOUT_MS`), nên một khẳng định lỏng kiểu "< 30s" vẫn XANH ngay cả
      // khi gỡ hết `Promise.race` — tức là không đo gì. 5s nằm GIỮA hai trần: chỉ xanh
      // khi trần mở màn 1,5s thật sự có tác dụng.
      expect(troi, `chờ ${troi}ms — trần mở màn không có tác dụng`).toBeLessThan(5_000);
    }, 30_000);

    it("[ZC-CQ-01c] tiết chế HỎNG (Redis chết) ⇒ vẫn cấp quyền, không chặn", async () => {
      const { capQuyenKhiMoMan } = await import("@/lib/integrations/zalocrm/cap-quyen-nick");
      gaFetch(async () => traOk({ granted: 1, revoked: 0, unknown: 0 }));
      van.tietCheNem = true;

      const kq = await capQuyenKhiMoMan({ userId: nguoiMoi(), centerCode: MA_CS, orgCode: ORG });

      // Mất tiết chế KHÔNG gây sai lệch — vì ràng buộc ②, tập gửi đi luôn giống hệt nên
      // chạy 1 lần hay 50 lần đều ra một trạng thái. Nó chỉ tốn lượt gọi mạng. Biến nó
      // thành cổng chặn là đổi một phiền toái lấy một màn hình trống.
      expect(kq, "tiết chế hỏng mà thành cổng chặn là đi ngược ràng buộc FAIL-SAFE").toBe(
        "da-cap",
      );
      expect(thanAccess().length, "phải VẪN gọi fork khi tiết chế hỏng").toBeGreaterThan(0);
    });

    it("[ZC-CQ-01d] chạm tiết chế ⇒ KHÔNG gọi fork lượt thứ hai", async () => {
      const { capQuyenKhiMoMan } = await import("@/lib/integrations/zalocrm/cap-quyen-nick");
      gaFetch(async () => traOk({ granted: 1, revoked: 0, unknown: 0 }));

      const u = nguoiMoi();
      const mot = await capQuyenKhiMoMan({ userId: u, centerCode: MA_CS, orgCode: ORG });
      const soSauLuot1 = thanAccess().length;
      const hai = await capQuyenKhiMoMan({ userId: u, centerCode: MA_CS, orgCode: ORG });

      expect(mot).toBe("da-cap");
      expect(hai, "lượt thứ hai trong cùng giờ phải bị tiết chế").toBe("bo-qua-tiet-che");
      expect(
        thanAccess().length,
        "tiết chế phải chặn TRƯỚC lời gọi mạng, không phải sau",
      ).toBe(soSauLuot1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════
  // ② MỘT ĐƯỜNG CHÍNH SÁCH DUY NHẤT
  // ══════════════════════════════════════════════════════════════════════════════════
  it("[ZC-CQ-02] thân `PUT …/access` = ĐÚNG `nguoiDuocDungNick`, không lọc thêm bớt", async () => {
    const { capQuyenKhiMoMan, nguoiDuocDungNick } = await import(
      "@/lib/integrations/zalocrm/cap-quyen-nick"
    );
    gaFetch(async () => traOk({ granted: 1, revoked: 0, unknown: 0 }));

    await capQuyenKhiMoMan({ userId: nguoiMoi(), centerCode: MA_CS, orgCode: ORG });

    const than = thanAccess();
    expect(than.length, "hai nick ⇒ hai lượt PUT …/access").toBe(2);

    // ── VẾ 1: "một đường" — thân yêu cầu THẬT khớp hàm chính sách, cả tập lẫn SỐ LƯỢNG.
    // Đây là vế bắt được kiểu "giữ nguyên lời gọi nhưng lọc lại kết quả": một
    // `.filter(...)` chen vào giữa làm số lượng tụt và ca này đỏ, trong khi mọi lưới
    // ghim mã nguồn vẫn xanh vì lời gọi còn nguyên đó.
    // 24/09/2026: `nguoiDuocDungNick` nay trả `{ tatCa, quanLy }`. Ca này đo nhánh
    // nick CHƯA GIAO (fixture không đặt `sataUserId`), nên đúng danh sách `tatCa` —
    // nhánh nick ĐÃ GIAO có lưới riêng `[PVN-02]` + `[ZC-CQ-11]`.
    // 24/09 (lượt sau): `nguoiDuocDungNick` trả BA tập. Nick này CHƯA giao ai, nên tập
    // đi sang fork là `macDinh` (vai được dùng nick mặc định), KHÔNG phải `tatCa` (mọi
    // nhân sự của cơ sở — tập GIAO TAY, rộng hơn). Lấy nhầm `tatCa` ở đây là ca này
    // XANH trong khi hệ thống vừa cấp quyền cho cả giáo viên — xem [ZC-CQ-02d].
    const chinhSach = (await nguoiDuocDungNick(MA_CS)).macDinh;
    for (const [i, t] of than.entries()) {
      expect(Array.isArray(t.access), `lượt ${i}: thân phải có mảng access`).toBe(true);
      const g = idTrongThan(t);
      expect(
        g.length,
        `lượt ${i}: gửi ${g.length} người, chính sách tính ${chinhSach.length} — ` +
          "có một đường thứ hai đang lọc/nối thêm",
      ).toBe(chinhSach.length);
      expect([...g].sort()).toEqual([...chinhSach].sort());

      // Mức phải là MỘT TRONG BA giá trị ZaloCRM hiểu. Gửi chuỗi lạ thì bên kia rơi về
      // `read` và người ta MẤT quyền gửi tin — hỏng câm, triệu chứng là "gõ xong không
      // gửi được" chứ không phải một dòng lỗi.
      for (const x of t.access as { externalId: string; permission: unknown }[]) {
        expect(
          ["read", "chat", "admin"],
          `lượt ${i}: mức lạ cho ${x.externalId}: ${String(x.permission)}`,
        ).toContain(x.permission);
      }
    }

    // ── VẾ 2: NEO CHÍNH SÁCH. Thiếu vế này thì vế 1 là tautology: làm hỏng
    // `nguoiDuocDungNick` thì cả hai bên sai bằng nhau và lưới vẫn xanh.
    expect([...chinhSach].sort(), "tập người đủ điều kiện của cơ sở").toEqual(
      duDieuKien.map((n) => n.id).sort(),
    );
    for (const n of khongDuDieuKien) {
      expect(chinhSach, `"${n.nhan}" KHÔNG được có quyền dùng nick`).not.toContain(n.id);
    }
  });

  it("[ZC-CQ-02d] GIAO TAY ĐƯỢC ≠ MẶC ĐỊNH DÙNG ĐƯỢC — giáo viên nằm đúng một bên", () => {
    // 🔴 Cả điểm của lượt 24/09 (sau), đo trên Postgres thật.
    // Chủ dự án chốt: thêm tay được MỌI nhân sự của cơ sở, nhưng quyền MẶC ĐỊNH trên
    // nick chưa giao thì giữ nguyên tập hẹp. Hai tập lẫn vào nhau là một lượt nới quyền
    // im lặng — mọi giáo viên, kế toán của cơ sở đọc được mọi nick chưa giao.
    const gvien = khongDuDieuKien.find((n) => n.nhan === "giao-vien")!;
    return import("@/lib/integrations/zalocrm/cap-quyen-nick").then(
      async ({ nguoiDuocDungNick }) => {
        const { tatCa, macDinh } = await nguoiDuocDungNick(MA_CS);
        expect(tatCa, "giáo viên của cơ sở phải THÊM TAY được").toContain(gvien.id);
        expect(macDinh, "nhưng KHÔNG tự có quyền trên nick chưa giao").not.toContain(gvien.id);

        // ĐỐI CHỨNG DƯƠNG — ba lý do loại kia vẫn loại khỏi CẢ HAI tập, không phải chỉ
        // rơi khỏi tập hẹp. Thiếu vế này thì "nới tatCa ra mọi người" cũng xanh.
        for (const nhan of ["nghi-viec", "het-nhiem-ky", "co-so-khac"]) {
          const n = khongDuDieuKien.find((x) => x.nhan === nhan)!;
          expect(tatCa, `"${nhan}" lọt vào tập giao tay`).not.toContain(n.id);
          expect(macDinh, `"${nhan}" lọt vào tập mặc định`).not.toContain(n.id);
        }
      },
    );
  });

  it("[ZC-CQ-02b] gọi ĐÚNG endpoint thay-cả-tập, theo đúng nick của org", async () => {
    const { capQuyenKhiMoMan } = await import("@/lib/integrations/zalocrm/cap-quyen-nick");
    gaFetch(async () => traOk({ granted: 1, revoked: 0, unknown: 0 }));

    await capQuyenKhiMoMan({ userId: nguoiMoi(), centerCode: MA_CS, orgCode: ORG });

    // `PUT …/access` THAY CẢ TẬP. Đổi sang một đường "thêm một người" (POST, hay PUT
    // vào endpoint khác) là bỏ mất vế GỠ — vế không ai nhớ làm tay và hỏng thì không
    // có triệu chứng: người đã nghỉ vẫn đọc được chat của khách.
    const duong = luot.map((l) => `${l.method} ${new URL(l.url).pathname}`).sort();
    expect(duong).toEqual([
      `PUT /api/public/zalo-accounts/${P}acc-1/access`,
      `PUT /api/public/zalo-accounts/${P}acc-2/access`,
    ]);
  });

  it("[ZC-CQ-02c] thân mang CẢ HAI dạng, và hai dạng cùng một tập người", async () => {
    // 🔴 VÌ SAO: ZaloCRM chạy trong container riêng, Sata trên Vercel — hai bên KHÔNG
    // lên cùng lúc. Bản ZaloCRM cũ chỉ đọc `externalIds`, gặp thân chỉ có `access[]`
    // thì trả 400 và KHÔNG cấp/gỡ cho AI, 288 lượt/ngày, cho tới khi ai đó nhớ khởi
    // động lại container. Gửi cả hai là mua lấy quyền triển khai theo thứ tự bất kỳ.
    //
    // Vế thứ hai mới là vế cắn: hai mảng LỆCH NHAU nghĩa là hai bản ZaloCRM cấp cho hai
    // tập người khác nhau — và không ai biết bản nào đang chạy ở đầu kia.
    const { capQuyenKhiMoMan } = await import("@/lib/integrations/zalocrm/cap-quyen-nick");
    gaFetch(async () => traOk({ granted: 1, revoked: 0, unknown: 0 }));

    await capQuyenKhiMoMan({ userId: nguoiMoi(), centerCode: MA_CS, orgCode: ORG });

    const than = thanAccess() as { access?: unknown; externalIds?: unknown }[];
    expect(than.length).toBeGreaterThan(0);
    for (const [i, t] of than.entries()) {
      expect(Array.isArray(t.access), `lượt ${i}: thiếu access[] (bản ZaloCRM mới)`).toBe(true);
      expect(
        Array.isArray(t.externalIds),
        `lượt ${i}: thiếu externalIds[] — bản ZaloCRM cũ sẽ trả 400`,
      ).toBe(true);
      expect([...idTrongThan(t)].sort(), `lượt ${i}: hai dạng lệch tập người`).toEqual(
        [...(t.externalIds as string[])].sort(),
      );
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════
  // ③ NHẬT KÝ NỀN TIẾT CHẾ — một lần mỗi tiến trình
  // ══════════════════════════════════════════════════════════════════════════════════
  it("[ZC-CQ-03] ghi nền tiết chế MỘT LẦN mỗi tiến trình, không mỗi lượt", async () => {
    // Bộ đếm "đã ghi" là biến cấp module nên các ca trên đã làm nó bẩn — nạp lại module
    // để đo từ trạng thái khởi động nguội, đúng thứ Vercel thấy.
    vi.resetModules();
    const { capQuyenKhiMoMan } = await import("@/lib/integrations/zalocrm/cap-quyen-nick");
    gaFetch(async () => traOk({ granted: 1, revoked: 0, unknown: 0 }));

    const doi = vi.spyOn(console, "info").mockImplementation(() => {});
    const goi: unknown[][] = [];
    try {
      await capQuyenKhiMoMan({ userId: nguoiMoi(), centerCode: MA_CS, orgCode: ORG });
      await capQuyenKhiMoMan({ userId: nguoiMoi(), centerCode: MA_CS, orgCode: ORG });
      // ⚠️ PHẢI CHỤP TRƯỚC `mockRestore()`: nó gọi `mockReset` nên `doi.mock.calls` bị
      // XOÁ SẠCH. Đọc sau khi khôi phục thì ca này luôn thấy 0 dòng — tức luôn ĐỎ với
      // mã đúng, và nếu ngưỡng viết ngược lại (`toBe(0)`) thì luôn XANH với mã sai.
      goi.push(...doi.mock.calls.map((c) => [...c]));
    } finally {
      doi.mockRestore();
    }

    // 288 lượt cron/ngày × số instance là cách nhanh nhất khiến người vận hành ngừng
    // đọc nhật ký, rồi bỏ lỡ dòng thật.
    const dong = goi.filter((c) => String(c[0]).includes("tiết chế cấp quyền"));
    expect(dong.length, `ghi ${dong.length} dòng cho 2 lượt — phải đúng 1`).toBe(1);
    expect(String(dong[0]?.[0]), "phải nêu nền đang dùng: upstash hay memory").toMatch(
      /nền (upstash|memory)/,
    );
  });
});
