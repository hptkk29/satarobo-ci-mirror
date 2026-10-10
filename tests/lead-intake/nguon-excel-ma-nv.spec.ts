// @vitest-environment node
/**
 * Cột TUỲ CHỌN "Mã NV giới thiệu" của HAI đường Excel — chạy ĐÚNG HANDLER THẬT trên Postgres LOCAL:
 *
 *   D  `POST /api/admin/import/leads`            (file sự kiện — không có cột ngày)
 *   E  `POST /api/admin/import/leads/registered` (file đăng ký — CÓ cột "Ngày")
 *
 *   [EMNV-D1]  nhãn Nguồn TRỐNG + mã đúng ⇒ nhóm nhân sự giới thiệu, đúng NGƯỜI, đủ ảnh chụp (vai + dấu vết)
 *   [EMNV-D2]  nhãn thuộc nhóm kiểu EMPLOYEE ('Quản Lý Trung Tâm') + mã ⇒ cũng ghi người (đối chứng dương của D3)
 *   [EMNV-D3]  nhãn 'Ads' + mã ⇒ KHÔNG ÉP NGUỒN: vẫn PAID_ADS, referrerEmployeeId NULL, có cảnh báo
 *   [EMNV-D4]  ô chứa TÊN đầy đủ của nhân viên (không phải mã) ⇒ KHÔNG khớp theo tên
 *   [EMNV-D5]  mã không có / nhân sự đã nghỉ ⇒ lead vẫn tạo, KHÔNG ghi người, có cảnh báo
 *   [EMNV-D6]  ô mã TRỐNG ở mọi dòng ⇒ y hệt hành vi cũ (không cảnh báo nào)
 *   [EMNV-D7]  cờ quản lý nguồn TẮT ⇒ 0 attribution + MỘT dòng cảnh báo cho cả file
 *   [EMNV-D8]  nhiều dòng cùng SĐT: cùng mã ⇒ người đó; mã KHÁC nhau ⇒ không lấy mã nào
 *   [EMNV-D9]  SĐT ĐÃ CÓ lead ⇒ first-claim: attribution KHÔNG đổi + cảnh báo "không áp dụng"
 *   [EMNV-D10] hai nhân viên cùng một mã sau chuẩn hoá ⇒ mơ hồ, không ghi người
 *   [EMNV-D11] nhập 10 dòng, 3 mã sai ⇒ tạo 10, `errors` RỖNG, đúng 3 `warnings` (cảnh báo KHÔNG phải lỗi)
 *   [EMNV-D12] cột Sale phụ trách gõ sai ⇒ lead vẫn tạo, nằm ở `warnings` chứ không ở `errors`
 *   [EMNV-D13] dòng sale sai + cơ sở ngoài phạm vi ⇒ 1 Lỗi 0 Cảnh báo; dòng hợp lệ + sale sai ⇒ 0 Lỗi 1 Cảnh báo (cảnh báo chỉ đi theo dòng ĐƯỢC GHI)
 *   [EMNV-D14] gộp chéo cơ sở bị từ chối + ô mã NV có chữ ⇒ 1 Lỗi, KHÔNG cảnh báo "không áp dụng"
 *   [EMNV-D15] dòng bị chặn nguồn + mã NV sai + sale sai ⇒ 1 Lỗi 0 Cảnh báo; dòng ổn cạnh đó vẫn giữ cảnh báo
 *   [EMNV-E1]  đường E: nhãn mặc định 'Import Excel ĐK' + mã ⇒ ghi người; cột Sales KHÔNG bị nhầm với cột mã
 *   [EMNV-E2]  đường E: nhãn 'Ads' + mã ⇒ PAID_ADS, dry-run báo `maNvGioiThieuBoQua`
 *   [EMNV-E3]  đường E: mã giải theo NGÀY TRÊN PHIẾU (mã đã đổi) — ngày trước đợt đổi ra người cũ; không có ngày ⇒ hôm nay ⇒ mã cũ hết hiệu lực
 *   [EMNV-E4b] đường E: Sale CS1 — phụ huynh gắn CS2 (ngoài phạm vi) và SĐT đang thuộc lead CS2 (trùng cơ sở khác) cũng bị TRỪ khỏi số sẽ ghi
 *   [EMNV-E5]  đường E: khối "Đối chứng" (tổng đã thu) + "Nghi một học viên bị tách" CHỈ tính phụ huynh SẼ GHI (dòng bị chặn nguồn không lọt vào)
 *   [EMNV-E6]  đường E: thẻ "không đổi (đã import trước đó)" KHÔNG đếm SĐT bị từ chối vì thuộc cơ sở khác
 *   [EMNV-E4]  đường E: số xem thử TRỪ phụ huynh/học viên của dòng bị chặn nguồn (`phuHuynhSeGhi` / `hocVienSeGhi`); `phuHuynh` / `hocVien` vẫn là số TRONG FILE
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `EMNV` và danh sách SĐT cố định của bộ này. LUẬT 18: mỗi ca tự dựng hiện trường.
 * ⚠️ LUẬT 19: ngày TUYỆT ĐỐI trong fixture. Không dùng người nhập làm người giới thiệu (cổng chống tự nhận có thể đổi hành vi ca đó).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({
  ...(await orig<typeof import("next/cache")>()),
  revalidatePath: () => {},
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.9.9.8" }),
}));
vi.mock("@/lib/tracking", () => ({ sendMetaCapi: async () => {}, sendGa4Event: async () => {} }));

import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { POST as importPost } from "../../app/api/admin/import/leads/route";
import { POST as registeredPost } from "../../app/api/admin/import/leads/registered/route";
import { LEAD_IMPORT_CENTER_HEADER, LEAD_IMPORT_SALE_HEADER } from "../../lib/lead/import";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon, datEpChonNguonCoSo } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "EMNV_";
const CASE = 90_000;

const SDT = {
  d1: "0904000001",
  d2: "0904000002",
  d3: "0904000003",
  d4: "0904000004",
  d5: "0904000005",
  d5b: "0904000006",
  d6: "0904000007",
  d6b: "0904000013",
  d7: "0904000008",
  d7b: "0904000014",
  d8a: "0904000009",
  d8b: "0904000010",
  d9: "0904000011",
  d10: "0904000012",
  e1: "0904000021",
  e2: "0904000022",
  e3a: "0904000023",
  e3b: "0904000024",
} as const;
/** Mười SĐT cho [EMNV-D11] (nhập 10 dòng, 3 mã sai). */
const SDT_D11 = ["0904000031", "0904000032", "0904000033", "0904000034", "0904000035", "0904000036", "0904000037", "0904000038", "0904000039", "0904000040"] as const;
const SDT_D12 = "0904000041";
const SDT_D13 = { ngoai: "0904000061", ok: "0904000062", trung: "0904000063", chan: "0904000064", ok2: "0904000065" } as const;
const SDT_E4 = { chan: "0904000051", ok: "0904000052", ngoai: "0904000053", trung: "0904000054" } as const;
const TAT_CA_SDT = [...Object.values(SDT), ...SDT_D11, SDT_D12, ...Object.values(SDT_D13), ...Object.values(SDT_E4)];
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

type Err = { row: number; error: string };
/** Phản hồi của đường D: `errors` = dòng KHÔNG vào được; `warnings` = dòng ĐÃ vào nhưng cần xem. */
type KqD = { success: number; errors: Err[]; warnings?: Err[] };
/** Cảnh báo về mã NV — đọc ở KÊNH `warnings`. Cảnh báo lẫn vào `errors` thì màn hình đếm nó là "Lỗi / KHÔNG được ghi" (10/10/2026). */
const canhBaoMa = (kq: KqD) => (kq.warnings ?? []).filter((e) => e.error.includes("Mã NV giới thiệu"));
/** Dòng nói về mã NV mà LẠC vào `errors` — luôn phải rỗng. */
const maNvLacVaoLoi = (kq: KqD) => kq.errors.filter((e) => e.error.includes("Mã NV giới thiệu"));

async function don(): Promise<void> {
  const leads = await db.lead.findMany({
    where: { OR: [{ parentName: { startsWith: P } }, { phone: { in: TAT_CA_SDT.flatMap(bienThe) } }] },
    select: { id: true },
  });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } }); // FK Cascade kéo quy nguồn + touchpoint
  }
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  await db.leadRotationTurn.deleteMany({ where: { userId: { in: uids } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.auditLog.deleteMany({ where: { actorName: P } });
  // Có cả mã dạng đảo đoạn "NV.EMNV.…" (ca mơ hồ D10) — không bắt đầu bằng EMNV nên phải dọn riêng.
  await db.employee.deleteMany({ where: { OR: [{ employeeCode: { startsWith: "EMNV" } }, { employeeCode: { startsWith: "NV.EMNV" } }] } });
  await db.center.deleteMany({ where: { code: "EMNV1" } });
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
  // "Ép chọn nguồn" của cơ sở nằm ở `centerSetting`, KHÔNG phải `systemSetting`: ca nào bật nó (D15 · E4 · E5) mà dừng giữa chừng thì cơ sở CS1 vẫn bị ép cho MỌI ca sau (luật 18).
  await db.centerSetting.deleteMany({ where: { key: "nguon.epChonNguon" } });
}

async function dungNguoiNhap() {
  const email = `${P}admin@example.test`;
  const u = await db.user.create({
    data: { name: `${P}ADMIN`, email, role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"], centerId: null, isActive: true },
    select: { id: true },
  });
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "HO" }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" }, select: { id: true } });
  // `effectiveFrom` lùi 1 giờ: đồng hồ DB có thể đi TRƯỚC `Date.now()` của Node (xem nguon-noi-day-duong.spec.ts).
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou.id, roleId: role.id, grantedById: "emnv", effectiveFrom: new Date(Date.now() - 3_600_000) } });
  SESS.current = { user: { id: u.id, role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"], centerId: null, name: `${P}ADMIN`, email } };
}

/** Nhân viên giới thiệu (KHÔNG phải người nhập): có tài khoản + vai Sale ở CS1 để ảnh chụp có vai SALE. */
async function dungNhanVien(maCode: string, o: { fullName?: string; status?: "ACTIVE" | "RESIGNED" } = {}) {
  const centerId = (await db.center.findUniqueOrThrow({ where: { code: "EMNV1" }, select: { id: true } })).id;
  const emp = await db.employee.create({
    data: {
      employeeCode: maCode,
      fullName: o.fullName ?? `${P}Nhân viên ${maCode}`,
      jobTitle: "Tư vấn",
      department: "TUYEN_SINH",
      centerId,
      isActive: (o.status ?? "ACTIVE") === "ACTIVE",
      status: o.status ?? "ACTIVE",
    },
    select: { id: true },
  });
  const user = await db.user.create({
    data: { name: `${P}NV ${maCode}`, email: `${P}${maCode.toLowerCase()}@example.test`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId, employeeId: emp.id, isActive: true },
    select: { id: true },
  });
  const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_SALES_CSM" }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId: user.id, orgUnitId: cs1.id, roleId: role.id, grantedById: "emnv", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  return { employeeId: emp.id, code: maCode };
}

const jsonReq = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const dong = (phone: string, o: { nguon?: string; ma?: string; ten?: string } = {}) => ({
  "Tên phụ huynh": o.ten ?? `${P}Excel`,
  SĐT: phone,
  ...(o.nguon !== undefined ? { Nguồn: o.nguon } : {}),
  ...(o.ma !== undefined ? { "Mã NV giới thiệu": o.ma } : {}),
});

const goiD = async (rows: unknown[]) => (await (await importPost(jsonReq("/api/admin/import/leads", { rows }))).json()) as KqD;

const theoSdt = (s: string) => db.lead.findFirst({ where: { phone: { in: bienThe(s) }, deletedAt: null }, select: { id: true, source: true } });
const attr = async (s: string) => {
  const l = await theoSdt(s);
  if (!l) return null;
  return db.leadAttribution.findUnique({ where: { leadId: l.id }, include: { group: { select: { code: true } } } });
};

// ── File ĐĂNG KÝ ──
type DongDK = { ten: string; sdt: string; nguon?: string; ma?: string; ngay?: string; sale?: string; coSo?: string; hocPhi?: number };
function fileDangKy(rows: DongDK[], o: { cotMa?: boolean; cotNgay?: boolean } = {}): File {
  const cotMa = o.cotMa ?? rows.some((r) => r.ma !== undefined);
  const cotNgay = o.cotNgay ?? rows.some((r) => r.ngay !== undefined);
  const coNguon = rows.some((r) => r.nguon !== undefined);
  const coSale = rows.some((r) => r.sale !== undefined);
  const coHocPhi = rows.some((r) => r.hocPhi !== undefined);
  const aoa = [
    ["Họ và Tên học viên", "Số điện thoại", "Cơ sở", "Lớp", ...(coNguon ? ["Nguồn"] : []), ...(cotNgay ? ["Ngày"] : []), ...(coSale ? ["Sales"] : []), ...(cotMa ? ["Mã NV giới thiệu"] : []), ...(coHocPhi ? ["Học phí"] : [])],
    ...rows.map((r) => [
      r.ten,
      r.sdt,
      r.coSo ?? "CS1: Nguyễn Hữu Thọ",
      "Lớp 3",
      ...(coNguon ? [r.nguon ?? ""] : []),
      ...(cotNgay ? [r.ngay ?? ""] : []),
      ...(coSale ? [r.sale ?? ""] : []),
      ...(cotMa ? [r.ma ?? ""] : []),
      ...(coHocPhi ? [r.hocPhi ?? ""] : []),
    ]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Tháng 10");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], "dang-ky.xlsx");
}
const reqE = (f: File, mode: "dry-run" | "confirm") => {
  const fd = new FormData();
  fd.set("file", f);
  fd.set("mode", mode);
  return new NextRequest("http://localhost/api/admin/import/leads/registered", { method: "POST", body: fd });
};
type KqE = { ok: boolean; data: { daTaoLead: number; maNvGioiThieuBoQua: { sdt: string; lyDo: string }[]; maNvGioiThieuTat: boolean } };
const goiE = async (f: File, mode: "dry-run" | "confirm") => (await (await registeredPost(reqE(f, mode))).json()) as KqE;

describe.skipIf(!RUN)("Excel — cột 'Mã NV giới thiệu' (hai đường D/E, handler thật)", () => {
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
  }, 180_000);

  beforeEach(async () => {
    await don();
    await damBaoDanhMucGoc(db);
    await db.center.create({ data: { code: "EMNV1", name: "EMNV 1", slug: "emnv-1", address: "a", city: "" } });
    await datCoNguon(CO_NGUON_DAY_DU);
    await dungNguoiNhap();
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 180_000);

  // ── D ────────────────────────────────────────────────────────────────────────────────────────
  it("[EMNV-D1] nhãn Nguồn TRỐNG + mã đúng (chữ thường) ⇒ nhóm nhân sự giới thiệu, đúng NGƯỜI, đủ ảnh chụp", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    const j = await goiD([dong(SDT.d1, { ma: "emnv.nv.001" })]);
    expect(j.success).toBe(1);
    expect(canhBaoMa(j)).toEqual([]);
    const a = (await attr(SDT.d1))!;
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a.matchedRule).toBe("NV_GIOI_THIEU");
    expect(a.referrerKind).toBe("EMPLOYEE");
    expect(a.referrerEmployeeId).toBe(nv.employeeId);
    expect(a.referrerMissing).toBe(false);
    expect(a.referrerRoleCode).toBe("SALE"); // ảnh chụp vai
    expect((a.signals as { nguoiGioiThieu: { employeeCode: string } }).nguoiGioiThieu.employeeCode).toBe("EMNV.NV.001");
  }, CASE);

  it("[EMNV-D2] nhãn 'Quản Lý Trung Tâm' (nhóm kiểu EMPLOYEE) + mã ⇒ ghi người — đối chứng dương của D3", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    const j = await goiD([dong(SDT.d2, { nguon: "Quản Lý Trung Tâm", ma: "EMNV.NV.001" })]);
    expect(canhBaoMa(j)).toEqual([]);
    const a = (await attr(SDT.d2))!;
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a.referrerEmployeeId).toBe(nv.employeeId);
    expect(a.referrerMissing).toBe(false); // so với KHÔNG có mã: THIEU_NGUOI
  }, CASE);

  it("[EMNV-D3] nhãn 'Ads' + mã ⇒ KHÔNG ÉP NGUỒN: vẫn PAID_ADS, referrerEmployeeId NULL, có cảnh báo", async () => {
    await dungNhanVien("EMNV.NV.001");
    const j = await goiD([dong(SDT.d3, { nguon: "Ads", ma: "EMNV.NV.001" })]);
    expect(j.success).toBe(1); // lead vẫn được tạo
    const w = canhBaoMa(j);
    expect(w).toHaveLength(1);
    expect(w[0]!.error).toMatch(/Ads/);
    expect(maNvLacVaoLoi(j)).toEqual([]); // cảnh báo KHÔNG nằm ở `errors`: dòng đã được tạo
    const a = (await attr(SDT.d3))!;
    expect(a.group.code).toBe("PAID_ADS");
    expect(a.referrerEmployeeId).toBeNull();
    expect(a.referrerKind).toBeNull();
  }, CASE);

  it("[EMNV-D4] ô chứa TÊN đầy đủ của nhân viên (không phải mã) ⇒ KHÔNG khớp theo tên: không ghi người, có cảnh báo", async () => {
    await dungNhanVien("EMNV.NV.001", { fullName: "EMNV Nguyễn Văn Sale" });
    const j = await goiD([dong(SDT.d4, { ma: "EMNV Nguyễn Văn Sale" })]);
    expect(j.success).toBe(1);
    expect(canhBaoMa(j)).toHaveLength(1);
    const a = (await attr(SDT.d4))!;
    expect(a.referrerEmployeeId).toBeNull();
    expect(a.group.code).toBe("UNKNOWN"); // nhãn trống + không người ⇒ như hành vi cũ
  }, CASE);

  it("[EMNV-D5] mã không tồn tại / nhân sự đã nghỉ ⇒ lead vẫn tạo, KHÔNG ghi người, mỗi dòng một cảnh báo", async () => {
    await dungNhanVien("EMNV.NV.002", { status: "RESIGNED" });
    const j = await goiD([dong(SDT.d5, { ma: "EMNV.NV.999" }), dong(SDT.d5b, { ma: "EMNV.NV.002" })]);
    expect(j.success).toBe(2);
    expect(canhBaoMa(j)).toHaveLength(2);
    expect(maNvLacVaoLoi(j)).toEqual([]);
    expect((await attr(SDT.d5))!.referrerEmployeeId).toBeNull();
    expect((await attr(SDT.d5b))!.referrerEmployeeId).toBeNull();
    expect(canhBaoMa(j).map((e) => e.row).sort()).toEqual([2, 3]);
  }, CASE);

  it("[EMNV-D6] ô mã TRỐNG ở mọi dòng ⇒ y hệt hành vi cũ: nhãn 'Ads' ⇒ PAID_ADS, trống ⇒ UNKNOWN, KHÔNG cảnh báo nào về mã", async () => {
    await dungNhanVien("EMNV.NV.001");
    const j = await goiD([dong(SDT.d6, { nguon: "Ads", ma: "   " }), dong(SDT.d6b, { ma: "" })]);
    expect(j.success).toBe(2);
    expect(canhBaoMa(j)).toEqual([]);
    expect((await attr(SDT.d6))!.group.code).toBe("PAID_ADS");
  }, CASE);

  it("[EMNV-D6b] lô TRỘN dòng có mã và dòng trống ⇒ dòng trống KHÔNG bị coi là 'mã rỗng' (không cảnh báo), dòng có mã vẫn ghi người", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    const j = await goiD([dong(SDT.d6, { ma: "EMNV.NV.001" }), dong(SDT.d6b, { ma: "" })]);
    expect(j.success).toBe(2);
    expect(canhBaoMa(j)).toEqual([]);
    expect((await attr(SDT.d6))!.referrerEmployeeId).toBe(nv.employeeId);
    const trong = (await attr(SDT.d6b))!;
    expect(trong.referrerEmployeeId).toBeNull();
    expect(trong.group.code).toBe("UNKNOWN");
  }, CASE);

  it("[EMNV-D7] cờ quản lý nguồn TẮT ⇒ lead vẫn tạo, 0 attribution, ĐÚNG MỘT dòng cảnh báo cho cả file (không im lặng)", async () => {
    await dungNhanVien("EMNV.NV.001");
    await datCoNguon({});
    const j = await goiD([dong(SDT.d7, { ma: "EMNV.NV.001" }), dong(SDT.d7b, { ma: "EMNV.NV.001" })]);
    expect(j.success).toBe(2);
    expect(await attr(SDT.d7)).toBeNull();
    const w = canhBaoMa(j);
    expect(w).toHaveLength(1);
    expect(w[0]!.row).toBe(0);
    expect(w[0]!.error).toMatch(/TẮT/);
    expect(maNvLacVaoLoi(j)).toEqual([]);
  }, CASE);

  it("[EMNV-D8] nhiều dòng cùng SĐT: cùng mã ⇒ người đó; mã KHÁC nhau ⇒ không lấy mã nào (không phụ thuộc thứ tự dòng)", async () => {
    const a1 = await dungNhanVien("EMNV.NV.001");
    await dungNhanVien("EMNV.NV.003");
    const ok = await goiD([dong(SDT.d8a, { ma: "EMNV.NV.001", ten: `${P}Nhà A` }), dong(SDT.d8a, { ma: "emnv.nv.001", ten: `${P}Nhà A` })]);
    expect(canhBaoMa(ok)).toEqual([]);
    expect((await attr(SDT.d8a))!.referrerEmployeeId).toBe(a1.employeeId);

    const xung = await goiD([dong(SDT.d8b, { ma: "EMNV.NV.001", ten: `${P}Nhà B` }), dong(SDT.d8b, { ma: "EMNV.NV.003", ten: `${P}Nhà B` })]);
    const w = canhBaoMa(xung);
    expect(w).toHaveLength(1);
    expect(w[0]!.error).toMatch(/KHÁC NHAU/);
    expect((await attr(SDT.d8b))!.referrerEmployeeId).toBeNull();
  }, CASE);

  it("[EMNV-D9] SĐT ĐÃ CÓ lead ⇒ first-claim: attribution KHÔNG đổi + cảnh báo 'không áp dụng'", async () => {
    await dungNhanVien("EMNV.NV.001");
    await goiD([dong(SDT.d9, { nguon: "Ads" })]); // lead gốc: quảng cáo
    const truoc = (await attr(SDT.d9))!;
    const j = await goiD([dong(SDT.d9, { nguon: "Ads", ma: "EMNV.NV.001" })]);
    const w = canhBaoMa(j);
    expect(w).toHaveLength(1);
    expect(w[0]!.error).toMatch(/không áp dụng/);
    expect(maNvLacVaoLoi(j)).toEqual([]);
    const sau = (await attr(SDT.d9))!;
    expect(sau.groupId).toBe(truoc.groupId);
    expect(sau.referrerEmployeeId).toBeNull();
    expect(sau.attributedAt).toEqual(truoc.attributedAt);
  }, CASE);

  it("[EMNV-D10] hai nhân viên cùng MỘT mã sau chuẩn hoá ('EMNV.NV.002' và 'NV.EMNV.002') ⇒ mơ hồ: không ghi người", async () => {
    await dungNhanVien("EMNV.NV.002");
    await dungNhanVien("NV.EMNV.002");
    const j = await goiD([dong(SDT.d10, { ma: "EMNV.NV.002" })]);
    const w = canhBaoMa(j);
    expect(w).toHaveLength(1);
    expect(w[0]!.error).toMatch(/nhiều nhân viên|mơ hồ/);
    expect((await attr(SDT.d10))!.referrerEmployeeId).toBeNull();
  }, CASE);

  it("[EMNV-D11] nhập 10 dòng, 3 mã sai ⇒ tạo 10, `errors` RỖNG, đúng 3 `warnings` ở dòng 4/7/10 — màn hình không được đếm chúng là lỗi", async () => {
    // Cấy: đẩy lại cảnh báo vào `errors` (như trước 10/10/2026) ⇒ `errors` có 3 mục ⇒ ExcelImporter in "Lỗi 3 · 3 dòng KHÔNG được ghi" dù cả 10 lead đã vào.
    const nv = await dungNhanVien("EMNV.NV.001");
    const rows = SDT_D11.map((s, i) => dong(s, { ma: i === 2 || i === 5 || i === 8 ? "EMNV.NV.999" : "EMNV.NV.001", ten: `${P}Nhà ${i}` }));
    const j = await goiD(rows);
    expect(j.success).toBe(10);
    expect(j.errors).toEqual([]);
    const w = canhBaoMa(j);
    expect(w).toHaveLength(3);
    expect(w.map((e) => e.row).sort((a, b) => a - b)).toEqual([4, 7, 10]);
    expect(await db.lead.count({ where: { phone: { in: SDT_D11.flatMap(bienThe) }, deletedAt: null } })).toBe(10);
    // Đối chứng dương: dòng mã ĐÚNG ghi người; dòng mã sai KHÔNG có người (và vẫn có lead).
    expect((await attr(SDT_D11[0]))!.referrerEmployeeId).toBe(nv.employeeId);
    expect((await attr(SDT_D11[2]))!.referrerEmployeeId).toBeNull();
  }, CASE);

  it("[EMNV-D12] cột Sale phụ trách gõ sai ⇒ lead VẪN tạo; câu cảnh báo nằm ở `warnings`, không phải `errors`", async () => {
    // Cùng lớp lỗi với D11: câu "Không tìm thấy sale…" vốn mang tiền tố ⚠️ trong `errors`.
    const j = await goiD([{ ...dong(SDT_D12), "Sale phụ trách (email hoặc mã NV, để trống)": "khong.ai.ten.nay@example.test" }]);
    expect(j.success).toBe(1);
    expect(j.errors).toEqual([]);
    expect(j.warnings ?? []).toHaveLength(1);
    expect(j.warnings![0]!.error).toMatch(/Không tìm thấy sale/);
    expect(j.warnings![0]!.row).toBe(2);
  }, CASE);

  // ── D: cảnh báo CHỈ đi theo dòng/nhóm CHẮC CHẮN được ghi ──────────────────────────────────────
  // Lỗi (vòng 2, M4): route đẩy cảnh báo (sale sai · mã NV) NGAY lúc đọc dòng, TRƯỚC cổng phạm vi / gộp chéo cơ sở / chặn nguồn ⇒ dòng bị
  // chặn mang cả "Lỗi" lẫn "Cảnh báo", và ExcelImporter in cảnh báo dưới tiêu đề "dòng đã được ghi" cho dòng không được ghi.
  async function dungSaleCs1() {
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const email = `${P}sale.cs1.d@example.test`;
    const u = await db.user.create({ data: { name: `${P}SALE CS1 D`, email, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, isActive: true }, select: { id: true } });
    const ouCs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const vai = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_SALES_CSM" }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ouCs1.id, roleId: vai.id, grantedById: "emnv", effectiveFrom: new Date(Date.now() - 3_600_000) } });
    SESS.current = { user: { id: u.id, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, name: `${P}SALE CS1 D`, email } };
    return cs1.id;
  }
  const SALE_SAI = "khong.ai.ten.nay@example.test";
  const dongCoSale = (phone: string, o: { coSo?: string; ma?: string; nguon?: string } = {}) => ({
    ...dong(phone, { ma: o.ma, nguon: o.nguon }),
    [LEAD_IMPORT_SALE_HEADER]: SALE_SAI,
    ...(o.coSo ? { [LEAD_IMPORT_CENTER_HEADER]: o.coSo } : {}),
  });

  it("[EMNV-D13] dòng sale gõ sai + cơ sở NGOÀI phạm vi ⇒ đúng 1 Lỗi, 0 Cảnh báo (dòng không được ghi thì không mang cảnh báo 'đã ghi'); dòng hợp lệ + sale sai ⇒ 0 Lỗi, 1 Cảnh báo", async () => {
    // Cấy: đẩy `warnings.push` của cột sale về chỗ cũ (trước cổng `passesScope`) ⇒ 2 cảnh báo (dòng 2 lẫn dòng 3).
    await dungSaleCs1();
    const j = await goiD([dongCoSale(SDT_D13.ngoai, { coSo: "CS2" }), dongCoSale(SDT_D13.ok)]);
    expect(j.success).toBe(1);
    expect(j.errors.filter((e) => !e.error.startsWith("ℹ️"))).toHaveLength(1);
    expect(j.errors[0]!.row).toBe(2);
    expect(j.errors[0]!.error).toMatch(/ngoài phạm vi/);
    const w = j.warnings ?? [];
    expect(w).toHaveLength(1); // CHỈ dòng 3 (đối chứng dương: cảnh báo vẫn còn cho dòng được ghi)
    expect(w[0]!.row).toBe(3);
    expect(w[0]!.error).toMatch(/Không tìm thấy sale/);
    expect(await theoSdt(SDT_D13.ngoai)).toBeNull();
    expect(await theoSdt(SDT_D13.ok)).not.toBeNull();
  }, CASE);

  it("[EMNV-D14] SĐT đang thuộc lead CƠ SỞ KHÁC (gộp chéo bị từ chối) + ô mã NV có chữ ⇒ đúng 1 Lỗi, KHÔNG cảnh báo 'Mã NV giới thiệu không áp dụng'; gộp ĐƯỢC phép thì cảnh báo vẫn có (D9)", async () => {
    // Cấy: đẩy cảnh báo 'không áp dụng' về trước cổng `passesScope` của nhánh gộp ⇒ có 1 cảnh báo cho dòng không được ghi.
    const cs2 = await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    await db.lead.create({ data: { parentName: `${P}Lead CS2 D14`, phone: bienThe(SDT_D13.trung)[1]!, centerId: cs2.id, status: "MOI" as never, source: "Website" } });
    await dungSaleCs1();
    const j = await goiD([dongCoSale(SDT_D13.trung, { ma: "EMNV.NV.999" })]);
    expect(j.success).toBe(0);
    expect(j.errors).toHaveLength(1);
    expect(j.errors[0]!.error).toMatch(/cơ sở khác/);
    expect(j.warnings ?? []).toEqual([]);
  }, CASE);

  it("[EMNV-D15] cơ sở ép chọn nguồn + nhãn lạ (dòng bị CHẶN) + mã NV sai + sale sai ⇒ đúng 1 Lỗi, 0 Cảnh báo; thêm dòng ổn ⇒ cảnh báo chỉ của dòng ổn", async () => {
    // Cấy: đẩy cảnh báo mã NV / sale về trước vòng `chanNhap` ⇒ dòng bị chặn mang cảnh báo.
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    await datEpChonNguonCoSo(ou.id, true);
    try {
      await dungSaleCs1();
      const j = await goiD([
        dongCoSale(SDT_D13.chan, { nguon: "Nguồn mới tinh", ma: "EMNV.NV.999" }),
        dongCoSale(SDT_D13.ok2, { nguon: "Ads", ma: "EMNV.NV.999" }),
      ]);
      expect(j.success).toBe(1);
      const loi = j.errors.filter((e) => !e.error.startsWith("ℹ️"));
      expect(loi).toHaveLength(1);
      expect(loi[0]!.row).toBe(2);
      const w = j.warnings ?? [];
      expect(w.filter((e) => e.row === 2)).toEqual([]); // dòng bị chặn: 0 cảnh báo
      expect(w.filter((e) => e.row === 3).length).toBeGreaterThan(0); // đối chứng dương: dòng được ghi vẫn có cảnh báo (sale sai)
      expect(w.some((e) => /Không tìm thấy sale/.test(e.error) && e.row === 3)).toBe(true);
    } finally {
      await datEpChonNguonCoSo(ou.id, null); // trả cơ sở về không-ép dù ca đỏ giữa chừng (luật 18)
    }
  }, CASE);

  // ── E ────────────────────────────────────────────────────────────────────────────────────────
  it("[EMNV-E1] đường E: nhãn mặc định 'Import Excel ĐK' + mã ⇒ ghi người; cột Sales (người chăm) KHÔNG bị nhầm với cột mã", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    const f = fileDangKy([{ ten: `${P}Bé E1`, sdt: SDT.e1, ma: "EMNV.NV.001", sale: "Liên" }]);
    const dry = await goiE(f, "dry-run");
    expect(dry.data.maNvGioiThieuBoQua).toEqual([]);
    const conf = await goiE(f, "confirm");
    expect(conf.data.daTaoLead).toBe(1);
    const a = (await attr(SDT.e1))!;
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a.referrerEmployeeId).toBe(nv.employeeId);
    expect(a.referrerMissing).toBe(false);
  }, CASE);

  it("[EMNV-E2] đường E: nhãn 'Ads' + mã ⇒ PAID_ADS, dry-run báo `maNvGioiThieuBoQua`, không ghi người", async () => {
    await dungNhanVien("EMNV.NV.001");
    const f = fileDangKy([{ ten: `${P}Bé E2`, sdt: SDT.e2, nguon: "Ads", ma: "EMNV.NV.001" }]);
    const dry = await goiE(f, "dry-run");
    expect(dry.data.maNvGioiThieuBoQua.map((r) => r.sdt)).toEqual([bienThe(SDT.e2)[1]]); // route trả SĐT canonical 84…
    expect(dry.data.maNvGioiThieuBoQua[0]!.lyDo).toMatch(/Ads/);
    await goiE(f, "confirm");
    const a = (await attr(SDT.e2))!;
    expect(a.group.code).toBe("PAID_ADS");
    expect(a.referrerEmployeeId).toBeNull();
  }, CASE);

  it("[EMNV-E3] đường E: mã giải theo NGÀY TRÊN PHIẾU — đợt đổi mã 04/09: ngày trước ra người CŨ; không có ngày ⇒ hôm nay ⇒ mã cũ hết hiệu lực", async () => {
    // Hiện nay nhân viên giữ mã 'EMNV.NV.061'; đến 04/09/2026 18:08 giờ VN còn mã 'EMNV.NV.060'.
    const nv = await dungNhanVien("EMNV.NV.061");
    await db.auditLog.create({
      data: {
        actorId: null,
        actorName: P,
        module: "employees",
        entityType: "Employee",
        entityId: nv.employeeId,
        action: "UPDATE",
        oldValues: { employeeCode: "EMNV.NV.060" },
        newValues: { employeeCode: "EMNV.NV.061" },
        changedFields: ["employeeCode"],
        createdAt: new Date("2026-09-04T11:08:30.000Z"),
      },
    });
    // Phiếu ghi 01/09/2026 (TRƯỚC đợt đổi) dùng mã cũ ⇒ đúng người.
    const truoc = fileDangKy([{ ten: `${P}Bé E3a`, sdt: SDT.e3a, ma: "EMNV.NV.060", ngay: "01/09/2026" }]);
    expect((await goiE(truoc, "dry-run")).data.maNvGioiThieuBoQua).toEqual([]);
    await goiE(truoc, "confirm");
    expect((await attr(SDT.e3a))!.referrerEmployeeId).toBe(nv.employeeId);

    // Cùng mã cũ nhưng phiếu ghi 10/09/2026 (SAU đợt đổi): mã 060 không còn là của ai ⇒ cảnh báo, không ghi người.
    const sau = fileDangKy([{ ten: `${P}Bé E3b`, sdt: SDT.e3b, ma: "EMNV.NV.060", ngay: "10/09/2026" }]);
    const dry = await goiE(sau, "dry-run");
    expect(dry.data.maNvGioiThieuBoQua.map((r) => r.sdt)).toEqual([bienThe(SDT.e3b)[1]]);
    await goiE(sau, "confirm");
    expect((await attr(SDT.e3b))!.referrerEmployeeId).toBeNull();
  }, CASE);

  it("[EMNV-E4b] đường E: Sale CS1 nhập file có phụ huynh gắn CS2 (ngoài phạm vi) và SĐT đang thuộc lead CS2 ⇒ cả hai bị TRỪ khỏi số sẽ ghi; chỉ 1 lead được tạo", async () => {
    // Cấy: bỏ `scopeRejected` hoặc `mergeRejected` khỏi `khongDuocGhi` ⇒ màn xem thử vẫn đếm họ là "sẽ ghi".
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const cs2 = await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    const email = `${P}sale.cs1@example.test`;
    const u = await db.user.create({ data: { name: `${P}SALE CS1`, email, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, isActive: true }, select: { id: true } });
    const ouCs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const vai = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_SALES_CSM" }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ouCs1.id, roleId: vai.id, grantedById: "emnv", effectiveFrom: new Date(Date.now() - 3_600_000) } });
    SESS.current = { user: { id: u.id, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, name: `${P}SALE CS1`, email } };
    // SĐT đã nằm ở lead của CS2 ⇒ người CS1 không gộp được.
    await db.lead.create({ data: { parentName: `${P}Lead CS2`, phone: bienThe(SDT_E4.trung)[1]!, centerId: cs2.id, status: "MOI" as never, source: "Website" } });
    const f = fileDangKy([
      { ten: `${P}Bé Ổn`, sdt: SDT_E4.ok },
      { ten: `${P}Bé Ngoài`, sdt: SDT_E4.ngoai, coSo: "CS2: Hoàng Diệu" },
      { ten: `${P}Bé Trùng`, sdt: SDT_E4.trung },
    ]);
    type KqSo = { data: { phuHuynh: number; hocVien: number; phuHuynhSeGhi: number; hocVienSeGhi: number; ngoaiPhamVi: unknown[]; trungCoSoKhac: unknown[]; daTaoLead: number } };
    const dry = (await (await registeredPost(reqE(f, "dry-run"))).json()) as KqSo;
    expect(dry.data.ngoaiPhamVi).toHaveLength(1);
    expect(dry.data.trungCoSoKhac).toHaveLength(1);
    expect(dry.data.phuHuynh).toBe(3);
    expect(dry.data.phuHuynhSeGhi).toBe(1);
    expect(dry.data.hocVienSeGhi).toBe(1);
    const conf = (await (await registeredPost(reqE(f, "confirm"))).json()) as KqSo;
    expect(conf.data.daTaoLead).toBe(1);
  }, CASE);

  it("[EMNV-E5] đường E: tổng đã thu (doiChung) + nghiTrung chỉ tính phụ huynh SẼ GHI — dòng bị chặn nguồn không lọt vào hai khối đó", async () => {
    // Cấy: lặp `parsed.parents` (thay vì `phuHuynhSeGhi`) ở `doiChung` / `nghiTrung` ⇒ "khớp sổ quỹ" tính cả tiền của dòng KHÔNG được ghi.
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    await datEpChonNguonCoSo(ou.id, true);
    try {
      const f = fileDangKy([
        { ten: `${P}Nguyễn Ngọc Quân`, sdt: SDT_E4.chan, nguon: "Nguồn mới tinh", ma: "EMNV.NV.999", hocPhi: 4_000_000 },
        { ten: `${P}Quân`, sdt: SDT_E4.chan, nguon: "Nguồn mới tinh", ma: "EMNV.NV.999", hocPhi: 4_640_000 },
        { ten: `${P}Bé Ổn`, sdt: SDT_E4.ok, nguon: "Ads", hocPhi: 3_000_000 },
      ]);
      type KqDC = { data: { maNvGioiThieuBoQua: { sdt: string }[]; nguonBiChan: unknown[]; doiChung: { daThu: number }; nghiTrung: { sdt: string }[]; phuHuynhSeGhi: number } };
      const dry = (await (await registeredPost(reqE(f, "dry-run"))).json()) as KqDC;
      expect(dry.data.nguonBiChan).toHaveLength(1);
      expect(dry.data.phuHuynhSeGhi).toBe(1);
      expect(dry.data.doiChung.daThu).toBe(3_000_000); // chỉ tiền của phụ huynh SẼ GHI
      expect(dry.data.nghiTrung.some((r) => r.sdt.includes(SDT_E4.chan.slice(1)))).toBe(false);
      expect(dry.data.maNvGioiThieuBoQua.some((r) => r.sdt.includes(SDT_E4.chan.slice(1)))).toBe(false); // dòng bị chặn không mang câu "mã NV không áp dụng"

      // Đối chứng dương: cơ sở KHÔNG ép chọn nguồn ⇒ không ai bị chặn ⇒ tổng đã thu = cả file, và cặp Quân/Ngọc Quân bị nghi tách.
      await datEpChonNguonCoSo(ou.id, null);
      const dry2 = (await (await registeredPost(reqE(f, "dry-run"))).json()) as KqDC;
      expect(dry2.data.nguonBiChan).toHaveLength(0);
      expect(dry2.data.doiChung.daThu).toBe(3_000_000 + 4_000_000 + 4_640_000);
      expect(dry2.data.nghiTrung.some((r) => r.sdt.includes(SDT_E4.chan.slice(1)))).toBe(true);
      expect(dry2.data.maNvGioiThieuBoQua.some((r) => r.sdt.includes(SDT_E4.chan.slice(1)))).toBe(true);
    } finally {
      await datEpChonNguonCoSo(ou.id, null); // luật 18: không để cơ sở bị ép sang ca sau dù ca này đỏ giữa chừng
    }
  }, CASE);

  it("[EMNV-E6] đường E: file chỉ có SĐT thuộc lead cơ sở khác ⇒ `khongDoi` = 0 (không đếm phụ huynh bị TỪ CHỐI là 'đã import trước đó')", async () => {
    // Cấy: `khongDoi: plan.merges.length - …` (đếm cả `mergeRejected`) ⇒ thẻ in "1 không đổi (đã import trước đó)" cạnh "1 phụ huynh KHÔNG được tạo".
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const cs2 = await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    const email = `${P}sale.cs1.e6@example.test`;
    const u = await db.user.create({ data: { name: `${P}SALE CS1 E6`, email, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, isActive: true }, select: { id: true } });
    const ouCs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const vai = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_SALES_CSM" }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ouCs1.id, roleId: vai.id, grantedById: "emnv", effectiveFrom: new Date(Date.now() - 3_600_000) } });
    SESS.current = { user: { id: u.id, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, name: `${P}SALE CS1 E6`, email } };
    await db.lead.create({ data: { parentName: `${P}Lead CS2 E6`, phone: bienThe(SDT_E4.trung)[1]!, centerId: cs2.id, status: "MOI" as never, source: "Website" } });
    const f = fileDangKy([{ ten: `${P}Bé Trùng`, sdt: SDT_E4.trung }]);
    type KqKD = { data: { trungCoSoKhac: unknown[]; khongDoi: number; daGopLead: number; daTaoLead: number } };
    const conf = (await (await registeredPost(reqE(f, "confirm"))).json()) as KqKD;
    expect(conf.data.trungCoSoKhac).toHaveLength(1);
    expect(conf.data.daTaoLead).toBe(0);
    expect(conf.data.daGopLead).toBe(0);
    expect(conf.data.khongDoi).toBe(0);
  }, CASE);

  it("[EMNV-E4] đường E: file 2 phụ huynh / 3 học viên, 1 phụ huynh (2 con) bị chặn nguồn ⇒ `phuHuynh`=2 `hocVien`=3 (trong file) nhưng `phuHuynhSeGhi`=1 `hocVienSeGhi`=1; confirm tạo đúng 1 lead", async () => {
    // Cấy: tính `*SeGhi` bằng tổng chứ không trừ dòng bị chặn ⇒ màn xem thử đếm 2 phụ huynh / 3 học viên mà chỉ 1 / 1 được tạo.
    const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    await datEpChonNguonCoSo(ou.id, true);
    const f = fileDangKy([
      { ten: `${P}Bé Chặn 1`, sdt: SDT_E4.chan, nguon: "Nguồn mới tinh" },
      { ten: `${P}Bé Chặn 2`, sdt: SDT_E4.chan, nguon: "Nguồn mới tinh" },
      { ten: `${P}Bé Ổn`, sdt: SDT_E4.ok, nguon: "Ads" },
    ]);
    type KqSo = { data: { phuHuynh: number; hocVien: number; phuHuynhSeGhi: number; hocVienSeGhi: number; nguonBiChan: { sdt: string; nhan: string; lyDo: string }[]; canKiemTra: { sdt: string }[]; daTaoLead: number; daTaoHocVien: number } };
    const dry = (await (await registeredPost(reqE(f, "dry-run"))).json()) as KqSo;
    expect(dry.data.nguonBiChan).toHaveLength(1);
    expect(dry.data.nguonBiChan[0]!.nhan).toBe("Nguồn mới tinh");
    expect(dry.data.nguonBiChan[0]!.lyDo.length).toBeGreaterThan(0);
    expect(dry.data.phuHuynh).toBe(2);
    expect(dry.data.hocVien).toBe(3);
    expect(dry.data.phuHuynhSeGhi).toBe(1);
    expect(dry.data.hocVienSeGhi).toBe(1);
    // "Cần kiểm tra" chỉ gồm phụ huynh SẼ GHI: hỏi người nhập quyết học phí cho dòng sẽ không tạo là việc vô ích. (Đối chứng dương: dòng của phụ huynh ổn có mặt.)
    expect(dry.data.canKiemTra.some((w) => w.sdt.includes(SDT_E4.ok.slice(1)))).toBe(true);
    expect(dry.data.canKiemTra.some((w) => w.sdt.includes(SDT_E4.chan.slice(1)))).toBe(false);
    const conf = (await (await registeredPost(reqE(f, "confirm"))).json()) as KqSo;
    expect(conf.data.daTaoLead).toBe(conf.data.phuHuynhSeGhi); // số "sẽ ghi" nói thật: đúng bằng số lead tạo ra
    expect(conf.data.daTaoHocVien).toBe(conf.data.hocVienSeGhi);

    // Đối chứng dương: cơ sở KHÔNG ép chọn nguồn ⇒ không dòng nào bị chặn ⇒ số "sẽ ghi" = số trong file.
    await datEpChonNguonCoSo(ou.id, null);
    const f2 = fileDangKy([{ ten: `${P}Bé Chặn 1`, sdt: SDT_E4.chan, nguon: "Nguồn mới tinh" }, { ten: `${P}Bé Ổn`, sdt: SDT_E4.ok, nguon: "Ads" }]);
    await db.lead.deleteMany({ where: { phone: { in: [SDT_E4.chan, SDT_E4.ok].flatMap(bienThe) } } });
    const dry2 = (await (await registeredPost(reqE(f2, "dry-run"))).json()) as KqSo;
    expect(dry2.data.nguonBiChan).toHaveLength(0);
    expect(dry2.data.phuHuynhSeGhi).toBe(dry2.data.phuHuynh);
    expect(dry2.data.hocVienSeGhi).toBe(dry2.data.hocVien);
  }, CASE);
});
