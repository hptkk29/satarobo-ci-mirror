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
 *   [EMNV-D4]  ô chứa TÊN đầy đủ của nhân viên (không phải mã) ⇒ KHÔNG khớp theo tên; lead vào nhóm nhân sự THIẾU NGƯỜI + xem tay (11/10: không còn UNKNOWN)
 *   [EMNV-D5]  mã không có / nhân sự đã nghỉ ⇒ lead vẫn tạo, KHÔNG ghi người, có cảnh báo, và nằm ở HÀNG CHỜ (xem tay) với đúng lý do
 *   [EMNV-D16] SĐT phụ huynh dán nhầm vào ô «Mã NV» ⇒ lead vẫn tạo + dấu «mã sai»; chuỗi GỐC được lưu (raw) nhưng người KHÔNG có quyền PII không nhận được SĐT nào; mã dạng NV chưa tồn tại vẫn hiện
 *   [EMNV-D17] §22: chuỗi gốc + ứng viên xung đột + lý do hiện đủ cho người CÓ quyền PII, qua CẢ hàng chờ nguồn lẫn sheet gán nguồn; người KHÔNG có quyền: dữ liệu server trả về KHÔNG chứa chữ số nào của SĐT
 *   [EMNV-D18] §22: resolve (BO_SUNG_NGUOI) chọn Employee thật ⇒ snapshot nhân viên + attribution resolve; chuỗi gốc là VẾT (còn trong DB) nhưng KHÔNG hiện lại, kể cả cho người có quyền
 *   [EMNV-D6]  ô mã TRỐNG ở mọi dòng ⇒ y hệt hành vi cũ (không cảnh báo nào)
 *   [EMNV-D7]  cờ quản lý nguồn TẮT ⇒ 0 attribution + MỘT dòng cảnh báo cho cả file
 *   [EMNV-D8]  nhiều dòng cùng SĐT: cùng mã ⇒ người đó; mã KHÁC nhau ⇒ không lấy mã nào, nhóm nhân sự THIẾU NGƯỜI + xem tay (KHAC_MA)
 *   [EMNV-D9]  SĐT ĐÃ CÓ lead ⇒ first-claim: attribution KHÔNG đổi + cảnh báo "không áp dụng"
 *   [EMNV-D10] hai nhân viên cùng một mã sau chuẩn hoá ⇒ mơ hồ, không ghi người, THIẾU NGƯỜI + xem tay (MO_HO)
 *   [EMNV-D11] nhập 10 dòng, 3 mã sai ⇒ tạo 10, `errors` RỖNG, đúng 3 `warnings`, và kết quả NGUỒN: 3 `SUCCESS_WITH_REVIEW` (không phải lỗi)
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
 * ── Hướng F (11/10/2026): MÃ NV GIỚI THIỆU SAI — bộ [MNR-D*] ────────────────────────────────────────
 *   [MNR-D1]  nhãn rỗng + mã SAI ⇒ nhóm nhân sự + THIẾU NGƯỜI + xem tay, KHÔNG UNKNOWN. Đối chứng dương: không mã ⇒ UNKNOWN; mã ĐÚNG ⇒ có người, không xem tay
 *   [MNR-D2]  engine hoa hồng: mã sai ⇒ TREO THIEU_NGUOI_GIOI_THIEU (không sinh 2%); mã đúng ⇒ CO_NGUOI
 *   [MNR-D3]  RESOLVE: người duyệt chọn người ⇒ BO_SUNG_NGUOI, hết thiếu người + hết xem tay + RỜI hàng chờ, engine thấy người
 *   [MNR-D5]  đường E: nhãn mặc định + mã sai ⇒ `choDuyetNguon` ở xem thử, quy nguồn thiếu người + xem tay sau khi ghi; mã đúng ⇒ không chờ duyệt
 *   [MNR-D6]  kết quả NGUỒN của đường D: Ads sạch = SUCCESS (0 chờ duyệt); Ads+mã (mâu thuẫn) và nhãn rỗng (UNKNOWN) = SUCCESS_WITH_REVIEW
 *   [MNR-D7]  số `successWithReview` do route báo == số lead THẬT sự có trong hàng chờ nguồn (không lệch hai bên)
 *   [MNR-D4]  (đã có tiền thì không tự đổi) thuộc hướng BC — KHÔNG test ở đây; xem 08 §9 mục «ranh giới F/BC»
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
import type { Actor } from "../../lib/auth/actor";
import { phanGiaiNguoiHuong, type NguCanhNguoiHuong, type VaiResolver } from "../../lib/hoa-hong/nguoi-huong";
import { MASTER_VAI_HUONG } from "../../lib/hoa-hong/vai-huong";
import { docHangChoNguon, maNvSaiCuaDong, whereHangCho } from "../../lib/nguon/doc-hang-cho";
import { docChiTietNguon } from "../../lib/nguon/doc-danh-muc";
import { docChoGanNguon } from "../../lib/nguon/doc-gan-nguon";
import { doiNguonLead } from "../../lib/nguon/doi-nguon-lead";
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
  // hướng F — bộ [MNR-D*]
  m1: "0904000071",
  m2: "0904000072",
  m3: "0904000073",
  m4: "0904000074",
  m5: "0904000075",
  m6: "0904000076",
  m7: "0904000077",
  m8: "0904000078",
  m9: "0904000079",
  m10: "0904000080",
  m11: "0904000081",
  m12: "0904000082",
  m13: "0904000083",
  m14: "0904000084",
  m15: "0904000085",
  p1: "0904000091",
  p2: "0904000092",
  p3: "0904000093",
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
type KqD = {
  success: number;
  errors: Err[];
  warnings?: Err[];
  /** Hướng F: lead MỚI tạo mà nguồn còn chờ người duyệt (`SUCCESS_WITH_REVIEW`) · nhóm gộp vào lead có sẵn (`SKIPPED`) · từng dòng chờ duyệt vì mã NV sai. */
  successWithReview?: number;
  skipped?: number;
  review?: { row: number; code: string; message: string }[];
};
/** Cảnh báo về mã NV — đọc ở KÊNH `warnings`. Cảnh báo lẫn vào `errors` thì màn hình đếm nó là "Lỗi / KHÔNG được ghi" (10/10/2026). */
const canhBaoMa = (kq: KqD) => (kq.warnings ?? []).filter((e) => e.error.includes("Mã NV giới thiệu"));
/** Dòng nói về mã NV mà LẠC vào `errors` — luôn phải rỗng. */
const maNvLacVaoLoi = (kq: KqD) => kq.errors.filter((e) => e.error.includes("Mã NV giới thiệu"));

/** `signals` của một quy nguồn (JSON tuỳ ý trong DB) — chỉ các khoá hướng F quan tâm. */
type SignalsMaNv = { coXemTay?: boolean; xemTay?: string[]; maNvSai?: { ma: string | null; loai: string; doDai?: number; raw?: string } };
const sig = (a: { signals: unknown }) => a.signals as SignalsMaNv;
const MA_SAI = "INVALID_EMPLOYEE_REFERRER_CODE";
/** Lead CÓ NẰM trong hàng chờ nguồn không — hỏi bằng ĐÚNG `where` mà màn hàng chờ dùng, không tự nghĩ điều kiện thứ hai. */
const trongHangCho = async (leadId: string): Promise<boolean> => (await db.lead.count({ where: { id: leadId, ...whereHangCho(null, null) } })) === 1;

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
    // Đối chứng dương của hướng F: mã ĐÚNG không mang dấu «mã sai» và không vào hàng chờ.
    expect(sig(a).maNvSai).toBeUndefined();
    expect(sig(a).xemTay ?? []).not.toContain(MA_SAI);
    expect(await trongHangCho(a.leadId)).toBe(false);
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
    // Hướng F: nhãn MÂU THUẪN giữ nhóm theo nhãn, KHÔNG «thiếu người» (nhóm quảng cáo không cần người), nhưng mã người nhập gõ KHÔNG biến mất và lead vào hàng chờ.
    expect(a.referrerMissing).toBe(false);
    expect(sig(a)).toMatchObject({ coXemTay: true, xemTay: [MA_SAI], maNvSai: { loai: "NHAN_MAU_THUAN" } });
    expect(await trongHangCho(a.leadId)).toBe(true);
  }, CASE);

  it("[EMNV-D4] ô chứa TÊN đầy đủ của nhân viên (không phải mã) ⇒ KHÔNG khớp theo tên: không ghi người, có cảnh báo; lead vào nhóm nhân sự THIẾU NGƯỜI + xem tay (KHÔNG còn UNKNOWN)", async () => {
    // Luật cũ (ghim tới 10/10): «nhãn trống + mã không dùng được ⇒ UNKNOWN» — mã người nhập gõ MẤT, hàng chờ chỉ thấy «chưa rõ nguồn». Đảo 11/10/2026 (hướng F).
    await dungNhanVien("EMNV.NV.001", { fullName: "EMNV Nguyễn Văn Sale" });
    const j = await goiD([dong(SDT.d4, { ma: "EMNV Nguyễn Văn Sale" })]);
    expect(j.success).toBe(1);
    expect(canhBaoMa(j)).toHaveLength(1);
    const a = (await attr(SDT.d4))!;
    expect(a.referrerEmployeeId).toBeNull(); // vẫn KHÔNG khớp theo tên
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a.referrerMissing).toBe(true);
    expect(sig(a)).toMatchObject({ coXemTay: true, xemTay: [MA_SAI], maNvSai: { loai: "KHONG_TON_TAI" } });
    // §22 (đảo luật 11/10): ô «Mã NV» là CHỮ TỰ DO — TÊN người không phải dạng mã nên `ma` (hiện cho mọi người) = null; chuỗi GỐC được lưu ở `raw` cho người có quyền PII.
    expect(sig(a).maNvSai!.ma).toBeNull();
    expect(sig(a).maNvSai!.doDai).toBe("EMNV NGUYỄN VĂN SALE".length);
    expect(sig(a).maNvSai!.raw).toBe("EMNV Nguyễn Văn Sale"); // đúng chữ người gõ, không bị chuẩn hoá hoa
    expect(JSON.stringify(maNvSaiCuaDong(a.signals, false))).not.toMatch(/NGUY|SALE/i); // người KHÔNG quyền không nhận họ tên
    expect(maNvSaiCuaDong(a.signals, true)).toMatchObject({ raw: "EMNV Nguyễn Văn Sale", coQuyenXem: true });
    expect(await trongHangCho(a.leadId)).toBe(true);
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
    // Hướng F: cả hai nằm ở nhóm nhân sự THIẾU NGƯỜI + xem tay, mỗi dòng mang ĐÚNG lý do của nó (không tồn tại ≠ đã nghỉ).
    const khong = (await attr(SDT.d5))!;
    const nghi = (await attr(SDT.d5b))!;
    for (const a of [khong, nghi]) {
      expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
      expect(a.referrerMissing).toBe(true);
      expect(sig(a).xemTay).toEqual([MA_SAI]);
      expect(await trongHangCho(a.leadId)).toBe(true);
    }
    expect(sig(khong).maNvSai?.loai).toBe("KHONG_TON_TAI");
    expect(sig(nghi).maNvSai?.loai).toBe("DA_NGHI");
    expect(j.successWithReview).toBe(2);
    expect((j.review ?? []).map((r) => r.code).sort()).toEqual(["DA_NGHI", "KHONG_TON_TAI"]);
  }, CASE);

  it("[EMNV-D16] SĐT phụ huynh DÁN NHẦM vào ô «Mã NV» (mọi dạng viết) ⇒ lead vẫn tạo + vẫn vào hàng chờ với dấu «mã sai», nhưng KHÔNG SĐT nào lọt vào signals; mã dạng NV chưa tồn tại thì vẫn hiện", async () => {
    // Cấy: bỏ cổng đọc `canViewPii` (luôn trả raw) ⇒ khẳng định «KHÔNG quyền ⇒ không SĐT» đỏ; bỏ lưu raw ⇒ khẳng định «raw = chữ người gõ» đỏ; đối chứng dương (mã dạng NV) vẫn xanh nên không thể xanh nhờ «chặn tất».
    const j = await goiD([dong(SDT.p1, { ma: "0905123456" }), dong(SDT.p2, { ma: "0905.123.456" }), dong(SDT.p3, { ma: "EMNV.NV.998" })]);
    expect(j.success).toBe(3);
    expect(maNvLacVaoLoi(j)).toEqual([]);
    for (const s of [SDT.p1, SDT.p2]) {
      const a = (await attr(s))!;
      expect(a.group.code, s).toBe("EMPLOYEE_REFERRAL");
      expect(sig(a), s).toMatchObject({ coXemTay: true, xemTay: [MA_SAI], maNvSai: { ma: null, loai: "KHONG_TON_TAI" } });
      expect(sig(a).maNvSai!.doDai, s).toBeGreaterThanOrEqual(10);
      // §22: chuỗi GỐC được lưu (đúng chữ người gõ) — chỗ chặn nay là cổng ĐỌC, không phải cổng ghi.
      expect(sig(a).maNvSai!.raw, s).toBe(s === SDT.p1 ? "0905123456" : "0905.123.456");
      // Cái người xem tab Nguồn nhận được (hàm đọc dùng chung cho hàng chờ + trang chi tiết): KHÔNG quyền ⇒ có marker, không có số; CÓ quyền ⇒ thấy chuỗi họ gõ.
      const hienThi = maNvSaiCuaDong(a.signals, false);
      expect(hienThi, s).toMatchObject({ ma: null, loai: "KHONG_TON_TAI", raw: null });
      expect(JSON.stringify(hienThi), s).not.toMatch(/905\D?123\D?456/);
      expect(maNvSaiCuaDong(a.signals, true), s).toMatchObject({ ma: null, loai: "KHONG_TON_TAI", raw: sig(a).maNvSai!.raw });
      expect(await trongHangCho(a.leadId), s).toBe(true);
    }
    // ĐỐI CHỨNG DƯƠNG: mã có dạng nhân viên nhưng không tồn tại ⇒ người duyệt vẫn đọc được để sửa.
    const dang = (await attr(SDT.p3))!;
    expect(sig(dang).maNvSai).toEqual({ ma: "EMNV.NV.998", loai: "KHONG_TON_TAI", doDai: 11, raw: "EMNV.NV.998" });
    expect(maNvSaiCuaDong(dang.signals, false)).toEqual({ ma: "EMNV.NV.998", loai: "KHONG_TON_TAI", doDai: 11, raw: null, coQuyenXem: false });
    // Dòng GHI TRƯỚC bản vá (nguyên SĐT trong signals) cũng không bao giờ hiện ở lớp đọc.
    await db.leadAttribution.update({ where: { leadId: dang.leadId }, data: { signals: { ...(dang.signals as object), maNvSai: { ma: "0905123456", loai: "KHONG_TON_TAI" } } } });
    const cu = (await attr(SDT.p3))!;
    expect(maNvSaiCuaDong(cu.signals, false)).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 10, raw: null, coQuyenXem: false });
    // Dòng cũ không có raw ⇒ người có quyền cũng không bị "bịa" chuỗi gốc; giao diện nói thật «chưa lưu chuỗi gốc» (coQuyenXem = true).
    expect(maNvSaiCuaDong(cu.signals, true)).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 10, raw: null, coQuyenXem: true });
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
    const okAttr = (await attr(SDT.d8a))!;
    expect(okAttr.referrerEmployeeId).toBe(a1.employeeId);
    expect(okAttr.referrerMissing).toBe(false); // đối chứng dương: cùng mã ⇒ KHÔNG xem tay
    expect(sig(okAttr).maNvSai).toBeUndefined();

    const xung = await goiD([dong(SDT.d8b, { ma: "EMNV.NV.001", ten: `${P}Nhà B` }), dong(SDT.d8b, { ma: "EMNV.NV.003", ten: `${P}Nhà B` })]);
    const w = canhBaoMa(xung);
    expect(w).toHaveLength(1);
    expect(w[0]!.error).toMatch(/KHÁC NHAU/);
    const xungAttr = (await attr(SDT.d8b))!;
    expect(xungAttr.referrerEmployeeId).toBeNull();
    // Hướng F: lấy dòng nào cũng phụ thuộc thứ tự dòng ⇒ KHÔNG lấy mã nào, nhưng cả hai mã được GIỮ cho người duyệt (sắp xếp, không phụ thuộc thứ tự).
    expect(xungAttr.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(xungAttr.referrerMissing).toBe(true);
    expect(sig(xungAttr)).toMatchObject({ coXemTay: true, xemTay: [MA_SAI], maNvSai: { loai: "KHAC_MA" } });
    expect(sig(xungAttr).maNvSai!.ma).toContain(" | ");
    // §22: các ỨNG VIÊN xung đột (chữ người gõ, sắp theo mã chuẩn hoá) đều nằm ở raw — người có quyền thấy đủ để chọn.
    expect(sig(xungAttr).maNvSai!.raw).toBe("EMNV.NV.001 | EMNV.NV.003");
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
    const a = (await attr(SDT.d10))!;
    expect(a.referrerEmployeeId).toBeNull(); // không đoán một trong hai người
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a.referrerMissing).toBe(true);
    expect(sig(a)).toMatchObject({ xemTay: [MA_SAI], maNvSai: { loai: "MO_HO" } });
    expect(await trongHangCho(a.leadId)).toBe(true);
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
    // Hướng F — kết quả NGUỒN: 7 SUCCESS + 3 SUCCESS_WITH_REVIEW. Dòng mã sai KHÔNG phải lỗi (errors rỗng) nhưng cũng KHÔNG được báo «đã ghi nguồn».
    expect(j.successWithReview).toBe(3);
    expect((j.review ?? []).map((r) => r.row).sort((a, b) => a - b)).toEqual([4, 7, 10]);
    expect((j.review ?? []).every((r) => r.code === "KHONG_TON_TAI")).toBe(true);
    for (const i of [2, 5, 8]) expect(sig((await attr(SDT_D11[i]!))!).xemTay).toEqual([MA_SAI]);
    for (const i of [0, 1, 3]) {
      const a = (await attr(SDT_D11[i]!))!;
      expect(a.referrerMissing).toBe(false);
      expect(sig(a).xemTay).toBeUndefined();
    }
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

  // ══ HƯỚNG F (11/10/2026) — MÃ NV GIỚI THIỆU SAI ══════════════════════════════════════════════
  const VAI_NV_GT: VaiResolver = (() => {
    const v = MASTER_VAI_HUONG.find((x) => x.code === "REFERRER_EMPLOYEE");
    if (!v) throw new Error("MASTER_VAI_HUONG thiếu REFERRER_EMPLOYEE");
    return { code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey };
  })();

  /** Ngữ cảnh engine dựng TỪ DÒNG QUY NGUỒN ĐÃ GHI (không gõ tay đầu vào của engine — cổng phải được cho ăn bằng thứ đường thật cho nó ăn). */
  async function nguCanhTuQuyNguon(sdt: string): Promise<NguCanhNguoiHuong> {
    const a = (await attr(sdt))!;
    const u = a.referrerEmployeeId ? await db.user.findFirst({ where: { employeeId: a.referrerEmployeeId }, select: { id: true } }) : null;
    return {
      centerId: null,
      assigneeDate: new Date("2026-10-20T03:00:00.000Z"),
      lead: null,
      phanCongCoSo: [],
      gvTrialUserId: null,
      attribution: {
        referrerKind: a.referrerKind === "EMPLOYEE" ? "EMPLOYEE" : null,
        referrerParentUserId: a.referrerParentUserId,
        referrerSaleUserId: a.referrerSaleUserId,
        nguonChuEmployeeId: null,
        nguonChuUserId: null,
        referrerEmployeeUserId: u?.id ?? null,
        referrerAffiliateId: a.referrerAffiliateId,
      },
      trangThaiNhanSu: new Map(),
      affiliateConHoatDong: new Map(),
    };
  }

  it("[MNR-D1] nhãn rỗng + mã SAI ⇒ nhóm nhân sự + THIẾU NGƯỜI + xem tay, KHÔNG UNKNOWN; đối chứng dương: không mã ⇒ UNKNOWN, mã ĐÚNG ⇒ có người và không xem tay", async () => {
    // Cấy: bỏ luật NV_GIOI_THIEU_SAI khỏi THU_TU_LUAT_MAC_DINH ⇒ dòng mã sai rơi UNKNOWN (đúng lỗi cũ) ⇒ ba khẳng định đầu đỏ.
    const nv = await dungNhanVien("EMNV.NV.001");
    const j = await goiD([dong(SDT.m1, { ma: "EMNV.NV.404" }), dong(SDT.m2), dong(SDT.m3, { ma: "EMNV.NV.001" })]);
    expect(j.success).toBe(3);
    expect(j.errors).toEqual([]);

    const sai = (await attr(SDT.m1))!;
    expect(sai.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(sai).toMatchObject({ referrerMissing: true, referrerEmployeeId: null, referrerKind: null, matchedRule: "NV_GIOI_THIEU_SAI" });
    expect(sig(sai)).toMatchObject({ coXemTay: true, xemTay: [MA_SAI], maNvSai: { ma: expect.stringContaining("404"), loai: "KHONG_TON_TAI" } });
    expect(await trongHangCho(sai.leadId)).toBe(true);

    // đối chứng 1: KHÔNG mã + nhãn rỗng ⇒ hành vi cũ (UNKNOWN), KHÔNG mang dấu mã sai — luật mới không phình ra.
    const khongMa = (await attr(SDT.m2))!;
    expect(khongMa.group.code).toBe("UNKNOWN");
    expect(sig(khongMa).maNvSai).toBeUndefined();
    expect(sig(khongMa).xemTay ?? []).not.toContain(MA_SAI);

    // đối chứng 2: mã ĐÚNG ⇒ có người, không xem tay, ngoài hàng chờ.
    const dung = (await attr(SDT.m3))!;
    expect(dung).toMatchObject({ referrerMissing: false, referrerEmployeeId: nv.employeeId });
    expect(sig(dung).maNvSai).toBeUndefined();
    expect(await trongHangCho(dung.leadId)).toBe(false);
  }, CASE);

  it("[MNR-D2] engine hoa hồng: mã SAI ⇒ vai REFERRER_EMPLOYEE bị TREO THIEU_NGUOI_GIOI_THIEU (không sinh dòng 2%); đối chứng dương: mã ĐÚNG ⇒ CO_NGUOI", async () => {
    // Cấy: ghi `referrerEmployeeId` = người nhập khi mã sai ⇒ engine có người ⇒ ca đỏ. Cấy: bỏ `referrerMissing` ⇒ vẫn TREO nhưng [MNR-D1] đỏ (hai cổng canh hai tầng).
    const nv = await dungNhanVien("EMNV.NV.001");
    await goiD([dong(SDT.m4, { ma: "EMNV.NV.404" }), dong(SDT.m5, { ma: "EMNV.NV.001" })]);
    expect(phanGiaiNguoiHuong(VAI_NV_GT, await nguCanhTuQuyNguon(SDT.m4))).toMatchObject({ loai: "TREO", lyDo: "THIEU_NGUOI_GIOI_THIEU" });
    const co = phanGiaiNguoiHuong(VAI_NV_GT, await nguCanhTuQuyNguon(SDT.m5));
    expect(co.loai).toBe("CO_NGUOI");
    const user = await db.user.findFirstOrThrow({ where: { employeeId: nv.employeeId }, select: { id: true } });
    if (co.loai === "CO_NGUOI") expect(co.nguoi).toEqual([{ kind: "USER", id: user.id }]);
  }, CASE);

  it("[EMNV-D17] §22: chuỗi gốc + ứng viên xung đột + lý do hiện đủ cho người CÓ quyền PII — qua hàng chờ lẫn sheet gán nguồn; người KHÔNG có quyền: dữ liệu server trả về KHÔNG chứa chữ số nào của SĐT", async () => {
    // Cấy: bỏ cổng `canViewPii ? ` ở `docMaNvSai` (luôn trả raw) ⇒ nửa "KHÔNG quyền" đỏ; trả raw = null cho mọi người ⇒ nửa "CÓ quyền" đỏ. Hai nửa cùng ca nên cổng không thể "xanh vì chặn tất".
    await dungNhanVien("EMNV.NV.001");
    await dungNhanVien("EMNV.NV.003");
    await goiD([dong(SDT.m9, { ma: " 0905.123.456 " })]); // SĐT dán nhầm (có khoảng trắng đầu/cuối)
    await goiD([dong(SDT.m10, { ma: "emnv.nv.001", ten: `${P}Nhà xung đột` }), dong(SDT.m10, { ma: "0912 345 678", ten: `${P}Nhà xung đột` })]); // KHÁC mã: một mã thật + một SĐT
    const sdtDon = (await attr(SDT.m9))!;
    const xung = (await attr(SDT.m10))!;
    const actor = {
      userId: "u-d17", isSuperAdmin: false, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [],
      grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
    } as Actor;
    const NOW = new Date("2026-10-11T03:00:00.000Z");
    const hangCho = (canViewPii: boolean) => docHangChoNguon(actor, { coSoId: null, lyDo: "XEM_TAY", trang: 1, now: NOW, canViewPii });
    const choGan = (leadId: string, canViewPii: boolean) => docChoGanNguon({ actor, leadId, kiemQuyen: async () => true, canViewPii, cuaSoNgay: 90, now: NOW });

    // ── CÓ quyền: thấy ĐÚNG chuỗi gốc (kể cả SĐT), ứng viên xung đột đủ, lý do ──
    const co = await hangCho(true);
    const dongDon = co.dong.find((d) => d.leadId === sdtDon.leadId)!;
    const dongXung = co.dong.find((d) => d.leadId === xung.leadId)!;
    expect(dongDon.maNvSai).toMatchObject({ raw: "0905.123.456", loai: "KHONG_TON_TAI", ma: null, coQuyenXem: true }); // trim hai đầu, giữ dấu chấm
    expect(dongDon.xemTay).toContain(MA_SAI); // lý do INVALID_EMPLOYEE_REFERRER_CODE
    expect(dongXung.maNvSai).toMatchObject({ loai: "KHAC_MA", raw: "0912 345 678 | emnv.nv.001", ma: "EMNV.NV.001", coQuyenXem: true }); // cả hai ứng viên; ma chỉ phần có dạng mã
    const gDon = await choGan(sdtDon.leadId, true);
    expect(gDon!.nguon!.maNvSai).toMatchObject({ raw: "0905.123.456", loai: "KHONG_TON_TAI", coQuyenXem: true });
    expect((await choGan(xung.leadId, true))!.nguon!.maNvSai).toMatchObject({ loai: "KHAC_MA", raw: "0912 345 678 | emnv.nv.001" });

    // ── KHÔNG quyền: cùng dòng, KHÔNG chữ số SĐT nào trong TOÀN BỘ dữ liệu server trả về (không chỉ trường maNvSai) ──
    const khong = await hangCho(false);
    expect(khong.dong.find((d) => d.leadId === sdtDon.leadId)!.maNvSai).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 12, raw: null, coQuyenXem: false });
    // KHAC_MA: người KHÔNG quyền vẫn thấy phần ứng viên CÓ DẠNG MÃ (như trước vòng này), không thấy ứng viên SĐT.
    expect(khong.dong.find((d) => d.leadId === xung.leadId)!.maNvSai).toMatchObject({ loai: "KHAC_MA", raw: null, ma: "EMNV.NV.001", coQuyenXem: false });
    for (const [ten, du] of [
      ["hàng chờ", JSON.stringify(khong)],
      ["sheet gán nguồn (một SĐT)", JSON.stringify(await choGan(sdtDon.leadId, false))],
      ["sheet gán nguồn (xung đột)", JSON.stringify(await choGan(xung.leadId, false))],
    ] as const) {
      expect(du, ten).not.toMatch(/905\D?123\D?456/);
      expect(du, ten).not.toMatch(/912\D?345\D?678/);
    }
    // đối chứng dương cho chính phép đo: cùng regex BẮT được khi có quyền (không thì "không tìm thấy" chỉ nghĩa là regex hỏng)
    expect(JSON.stringify(co)).toMatch(/905\.123\.456/);
  }, CASE);

  it("[EMNV-D19] vòng 7: ô «Nguồn» của Excel là CHỮ TỰ DO — SĐT/tên gõ vào đó (và giải trình) lưu nguyên văn nhưng KHÔNG hiện cho người không có leads:view-pii, qua hàng chờ lẫn sheet gán nguồn", async () => {
    // Probe thật của reviewer: ô Nguồn = 'Chị Lan 0905123456 giới thiệu' ⇒ `signals.nhanGoc` nguyên văn + NHAN_NGUON_LA ⇒ vào hàng chờ ⇒ mở bằng vai KHÔNG có leads:view-pii.
    // Cấy: nối lại `nhanGoc: nhanGocTu(a.signals)` (bỏ docNhanGoc) ở doc-hang-cho.ts ⇒ nửa «hàng chờ» đỏ; `giaiTrinh: chuoi(a.otherSourceNote)` ở doc-gan-nguon.ts ⇒ nửa «sheet» đỏ;
    // docNhanGoc/docGiaiTrinh luôn trả «đã ẩn» ⇒ nửa «CÓ quyền» đỏ (hai nửa cùng ca nên cổng không thể xanh vì chặn tất).
    const NHAN_PII = "Chị Lan 0905123456 giới thiệu";
    const GIAI_TRINH_PII = "Cô Hoa (mẹ bé Bin) 0912 345 678 nhờ giới thiệu";
    await goiD([dong(SDT.m14, { nguon: NHAN_PII, ten: `${P}Chị Lan` })]);
    const a = (await attr(SDT.m14))!;
    expect(sig(a).xemTay, "tiền đề: nhãn lạ ⇒ xem tay NHAN_NGUON_LA").toContain("NHAN_NGUON_LA");
    expect((a.signals as { nhanGoc?: string }).nhanGoc, "tiền đề: chuỗi gốc được LƯU nguyên văn (người có quyền cần nó để duyệt)").toBe(NHAN_PII);
    await db.leadAttribution.update({ where: { id: a.id }, data: { otherSourceNote: GIAI_TRINH_PII } }); // giải trình nhóm «Khác» — phía ĐỌC là thứ được đo ở đây

    const actor = {
      userId: "u-d19", isSuperAdmin: false, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [],
      grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
    } as Actor;
    const NOW = new Date("2026-10-11T03:00:00.000Z");
    const hangCho = (canViewPii: boolean) => docHangChoNguon(actor, { coSoId: null, lyDo: "XEM_TAY", trang: 1, now: NOW, canViewPii });
    const choGan = (canViewPii: boolean) => docChoGanNguon({ actor, leadId: a.leadId, kiemQuyen: async () => true, canViewPii, cuaSoNgay: 90, now: NOW });

    // ── CÓ quyền: nguyên văn ──
    const co = await hangCho(true);
    expect(co.dong.find((d) => d.leadId === a.leadId)!.nhanGoc).toBe(NHAN_PII);
    const coGan = (await choGan(true))!.nguon!;
    expect(coGan.nhanGoc).toBe(NHAN_PII);
    expect(coGan.giaiTrinh).toBe(GIAI_TRINH_PII);

    // ── KHÔNG quyền: KHÔNG chuỗi số ≥ 6 nào (kể cả cách nhau bằng khoảng trắng/dấu chấm) trong TOÀN BỘ dữ liệu server trả về ──
    const khong = await hangCho(false);
    const dongKhong = khong.dong.find((d) => d.leadId === a.leadId)!;
    expect(dongKhong.nhanGoc).toBe(`đã ẩn (${NHAN_PII.length} ký tự)`);
    const khongGan = await choGan(false);
    expect(khongGan!.nguon!.nhanGoc).toBe(`đã ẩn (${NHAN_PII.length} ký tự)`);
    expect(khongGan!.nguon!.giaiTrinh).toBe(`đã ẩn (${GIAI_TRINH_PII.length} ký tự)`);
    for (const [ten, du] of [
      ["hàng chờ", JSON.stringify(khong)],
      ["sheet gán nguồn", JSON.stringify(khongGan)],
    ] as const) {
      expect(du, ten).not.toMatch(/905\D?123\D?456/);
      expect(du, ten).not.toMatch(/912\D?345\D?678/);
    }
    // Mọi trường CHỮ TỰ DO (không phải id/ngày giờ) không có chuỗi ≥ 6 chữ số nào, kể cả dạng chưa nghĩ tới. Quét theo TRƯỜNG chứ không theo cả JSON: ISO ngày giờ và id có thể chứa dãy số dài.
    const coSoDai = (s: string | null | undefined) => /(?:\d[\s.-]?){6,}/.test(s ?? "");
    for (const d of khong.dong) for (const v of [d.nhanGoc, d.duongVao, d.tenLead]) expect(coSoDai(v), `hàng chờ: ${v}`).toBe(false);
    for (const v of [khongGan!.nguon!.nhanGoc, khongGan!.nguon!.giaiTrinh, khongGan!.duongVao, khongGan!.tenLead]) expect(coSoDai(v), `sheet: ${v}`).toBe(false);
    // ĐƯỜNG VÀO (`Lead.source`): đường Excel ghi nguyên văn ô «Nguồn» vào đó ⇒ cùng một luật (probe này TÌM RA lỗ — reviewer chỉ nêu nhanGoc/giaiTrinh).
    expect(co.dong.find((d) => d.leadId === a.leadId)!.duongVao).toBe(NHAN_PII);
    expect(dongKhong.duongVao).toBe(`đã ẩn (${NHAN_PII.length} ký tự)`);
    expect(khongGan!.duongVao).toBe(`đã ẩn (${NHAN_PII.length} ký tự)`);
    // ── Thống kê chi tiết nguồn (top đường vào của nhóm): cùng cờ ──
    const ctCo = (await docChiTietNguon(actor, a.group.code, NOW, true))!;
    const ctKhong = (await docChiTietNguon(actor, a.group.code, NOW, false))!;
    expect(ctCo.thongKe.theoDuongVao.map((r) => r.duongVao), "có quyền: thấy nhãn gốc").toContain(NHAN_PII);
    expect(ctKhong.thongKe.theoDuongVao.map((r) => r.duongVao), "không quyền: nhãn gốc KHÔNG có").not.toContain(NHAN_PII);
    expect(JSON.stringify(ctKhong.thongKe.theoDuongVao)).not.toMatch(/905\D?123\D?456/);
    expect(ctKhong.thongKe.theoDuongVao.some((r) => r.duongVao === `đã ẩn (${NHAN_PII.length} ký tự)`)).toBe(true);
    // đối chứng dương cho chính phép đo: cùng regex BẮT được khi có quyền
    expect(JSON.stringify(co)).toMatch(/905\D?123\D?456/);
    expect(JSON.stringify(await choGan(true))).toMatch(/912\D?345\D?678/);
  }, CASE);

  it("[EMNV-D18] §22: resolve chọn Employee thật ⇒ snapshot nhân viên + attribution resolve; chuỗi gốc còn làm VẾT nhưng KHÔNG hiện lại (kể cả cho người có quyền)", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    await goiD([dong(SDT.m11, { ma: "Nguyễn Thị Huệ (anh Tư)" })]); // gõ TÊN thay vì mã
    const truoc = (await attr(SDT.m11))!;
    expect(sig(truoc).maNvSai!.raw).toBe("Nguyễn Thị Huệ (anh Tư)");
    const actor = {
      userId: "u-d18", isSuperAdmin: false, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [],
      grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
    } as Actor;
    const r = await doiNguonLead({
      leadId: truoc.leadId, actor, actorName: P, kiemQuyen: async () => true, groupId: truoc.groupId,
      thamChieu: { employeeId: nv.employeeId, parentUserId: null, studentId: null, affiliateId: null },
      giaiTrinh: null, lyDo: "Đối chiếu người nhập: ô gõ tên anh Tư, đúng là nhân viên này", bayGio: new Date("2026-10-11T03:00:00.000Z"),
    });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, action: "BO_SUNG_NGUOI" });
    const sau = (await attr(SDT.m11))!;
    expect(sau).toMatchObject({ referrerMissing: false, referrerEmployeeId: nv.employeeId, referrerKind: "EMPLOYEE", matchedRule: "DOI_NGUON" });
    // SNAPSHOT của Employee thật (mã · vai · đơn vị) — nguồn tiền hoa hồng đọc ảnh chụp này, không đọc lại hồ sơ sống.
    expect((sau.signals as { nguoiGioiThieu?: { employeeCode: string; roleCodes: string[] } }).nguoiGioiThieu).toMatchObject({ employeeCode: "EMNV.NV.001", roleCodes: ["CENTER_SALES_CSM"] });
    expect(sau.referrerRoleCode).toBe("SALE");
    // Vết gốc GIỮ trong DB (kiểm toán), nhưng KHÔNG hiện lại như đang chờ — kể cả cho người có quyền PII.
    expect(sig(sau).maNvSai!.raw).toBe("Nguyễn Thị Huệ (anh Tư)");
    expect(maNvSaiCuaDong(sau.signals, true)).toBeNull();
    expect(await trongHangCho(sau.leadId)).toBe(false);
    // Engine hoa hồng (luật hiện hành, KHÔNG sửa ở đây): có người ⇒ CO_NGUOI.
    expect(phanGiaiNguoiHuong(VAI_NV_GT, await nguCanhTuQuyNguon(SDT.m11)).loai).toBe("CO_NGUOI");
  }, CASE);

  it("[MNR-D3] RESOLVE: người duyệt chọn người ⇒ BO_SUNG_NGUOI, hết thiếu người + hết xem tay + RỜI hàng chờ, engine thấy người; vết mã sai KHÔNG còn hiện như đang chờ", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    await goiD([dong(SDT.m6, { ma: "EMNV.NV.404" })]);
    const truoc = (await attr(SDT.m6))!;
    expect(await trongHangCho(truoc.leadId)).toBe(true);

    const actor = {
      userId: "u-mnr", isSuperAdmin: false, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [],
      grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
    } as Actor;
    const r = await doiNguonLead({
      leadId: truoc.leadId,
      actor,
      actorName: P,
      kiemQuyen: async () => true,
      groupId: truoc.groupId,
      thamChieu: { employeeId: nv.employeeId, parentUserId: null, studentId: null, affiliateId: null },
      giaiTrinh: null,
      lyDo: "Đối chiếu với người nhập: mã gõ nhầm, đúng là nhân viên này",
      bayGio: new Date("2026-10-11T03:00:00.000Z"),
    });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, action: "BO_SUNG_NGUOI" });

    const sau = (await attr(SDT.m6))!;
    expect(sau).toMatchObject({ referrerMissing: false, referrerEmployeeId: nv.employeeId, referrerKind: "EMPLOYEE" });
    expect(sig(sau).coXemTay).toBeUndefined();
    expect(sig(sau).xemTay).toBeUndefined();
    expect(await trongHangCho(sau.leadId)).toBe(false);
    expect(phanGiaiNguoiHuong(VAI_NV_GT, await nguCanhTuQuyNguon(SDT.m6)).loai).toBe("CO_NGUOI");
  }, CASE);

  it("[MNR-D5] đường E (file đăng ký): nhãn mặc định + mã SAI ⇒ xem thử báo `choDuyetNguon`; ghi xong quy nguồn THIẾU NGƯỜI + xem tay; đối chứng dương: mã ĐÚNG ⇒ không chờ duyệt", async () => {
    // Trước 11/10: nhãn mặc định «Import Excel ĐK» ánh xạ nhóm cần NGƯỜI ⇒ thiếu người nhưng MẤT mã và lý do. Cấy: bỏ `maNvSai` khỏi `tinHieu` của route E ⇒ ca đỏ ở `maNvSai`.
    const nv = await dungNhanVien("EMNV.NV.001");
    const f = fileDangKy([
      { ten: `${P}Bé M7`, sdt: SDT.m7, ma: "emnv.nv.404" }, // chữ thường: raw phải giữ ĐÚNG như gõ (đường E không được chuẩn hoá trước khi lưu)
      { ten: `${P}Bé M8`, sdt: SDT.m8, ma: "EMNV.NV.001" },
    ]);
    type KqMnr = { data: { choDuyetNguon: number; nguonGiuNguyen: number; maNvGioiThieuBoQua: { sdt: string; lyDo: string; loai?: string }[]; daTaoLead: number } };
    const dry = (await (await registeredPost(reqE(f, "dry-run"))).json()) as KqMnr;
    expect(dry.data.choDuyetNguon).toBe(1);
    expect(dry.data.maNvGioiThieuBoQua).toHaveLength(1);
    expect(dry.data.maNvGioiThieuBoQua[0]!.loai).toBe("KHONG_TON_TAI");

    const conf = (await (await registeredPost(reqE(f, "confirm"))).json()) as KqMnr;
    expect(conf.data.daTaoLead).toBe(2);
    const sai = (await attr(SDT.m7))!;
    expect(sai).toMatchObject({ referrerMissing: true, referrerEmployeeId: null });
    expect(sig(sai)).toMatchObject({ coXemTay: true, xemTay: [MA_SAI], maNvSai: { loai: "KHONG_TON_TAI", ma: "EMNV.NV.404", raw: "emnv.nv.404" } }); // §22 đường E: ma chuẩn hoá, raw = chữ người gõ
    expect(await trongHangCho(sai.leadId)).toBe(true);
    const dung = (await attr(SDT.m8))!;
    expect(dung).toMatchObject({ referrerMissing: false, referrerEmployeeId: nv.employeeId });
    expect(sig(dung).maNvSai).toBeUndefined();
    expect(await trongHangCho(dung.leadId)).toBe(false);
  }, CASE);

  it("[MNR-D6] kết quả NGUỒN đường D: Ads sạch = SUCCESS (0 chờ duyệt); Ads + mã (nhãn mâu thuẫn) và nhãn rỗng (UNKNOWN) = SUCCESS_WITH_REVIEW; `success` giữ nghĩa cũ (tổng đã TẠO)", async () => {
    await dungNhanVien("EMNV.NV.001");
    const j = await goiD([dong(SDT.m9, { nguon: "Ads" }), dong(SDT.m10, { nguon: "Ads", ma: "EMNV.NV.001" }), dong(SDT.m11)]);
    expect(j.success).toBe(3);
    expect(j.errors).toEqual([]);
    expect(j.successWithReview).toBe(2); // m10 (xem tay) + m11 (UNKNOWN); m9 sạch KHÔNG bị gắn «chờ duyệt»
    expect(j.skipped).toBe(0);
    expect((j.review ?? []).map((r) => r.code)).toEqual(["NHAN_MAU_THUAN"]); // chỉ dòng chờ duyệt VÌ MÃ NV có dòng review
    expect(await trongHangCho((await attr(SDT.m9))!.leadId)).toBe(false);

    // SĐT đã có lead ⇒ gộp, nguồn gốc giữ nguyên ⇒ SKIPPED (không phải lỗi, không phải chờ duyệt).
    const lan2 = await goiD([dong(SDT.m9, { nguon: "Ads" })]);
    expect(lan2.skipped).toBe(1);
    expect(lan2.successWithReview).toBe(0);
  }, CASE);

  it("[MNR-D7] số `successWithReview` route báo == số lead THẬT sự có trong hàng chờ nguồn (không lệch hai bên)", async () => {
    // Cấy: đổi điều kiện `phanLoaiDongNhap` sang «referrerMissing» thay vì `lyDoCuaDong` ⇒ số route báo lệch số hàng chờ ⇒ ca đỏ.
    await dungNhanVien("EMNV.NV.001");
    const [s1, s2, s3] = [SDT.m12, SDT.m13, SDT_D12] as const;
    const sdts = [s1, s2, s3];
    const j = await goiD([dong(s1, { nguon: "Ads" }), dong(s2, { ma: "EMNV.NV.404" }), dong(s3, { nguon: "Ads", ma: "EMNV.NV.404" })]);
    const trongHang = await db.lead.count({ where: { phone: { in: sdts.flatMap(bienThe) }, ...whereHangCho(null, null) } });
    expect(trongHang).toBe(2);
    expect(j.successWithReview).toBe(trongHang);
  }, CASE);
});
