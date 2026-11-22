// @vitest-environment node
/**
 * «NGUỒN CỦA CẢ FILE» của HAI đường Excel (chủ dự án chốt 28/10/2026) — chạy ĐÚNG HANDLER THẬT trên Postgres LOCAL:
 *
 *   D  `POST /api/admin/import/leads`            (file sự kiện — không có cột ngày)
 *   E  `POST /api/admin/import/leads/registered` (file đăng ký — CÓ cột "Ngày")
 *
 *   «excel: thêm ô nguồn của phải chọn tương tự ô nhập khách hàng cho toàn bộ file, bỏ nguồn ở file mẫu template đi»
 *
 * Từ nay (cờ nguồn BẬT) MỌI lượt nhập Excel phải mang MỘT lựa chọn nguồn (`nguonChon`) áp cho mọi dòng MỚI qua luật `CHON_NGUON`; cột «Nguồn» và cột «Mã NV giới thiệu»
 * ĐÃ BỎ khỏi file mẫu — file CŨ còn hai cột đó vẫn nhập được nhưng chúng KHÔNG còn quyết nguồn. Lõi dò MÃ NV / NHÃN từng dòng (`giaiMaNvGioiThieuTheoLo` · luật
 * `NV_GIOI_THIEU` · `KHAI_TAY` · hàng chờ «mã sai») vẫn còn trong `lib/nguon` nhưng KHÔNG route nào chạm tới nó nữa; phần ĐỌC của nó (hàng chờ · che PII · resolve · engine hoa hồng)
 * còn phải đúng với dữ liệu cũ, nên các ca [EMNV-*]/[MNR-*] của nó được GIỮ lại và dựng hiện trường bằng `taoLeadVoiMaNv` (đúng các hàm thư viện mà route từng gọi).
 *
 *   ── Route (nguồn của cả file) ───────────────────────────────────────────────────────────────────────────────
 *   [XCF-01]  D: mọi dòng mới = nguồn đã chọn (CHON_NGUON, MANUAL); nhãn «Ads» / lạ / trống trong file CŨ không quyết; Lead.source = «Import Excel» (nhãn trong file không rò vào cột định tuyến)
 *   [XCF-02]  D: nguồn đòi NGƯỜI ⇒ người do ô chọn quyết (MỘT người cho cả file); cột «Mã NV giới thiệu» của file cũ bị bỏ qua + ĐÚNG MỘT cảnh báo cho cả file
 *   [XCF-03]  D: nhãn LẠ trong file cũ KHÔNG đẩy lead vào hàng chờ «nhãn lạ» khi đã có nguồn chọn; chuỗi gốc vẫn ở `signals.nhanGoc` (truy vết)
 *   [XCF-04]  D: thiếu / hỏng `nguonChon` ⇒ 400 + 0 lead (mọi dạng hỏng: chuỗi · mảng · rỗng · nhóm không tồn tại)
 *   [XCF-05]  D: cờ nguồn TẮT ⇒ hành vi cũ y nguyên (kể cả khi client có gửi `nguonChon` — bị bỏ qua)
 *   [XCF-06]  D: SĐT đã có lead ⇒ nguồn gốc KHÔNG đổi, lựa chọn chỉ ghi vào vết (touchpoint), cảnh báo «chỉ áp cho lead MỚI»
 *   [XCF-E1]  E: phụ huynh MỚI nhận nguồn đã chọn; hai cột cũ «Nguồn» / «Mã NV giới thiệu» bị bỏ qua (dry-run báo `maNvGioiThieuBoQua` loại CHON_NGUON); Lead.source = «Import Excel»
 *   [XCF-E2]  E: phụ huynh ĐÃ CÓ lead ⇒ gộp, nguồn gốc giữ nguyên
 *   [XCF-E3]  E: thiếu nguồn (cả xem thử lẫn ghi) / nguồn không ghi được ⇒ 400, 0 lead; xem thử ĐO THEO lựa chọn (đổi lựa chọn ⇒ số xem thử đổi)
 *
 *   ── Phần của route KHÔNG phụ thuộc nguồn (giữ nguyên, chỉ bơm thêm `nguonChon`) ──────────────────────────────
 *   [EMNV-D7]  cờ quản lý nguồn TẮT ⇒ 0 attribution + MỘT dòng cảnh báo cho cả file
 *   [EMNV-D12] cột Sale phụ trách gõ sai ⇒ lead vẫn tạo, cảnh báo nằm ở `warnings` chứ không ở `errors`
 *   [EMNV-D13] dòng sale sai + cơ sở ngoài phạm vi ⇒ 1 Lỗi 0 Cảnh báo; dòng hợp lệ + sale sai ⇒ 0 Lỗi 1 Cảnh báo
 *   [EMNV-D14] gộp chéo cơ sở bị từ chối + ô mã NV có chữ ⇒ 1 Lỗi, KHÔNG cảnh báo
 *   [EMNV-E4b] E: Sale CS1 — phụ huynh gắn CS2 (ngoài phạm vi) và SĐT đang thuộc lead CS2 cũng bị TRỪ khỏi số sẽ ghi
 *   [EMNV-E4]  E: số xem thử TRỪ phụ huynh/học viên của dòng bị chặn (nay: ngoài phạm vi); `phuHuynh`/`hocVien` vẫn là số TRONG FILE
 *   [EMNV-E5]  E: khối "Đối chứng" (tổng đã thu) + "Nghi một học viên bị tách" CHỈ tính phụ huynh SẼ GHI
 *   [EMNV-E6]  E: thẻ "không đổi (đã import trước đó)" KHÔNG đếm SĐT bị từ chối vì thuộc cơ sở khác
 *
 *   ── Phần ĐỌC của lõi mã NV (dữ liệu CŨ), dựng bằng `taoLeadVoiMaNv` thay vì route ───────────────────────────────
 *   [EMNV-D1] [EMNV-D3] [EMNV-D4] [EMNV-D5] [EMNV-D8] [EMNV-D10] [EMNV-D16] [EMNV-D17] [EMNV-D18] [EMNV-D19] · [MNR-D1] [MNR-D2] [MNR-D3] · [EMNV-F4]
 *
 *   ĐÃ BỎ (không còn đường tới từ route): [EMNV-D2] [EMNV-D6] [EMNV-D6b] [EMNV-D9 phần mã] [EMNV-D11] [EMNV-D15] [EMNV-E1..E3] [MNR-D5..D7] [EMNV-F1] [EMNV-F1b] —
 *   vì chúng khẳng định "nhãn / mã từng dòng của FILE quyết nguồn"; nay luật là ngược lại và được [XCF-*] khoá.
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
import { leadSourceTuNhanExcel } from "../../lib/nguon/anh-xa-nhan-cu";
import { cacMaGocKhacNhau, gopMaCungSdt, maNvSaiKhacMa, maNvSaiTuKetQua } from "../../lib/nguon/ma-nv-gioi-thieu";
import { giaiMaNvGioiThieuTheoLo } from "../../lib/nguon/ma-nv-gioi-thieu-db";
import { chuanBiQuyNguon, ghiQuyNguonLeadMoi } from "../../lib/nguon/noi-day";
import { KHONG_CO_TIN_HIEU_NGUON, type MaNvSai } from "../../lib/nguon/tin-hieu";
import { CAU_THIEU_NGUON_CA_FILE } from "../../lib/nguon/nguon-ca-file";
import { CO_NGUON_DAY_DU, capKhoaGhiNguon, damBaoDanhMucGoc, damBaoToChuc, datCoNguon, type IdNhom } from "./_nguon-fixture";
import { clearSettingsCache } from "../../lib/settings/service";

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
  // C1b — F1 (Lead.source không phải ô tự do) · F4 (nhóm nhân sự mặc định tắt)
  f1a: "0904000101",
  f1b: "0904000102",
  f1c: "0904000103",
  f1d: "0904000104",
  f1e: "0904000105",
  f1f: "0904000106",
  f1g: "0904000107",
  f4a: "0904000111",
  f4b: "0904000112",
  f4c: "0904000113",
  f4d: "0904000114",
  // 28/10/2026 — nguồn của cả file
  x1: "0904000121",
  x2: "0904000122",
  x3: "0904000123",
  x4: "0904000124",
  x5: "0904000125",
  x6: "0904000126",
  x7: "0904000127",
  x8: "0904000128",
} as const;
const SDT_D12 = "0904000041";
const SDT_D13 = { ngoai: "0904000061", ok: "0904000062", trung: "0904000063", chan: "0904000064", ok2: "0904000065" } as const;
const SDT_E4 = { chan: "0904000051", ok: "0904000052", ngoai: "0904000053", trung: "0904000054" } as const;
const TAT_CA_SDT = [...Object.values(SDT), SDT_D12, ...Object.values(SDT_D13), ...Object.values(SDT_E4)];
const bienThe = (s: string) => [s, `84${s.slice(1)}`];

type Err = { row: number; error: string };
/** Phản hồi của đường D: `errors` = dòng KHÔNG vào được; `warnings` = dòng ĐÃ vào nhưng cần xem. `status`/`error` cho các lượt bị từ chối cả lô (400). */
type KqD = {
  status: number;
  error?: string;
  success: number;
  updated?: number;
  errors: Err[];
  warnings?: Err[];
  successWithReview?: number;
  skipped?: number;
  review?: { row: number; code: string; message: string }[];
};
/** Cảnh báo về mã NV — đọc ở KÊNH `warnings`. */
const canhBaoMa = (kq: KqD) => (kq.warnings ?? []).filter((e) => e.error.includes("Mã NV giới thiệu"));

/** `signals` của một quy nguồn (JSON tuỳ ý trong DB) — chỉ các khoá hướng F quan tâm. */
type SignalsMaNv = { coXemTay?: boolean; xemTay?: string[]; nhanGoc?: string; maNvSai?: { ma: string | null; loai: string; doDai?: number; raw?: string } };
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

// ── «Nguồn của cả file» ───────────────────────────────────────────────────────────────────────────────────
let nhom: IdNhom;
/** Lựa chọn thô đúng hình máy chủ nhận (`nguonChonSchema`). */
const nc = (groupId: string, o: { employeeId?: string; giaiTrinh?: string } = {}) => ({
  groupId,
  employeeId: o.employeeId ?? null,
  parentUserId: null,
  studentId: null,
  affiliateId: null,
  giaiTrinh: o.giaiTrinh ?? null,
});
/** Đánh dấu «KHÔNG gửi khoá `nguonChon`» (request thiếu nguồn). */
const KHONG_GUI = Symbol("khong-gui");
/** Gọi đường D. `nguonChon` mặc định = WALK_IN (nguồn không đòi người) để các ca không quan tâm nguồn chỉ cần bỏ trống. */
const guiD = async (rows: unknown[], nguonChon: unknown = nc(nhom.WALK_IN)): Promise<KqD> => {
  const body = nguonChon === KHONG_GUI ? { rows } : { rows, nguonChon };
  const r = await importPost(jsonReq("/api/admin/import/leads", body));
  return { status: r.status, ...((await r.json()) as object) } as KqD;
};

const theoSdt = (s: string) => db.lead.findFirst({ where: { phone: { in: bienThe(s) }, deletedAt: null }, select: { id: true, source: true } });
const attr = async (s: string) => {
  const l = await theoSdt(s);
  if (!l) return null;
  return db.leadAttribution.findUnique({ where: { leadId: l.id }, include: { group: { select: { code: true } } } });
};
const demLead = (sdts: readonly string[]) => db.lead.count({ where: { phone: { in: sdts.flatMap(bienThe) }, deletedAt: null } });

/**
 * Dựng MỘT lead + quy nguồn đúng như route nhập Excel TỪNG làm cho một nhóm dòng cùng SĐT khi còn đọc cột «Mã NV giới thiệu» và nhãn «Nguồn» (trước 28/10/2026): cùng các hàm thư viện,
 * cùng thứ tự — chỉ không còn đi qua HTTP. Dùng cho các ca [EMNV-*]/[MNR-*] kiểm PHẦN ĐỌC của lõi mã NV (hàng chờ · che PII · resolve · engine hoa hồng) trên dữ liệu CŨ.
 * `maTho` = ô mã của MỖI dòng cùng SĐT (null/rỗng = để trống); `nhan` = ô «Nguồn» (null = trống).
 */
async function taoLeadVoiMaNv(sdt: string, maTho: readonly (string | null)[], o: { nhan?: string | null; ten?: string } = {}): Promise<string> {
  const moc = new Date();
  const ma = maTho.map((m) => (m === null ? null : m.trim() || null));
  const nhan = o.nhan ?? null;
  const gop = gopMaCungSdt(ma);
  let nhanSu: string | null = null;
  let maSai: MaNvSai | null = null;
  if (gop.khacNhau) {
    maSai = maNvSaiKhacMa(cacMaGocKhacNhau(ma));
  } else {
    const [kq] = await giaiMaNvGioiThieuTheoLo(db, { nguonBat: true, bayGio: moc, dong: [{ maTho: gop.goc, nhanKhai: nhan, ngayGiaiMa: moc }] });
    if (kq!.kieu === "DUNG") nhanSu = kq!.employeeId;
    else if (kq!.kieu === "BO_QUA") maSai = maNvSaiTuKetQua(kq!);
  }
  const conversionEntry = nhan ? leadSourceTuNhanExcel(nhan, "Import Excel") : "Import Excel";
  const [cb] = await chuanBiQuyNguon(db, [
    {
      bayGio: moc,
      duongVao: "import-excel",
      conversionEntry,
      nhanKhai: nhan,
      laNhapExcel: true,
      sdtKhach: sdt,
      maNvNguoiNhap: null,
      nguoiNhapUserId: SESS.current?.user.id ?? null,
      nhanSuGioiThieuEmployeeId: nhanSu,
      maNvSai: maSai,
      phuHuynhGioiThieu: null,
      ref: null,
      refSau: [],
      quangCao: KHONG_CO_TIN_HIEU_NGUON.quangCao,
      utm: KHONG_CO_TIN_HIEU_NGUON.utm,
      pageId: null,
      orgUnitId: null,
      centerId: null,
    },
  ]);
  const lead = await db.$transaction(async (tx) => {
    const c = await tx.lead.create({ data: { parentName: o.ten ?? `${P}Excel`, phone: sdt, status: "MOI", source: conversionEntry, lastInboundAt: moc }, select: { id: true } });
    await ghiQuyNguonLeadMoi(tx, c.id, cb!, null);
    return c;
  });
  return lead.id;
}

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
/** `nguonChon` bỏ trống = KHÔNG gửi khoá (request thiếu nguồn); có = chuỗi JSON trong FormData. */
const reqE = (f: File, mode: "dry-run" | "confirm", nguonChon?: unknown) => {
  const fd = new FormData();
  fd.set("file", f);
  fd.set("mode", mode);
  if (nguonChon !== undefined) fd.set("nguonChon", typeof nguonChon === "string" ? nguonChon : JSON.stringify(nguonChon));
  return new NextRequest("http://localhost/api/admin/import/leads/registered", { method: "POST", body: fd });
};
type KqE = { ok: boolean; data: { daTaoLead: number; daGopLead: number; maNvGioiThieuBoQua: { sdt: string; lyDo: string; loai?: string }[]; maNvGioiThieuTat: boolean } };
const goiE = async (f: File, mode: "dry-run" | "confirm", nguonChon: unknown = nc(nhom.WALK_IN)) => (await (await registeredPost(reqE(f, mode, nguonChon))).json()) as KqE;

describe.skipIf(!RUN)("Excel — «Nguồn của cả file» (hai đường D/E, handler thật) + phần đọc của lõi mã NV", () => {
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
  }, 180_000);

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    await db.center.create({ data: { code: "EMNV1", name: "EMNV 1", slug: "emnv-1", address: "a", city: "" } });
    await datCoNguon(CO_NGUON_DAY_DU);
    await dungNguoiNhap();
  }, CASE);

  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 180_000);

  // ══ NGUỒN CỦA CẢ FILE — đường D ═════════════════════════════════════════════════════════════════════════════
  it("[XCF-01] D: MỌI dòng mới = nguồn đã chọn (CHON_NGUON, MANUAL), bất kể nhãn «Ads» / chuỗi lạ / trống trong file CŨ; Lead.source là nhãn kỹ thuật «Import Excel» (nhãn «Ads» KHÔNG rò vào cột định tuyến)", async () => {
    // Cấy: bỏ `nguonChon` khỏi lời gọi `chuanBiQuyNguon` ở route D ⇒ nhãn trong file quyết lại (Ads ⇒ PAID_ADS, lạ ⇒ UNKNOWN) ⇒ ba khẳng định nhóm đỏ.
    // Cấy: bỏ nhánh `if (nguonChon) … g.base.source = "Import Excel"` ⇒ dòng «Ads» ghi Lead.source = "Ads" ⇒ khẳng định cột định tuyến đỏ.
    const j = await guiD([dong(SDT.x1, { nguon: "Ads" }), dong(SDT.x2, { nguon: "Chị Lan 0905123456 giới thiệu" }), dong(SDT.x3), dong(SDT.x4, { nguon: "Quản Lý Trung Tâm" })], nc(nhom.WALK_IN));
    expect(j, JSON.stringify(j)).toMatchObject({ status: 200, success: 4, successWithReview: 0, errors: [] });
    for (const s of [SDT.x1, SDT.x2, SDT.x3, SDT.x4]) {
      const a = (await attr(s))!;
      expect(a.group.code, s).toBe("WALK_IN");
      expect(a, s).toMatchObject({ matchedRule: "CHON_NGUON", identificationMethod: "MANUAL", referrerMissing: false });
      expect((await theoSdt(s))!.source, `${s}: Lead.source`).toBe("Import Excel");
    }
    // Đối chứng dương: nguồn chọn KHÁC ⇒ lô đó đổi theo (không phải «luôn WALK_IN»).
    expect(await guiD([dong(SDT.x5, { nguon: "Website" })], nc(nhom.PAID_ADS))).toMatchObject({ status: 200, success: 1 });
    expect((await attr(SDT.x5))!.group.code).toBe("PAID_ADS");
  }, CASE);

  it("[XCF-02] D: nguồn ĐÒI NGƯỜI ⇒ người do ô chọn quyết (MỘT người cho cả file); cột «Mã NV giới thiệu» của file cũ bị bỏ qua + ĐÚNG MỘT cảnh báo cho cả file (không mỗi dòng một câu), không dòng nào vào hàng chờ «mã sai»", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    await dungNhanVien("EMNV.NV.002");
    const j = await guiD(
      [dong(SDT.x1, { ma: "EMNV.NV.002" }), dong(SDT.x2, { ma: "EMNV.NV.404" }), dong(SDT.x3)],
      nc(nhom.EMPLOYEE_REFERRAL, { employeeId: nv.employeeId }),
    );
    expect(j, JSON.stringify(j)).toMatchObject({ status: 200, success: 3, successWithReview: 0, errors: [] });
    for (const s of [SDT.x1, SDT.x2, SDT.x3]) {
      const a = (await attr(s))!;
      expect(a, s).toMatchObject({ matchedRule: "CHON_NGUON", referrerKind: "EMPLOYEE", referrerEmployeeId: nv.employeeId, referrerMissing: false });
      expect(sig(a).maNvSai, s).toBeUndefined();
      expect(sig(a).xemTay ?? [], s).not.toContain(MA_SAI);
      expect(await trongHangCho(a.leadId), s).toBe(false);
    }
    const w = canhBaoMa(j);
    expect(w).toHaveLength(1);
    expect(w[0]!.row).toBe(0);
    expect(w[0]!.error).toMatch(/KHÔNG được áp dụng ở 2 lead/); // hai dòng có mã; dòng thứ ba để trống
    expect(j.errors.filter((e) => e.error.includes("Mã NV giới thiệu"))).toEqual([]); // cảnh báo KHÔNG lẫn vào `errors`

    // Đối chứng: không dòng nào có cột mã ⇒ KHÔNG cảnh báo về mã.
    const sach = await guiD([dong(SDT.x5), dong(SDT.x6)], nc(nhom.EMPLOYEE_REFERRAL, { employeeId: nv.employeeId }));
    expect(sach).toMatchObject({ status: 200, success: 2 });
    expect(canhBaoMa(sach)).toEqual([]);
  }, CASE);

  it("[XCF-03] D: nhãn LẠ trong file cũ KHÔNG đẩy lead vào hàng chờ «nhãn lạ» khi đã có nguồn chọn (nguồn đã rõ); chuỗi gốc vẫn ở signals.nhanGoc để truy vết; SĐT trong chuỗi gốc không lọt Lead.source / ghi chú", async () => {
    // Cấy: bỏ `luat !== "CHON_NGUON" &&` ở `hoanTat` (lib/nguon/quy-nguon.ts) ⇒ NHAN_NGUON_LA lại được thêm ⇒ lead vào hàng chờ dù nguồn đã chọn ⇒ hai khẳng định cuối đỏ.
    const PII = "Chị Lan 0905123456 giới thiệu";
    expect(await guiD([dong(SDT.x1, { nguon: PII })], nc(nhom.PAID_ADS))).toMatchObject({ status: 200, success: 1, successWithReview: 0 });
    const a = (await attr(SDT.x1))!;
    expect(a.group.code).toBe("PAID_ADS");
    expect(sig(a).nhanGoc, "chuỗi gốc là VẾT (che theo quyền khi đọc)").toBe(PII);
    expect(sig(a).xemTay ?? []).not.toContain("NHAN_NGUON_LA");
    expect(await trongHangCho(a.leadId)).toBe(false);
    const lead = await db.lead.findUniqueOrThrow({ where: { id: a.leadId }, select: { source: true, note: true } });
    expect(JSON.stringify(lead)).not.toMatch(/905123456/);
  }, CASE);

  it("[XCF-04] D: THIẾU hoặc HỎNG `nguonChon` (cờ BẬT) ⇒ 400 + 0 lead: khoá vắng · null · chuỗi · mảng · {} · nhóm không tồn tại · nguồn đòi người mà thiếu người", async () => {
    // Cấy: bỏ `if (!nguonCaFile.ok) return …` ở route D ⇒ request không nguồn tạo lead ⇒ khẳng định «0 lead» đỏ ở MỌI vòng.
    const nv = await dungNhanVien("EMNV.NV.001");
    const rows = [dong(SDT.x1), dong(SDT.x2)];
    const hong: [string, unknown][] = [
      ["khoá vắng", KHONG_GUI],
      ["null", null],
      ["chuỗi", "abc"],
      ["mảng", []],
      ["đối tượng rỗng", {}],
      ["nhóm không tồn tại", nc("khong-co-nhom-nay")],
      ["nguồn đòi người, thiếu người", nc(nhom.EMPLOYEE_REFERRAL)],
      ["nguồn đòi nhân sự, đưa phụ huynh", { ...nc(nhom.EMPLOYEE_REFERRAL), studentId: "hv-gia" }],
    ];
    for (const [ten, v] of hong) {
      const j = await guiD(rows, v);
      expect(j.status, ten).toBe(400);
      expect(j.error, ten).toBeTruthy();
      expect(j.errors, `${ten}: MỘT câu cho cả lô, không bảng lỗi từng dòng`).toBeUndefined();
      expect(await demLead([SDT.x1, SDT.x2]), `${ten} — không được tạo lead`).toBe(0);
    }
    expect((await guiD(rows, KHONG_GUI)).error).toBe(CAU_THIEU_NGUON_CA_FILE);
    // Đối chứng dương: cùng file, lựa chọn ĐÚNG ⇒ tạo.
    expect(await guiD(rows, nc(nhom.EMPLOYEE_REFERRAL, { employeeId: nv.employeeId }))).toMatchObject({ status: 200, success: 2 });
  }, CASE);

  it("[XCF-05] D: cờ nguồn TẮT ⇒ hành vi cũ y nguyên: không cần nguồn, 0 attribution, nhãn ghi nguyên văn; `nguonChon` do client gửi kèm bị BỎ QUA; cột Mã NV ⇒ ĐÚNG MỘT cảnh báo «TẮT» (ca [EMNV-D7])", async () => {
    await dungNhanVien("EMNV.NV.001");
    await datCoNguon({});
    const j = await guiD([dong(SDT.d7, { ma: "EMNV.NV.001" }), dong(SDT.d7b, { nguon: "Hội thảo STEM tháng 10", ma: "EMNV.NV.001" })], KHONG_GUI);
    expect(j.status).toBe(200);
    expect(j.success).toBe(2);
    expect(await attr(SDT.d7)).toBeNull();
    expect((await theoSdt(SDT.d7b))!.source).toBe("Hội thảo STEM tháng 10"); // ghi nguyên văn — không có quy nguồn nào để giữ chuỗi gốc (ca F1c cũ)
    const w = canhBaoMa(j);
    expect(w).toHaveLength(1);
    expect(w[0]!.row).toBe(0);
    expect(w[0]!.error).toMatch(/TẮT/);
    expect(j.errors.filter((e) => e.error.includes("Mã NV giới thiệu"))).toEqual([]);
    // Client có gửi `nguonChon` khi cờ TẮT ⇒ bị bỏ qua (không lỗi, không attribution).
    expect(await guiD([dong(SDT.x1)], nc(nhom.PAID_ADS))).toMatchObject({ status: 200, success: 1 });
    expect(await attr(SDT.x1)).toBeNull();
  }, CASE);

  it("[XCF-06] D: SĐT ĐÃ CÓ lead ⇒ first-claim: attribution KHÔNG đổi; lựa chọn chỉ ghi vào VẾT (touchpoint NHAP_EXCEL: nhomChonId + người); 2 cảnh báo (mã NV không áp dụng · nguồn chỉ áp lead MỚI)", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    await guiD([dong(SDT.x1)], nc(nhom.PAID_ADS)); // lead gốc: quảng cáo
    const truoc = (await attr(SDT.x1))!;
    const j = await guiD([dong(SDT.x1, { ma: "EMNV.NV.001" })], nc(nhom.EMPLOYEE_REFERRAL, { employeeId: nv.employeeId }));
    expect(j).toMatchObject({ status: 200, success: 0, updated: 1, skipped: 1, successWithReview: 0 });
    const sau = (await attr(SDT.x1))!;
    expect(sau.groupId).toBe(truoc.groupId);
    expect(sau.referrerEmployeeId).toBeNull();
    expect(sau.attributedAt).toEqual(truoc.attributedAt);
    const tp = await db.leadTouchpoint.findMany({ where: { leadId: sau.leadId } });
    expect(tp.map((t) => t.kind)).toEqual(["NHAP_EXCEL"]);
    expect(tp[0]!.signals).toMatchObject({ nhomChonId: nhom.EMPLOYEE_REFERRAL, nguoiGioiThieu: { employeeId: nv.employeeId } });
    const w = (j.warnings ?? []).map((e) => e.error);
    expect(w.some((e) => /Mã NV giới thiệu không áp dụng: SĐT .* đã có lead/.test(e))).toBe(true);
    expect(w.some((e) => /«Nguồn của cả file» chỉ áp cho lead MỚI: 1 lead/.test(e))).toBe(true);
  }, CASE);

  // ══ NGUỒN CỦA CẢ FILE — đường E ═════════════════════════════════════════════════════════════════════════════
  it("[XCF-E1] E: phụ huynh MỚI nhận nguồn đã chọn; hai cột cũ «Nguồn» + «Mã NV giới thiệu» bị bỏ qua (dry-run: `maNvGioiThieuBoQua` loại CHON_NGUON, không `maNvGioiThieuTat`); Lead.source = «Import Excel»", async () => {
    // Cấy: bỏ `nguonChon` khỏi lời gọi `chuanBiQuyNguon` ở route E ⇒ nhãn «Ads» quyết lại ⇒ PAID_ADS thay vì nguồn chọn ⇒ đỏ.
    const nv = await dungNhanVien("EMNV.NV.001");
    const f = fileDangKy([
      { ten: `${P}Bé X1`, sdt: SDT.x1, nguon: "Ads", ma: "EMNV.NV.001" },
      { ten: `${P}Bé X2`, sdt: SDT.x2, nguon: "Chị Lan 0905123456 giới thiệu", ma: "EMNV.NV.404" },
      { ten: `${P}Bé X3`, sdt: SDT.x3, nguon: "", ma: "" },
    ]);
    const chon = nc(nhom.EMPLOYEE_REFERRAL, { employeeId: nv.employeeId });
    const dry = await goiE(f, "dry-run", chon);
    expect(dry.data.maNvGioiThieuTat).toBe(false);
    expect(dry.data.maNvGioiThieuBoQua.map((r) => r.loai).sort()).toEqual(["CHON_NGUON", "CHON_NGUON"]); // hai phụ huynh có mã; phụ huynh thứ ba để trống
    const conf = await goiE(f, "confirm", chon);
    expect(conf.data.daTaoLead).toBe(3);
    for (const s of [SDT.x1, SDT.x2, SDT.x3]) {
      const a = (await attr(s))!;
      expect(a, s).toMatchObject({ matchedRule: "CHON_NGUON", referrerKind: "EMPLOYEE", referrerEmployeeId: nv.employeeId, referrerMissing: false });
      expect(a.group.code, s).toBe("EMPLOYEE_REFERRAL");
      expect(sig(a).xemTay ?? [], s).not.toContain("NHAN_NGUON_LA");
      expect((await theoSdt(s))!.source, s).toBe("Import Excel");
      expect(await trongHangCho(a.leadId), s).toBe(false);
    }
    expect(sig((await attr(SDT.x2))!).nhanGoc, "chuỗi gốc là VẾT").toBe("Chị Lan 0905123456 giới thiệu");
  }, CASE);

  it("[XCF-E2] E: phụ huynh ĐÃ CÓ lead ⇒ gộp, nguồn gốc giữ nguyên (lựa chọn không đổi attribution); phụ huynh mới cùng file nhận nguồn chọn", async () => {
    await guiD([dong(SDT.x4)], nc(nhom.WALK_IN)); // lead có sẵn: WALK_IN
    const goc = (await attr(SDT.x4))!;
    const f = fileDangKy([
      { ten: `${P}Bé X4`, sdt: SDT.x4 },
      { ten: `${P}Bé X5`, sdt: SDT.x5 },
    ]);
    const conf = await goiE(f, "confirm", nc(nhom.PAID_ADS));
    expect(conf.data.daTaoLead).toBe(1);
    expect(conf.data.daGopLead).toBe(1);
    expect((await attr(SDT.x4))!.groupId).toBe(goc.groupId); // first-claim
    expect((await attr(SDT.x5))!.group.code).toBe("PAID_ADS");
  }, CASE);

  it("[XCF-E3] E: THIẾU nguồn ở CẢ xem thử lẫn ghi thật ⇒ 400 NGUON_CA_FILE + 0 lead; xem thử ĐO THEO lựa chọn (nguồn không ghi được ⇒ 400 ngay ở xem thử); khoá `nguonChon` hỏng (JSON sai) ⇒ 400", async () => {
    const f = fileDangKy([{ ten: `${P}Bé X6`, sdt: SDT.x6 }]);
    for (const mode of ["dry-run", "confirm"] as const) {
      const r = await registeredPost(reqE(f, mode));
      expect(r.status, mode).toBe(400);
      const j = (await r.json()) as { ok: boolean; error: { code: string; message: string } };
      expect(j.error.code).toBe("NGUON_CA_FILE");
      expect(j.error.message).toBe(CAU_THIEU_NGUON_CA_FILE);
    }
    const hongJson = await registeredPost(reqE(f, "confirm", "{khong-phai-json"));
    expect(hongJson.status).toBe(400);
    expect(await theoSdt(SDT.x6)).toBeNull();

    // Nguồn đòi người mà thiếu người ⇒ xem thử đã từ chối (không để người nhập thấy «sẽ ghi 1» rồi mới bị chặn lúc ghi).
    const thieuNguoi = await registeredPost(reqE(f, "dry-run", nc(nhom.EMPLOYEE_REFERRAL)));
    expect(thieuNguoi.status).toBe(400);
    expect(await theoSdt(SDT.x6)).toBeNull();
    // Đối chứng dương: nguồn hợp lệ ⇒ xem thử rồi ghi đều qua.
    expect((await goiE(f, "dry-run", nc(nhom.WALK_IN))).ok).toBe(true);
    expect((await goiE(f, "confirm", nc(nhom.WALK_IN))).data.daTaoLead).toBe(1);
  }, CASE);

  // ══ Phần của route KHÔNG phụ thuộc nguồn ═════════════════════════════════════════════════════════════════════
  it("[EMNV-D12] cột Sale phụ trách gõ sai ⇒ lead VẪN tạo; câu cảnh báo nằm ở `warnings`, không phải `errors`", async () => {
    // Cùng lớp lỗi với việc đẩy cảnh báo vào `errors`: câu "Không tìm thấy sale…" vốn mang tiền tố ⚠️ trong `errors`.
    const j = await guiD([{ ...dong(SDT_D12), [LEAD_IMPORT_SALE_HEADER]: "khong.ai.ten.nay@example.test" }]);
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
    const j = await guiD([dongCoSale(SDT_D13.ngoai, { coSo: "CS2" }), dongCoSale(SDT_D13.ok)]);
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

  it("[EMNV-D14] SĐT đang thuộc lead CƠ SỞ KHÁC (gộp chéo bị từ chối) + ô mã NV có chữ ⇒ đúng 1 Lỗi, KHÔNG cảnh báo về mã NV / «chỉ áp lead MỚI»", async () => {
    // Cấy: đẩy cảnh báo 'không áp dụng' về trước cổng `passesScope` của nhánh gộp ⇒ có 1 cảnh báo cho dòng không được ghi.
    const cs2 = await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    await db.lead.create({ data: { parentName: `${P}Lead CS2 D14`, phone: bienThe(SDT_D13.trung)[1]!, centerId: cs2.id, status: "MOI" as never, source: "Website" } });
    await dungSaleCs1();
    const j = await guiD([dongCoSale(SDT_D13.trung, { ma: "EMNV.NV.999" })]);
    expect(j.success).toBe(0);
    expect(j.errors).toHaveLength(1);
    expect(j.errors[0]!.error).toMatch(/cơ sở khác/);
    expect(j.warnings ?? []).toEqual([]);
  }, CASE);

  // ── E ────────────────────────────────────────────────────────────────────────────────────────
  async function dungSaleCs1E(hau: string) {
    const cs1 = await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const email = `${P}sale.cs1.${hau}@example.test`;
    const u = await db.user.create({ data: { name: `${P}SALE CS1 ${hau}`, email, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, isActive: true }, select: { id: true } });
    const ouCs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const vai = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_SALES_CSM" }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ouCs1.id, roleId: vai.id, grantedById: "emnv", effectiveFrom: new Date(Date.now() - 3_600_000) } });
    SESS.current = { user: { id: u.id, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: cs1.id, name: `${P}SALE CS1 ${hau}`, email } };
  }

  it("[EMNV-E4b] đường E: Sale CS1 nhập file có phụ huynh gắn CS2 (ngoài phạm vi) và SĐT đang thuộc lead CS2 ⇒ cả hai bị TRỪ khỏi số sẽ ghi; chỉ 1 lead được tạo", async () => {
    // Cấy: bỏ `scopeRejected` hoặc `mergeRejected` khỏi `khongDuocGhi` ⇒ màn xem thử vẫn đếm họ là "sẽ ghi".
    const cs2 = await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    await dungSaleCs1E("e4b");
    // SĐT đã nằm ở lead của CS2 ⇒ người CS1 không gộp được.
    await db.lead.create({ data: { parentName: `${P}Lead CS2`, phone: bienThe(SDT_E4.trung)[1]!, centerId: cs2.id, status: "MOI" as never, source: "Website" } });
    const f = fileDangKy([
      { ten: `${P}Bé Ổn`, sdt: SDT_E4.ok },
      { ten: `${P}Bé Ngoài`, sdt: SDT_E4.ngoai, coSo: "CS2: Hoàng Diệu" },
      { ten: `${P}Bé Trùng`, sdt: SDT_E4.trung },
    ]);
    type KqSo = { data: { phuHuynh: number; hocVien: number; phuHuynhSeGhi: number; hocVienSeGhi: number; ngoaiPhamVi: unknown[]; trungCoSoKhac: unknown[]; daTaoLead: number } };
    const dry = (await (await registeredPost(reqE(f, "dry-run", nc(nhom.WALK_IN)))).json()) as KqSo;
    expect(dry.data.ngoaiPhamVi).toHaveLength(1);
    expect(dry.data.trungCoSoKhac).toHaveLength(1);
    expect(dry.data.phuHuynh).toBe(3);
    expect(dry.data.phuHuynhSeGhi).toBe(1);
    expect(dry.data.hocVienSeGhi).toBe(1);
    const conf = (await (await registeredPost(reqE(f, "confirm", nc(nhom.WALK_IN)))).json()) as KqSo;
    expect(conf.data.daTaoLead).toBe(1);
  }, CASE);

  it("[EMNV-E4] đường E: file 2 phụ huynh / 3 học viên, 1 phụ huynh (2 con) bị TRỪ (ngoài phạm vi) ⇒ `phuHuynh`=2 `hocVien`=3 (trong file) nhưng `phuHuynhSeGhi`=1 `hocVienSeGhi`=1; confirm tạo đúng 1 lead; đối chứng dương: người nhập Hội sở ⇒ số 'sẽ ghi' = số trong file", async () => {
    // Cấy: tính `*SeGhi` bằng tổng chứ không trừ phụ huynh không được ghi ⇒ màn xem thử đếm 2 phụ huynh / 3 học viên mà chỉ 1 / 1 được tạo.
    // (Trước 28/10/2026 phụ huynh bị trừ là dòng «nguồn lạ ở cơ sở ép chọn»; nay không còn dòng nào bị chặn vì nguồn — lý do trừ còn lại là phạm vi cơ sở.)
    const phienHoSo = SESS.current;
    await dungSaleCs1E("e4");
    const f = fileDangKy([
      { ten: `${P}Bé Ngoài 1`, sdt: SDT_E4.chan, coSo: "CS2: Hoàng Diệu" },
      { ten: `${P}Bé Ngoài 2`, sdt: SDT_E4.chan, coSo: "CS2: Hoàng Diệu" },
      { ten: `${P}Bé Ổn`, sdt: SDT_E4.ok },
    ]);
    type KqSo = { data: { phuHuynh: number; hocVien: number; phuHuynhSeGhi: number; hocVienSeGhi: number; ngoaiPhamVi: { sdt: string }[]; canKiemTra: { sdt: string }[]; daTaoLead: number; daTaoHocVien: number } };
    const dry = (await (await registeredPost(reqE(f, "dry-run", nc(nhom.WALK_IN)))).json()) as KqSo;
    expect(dry.data.ngoaiPhamVi).toHaveLength(1);
    expect(dry.data.phuHuynh).toBe(2);
    expect(dry.data.hocVien).toBe(3);
    expect(dry.data.phuHuynhSeGhi).toBe(1);
    expect(dry.data.hocVienSeGhi).toBe(1);
    // "Cần kiểm tra" chỉ gồm phụ huynh SẼ GHI. (Đối chứng dương: dòng của phụ huynh ổn có mặt.)
    expect(dry.data.canKiemTra.some((w) => w.sdt.includes(SDT_E4.ok.slice(1)))).toBe(true);
    expect(dry.data.canKiemTra.some((w) => w.sdt.includes(SDT_E4.chan.slice(1)))).toBe(false);
    const conf = (await (await registeredPost(reqE(f, "confirm", nc(nhom.WALK_IN)))).json()) as KqSo;
    expect(conf.data.daTaoLead).toBe(conf.data.phuHuynhSeGhi); // số "sẽ ghi" nói thật: đúng bằng số lead tạo ra
    expect(conf.data.daTaoHocVien).toBe(conf.data.hocVienSeGhi);

    // Đối chứng dương: Hội sở thấy cả hai cơ sở ⇒ không ai bị trừ ⇒ số "sẽ ghi" = số trong file.
    SESS.current = phienHoSo;
    await db.lead.deleteMany({ where: { phone: { in: [SDT_E4.chan, SDT_E4.ok].flatMap(bienThe) } } });
    const dry2 = (await (await registeredPost(reqE(f, "dry-run", nc(nhom.WALK_IN)))).json()) as KqSo;
    expect(dry2.data.ngoaiPhamVi).toHaveLength(0);
    expect(dry2.data.phuHuynhSeGhi).toBe(dry2.data.phuHuynh);
    expect(dry2.data.hocVienSeGhi).toBe(dry2.data.hocVien);
  }, CASE);

  it("[EMNV-E5] đường E: tổng đã thu (doiChung) + nghiTrung chỉ tính phụ huynh SẼ GHI — phụ huynh bị TRỪ (ngoài phạm vi) không lọt vào hai khối đó; mã NV trên dòng bị trừ không sinh câu 'bỏ qua'", async () => {
    // Cấy: lặp `parsed.parents` (thay vì `phuHuynhSeGhi`) ở `doiChung` / `nghiTrung` ⇒ "khớp sổ quỹ" tính cả tiền của dòng KHÔNG được ghi.
    const phienHoSo = SESS.current;
    await dungSaleCs1E("e5");
    const f = fileDangKy([
      { ten: `${P}Nguyễn Ngọc Quân`, sdt: SDT_E4.chan, coSo: "CS2: Hoàng Diệu", ma: "EMNV.NV.999", hocPhi: 4_000_000 },
      { ten: `${P}Quân`, sdt: SDT_E4.chan, coSo: "CS2: Hoàng Diệu", ma: "EMNV.NV.999", hocPhi: 4_640_000 },
      { ten: `${P}Bé Ổn`, sdt: SDT_E4.ok, hocPhi: 3_000_000 },
    ]);
    type KqDC = { data: { maNvGioiThieuBoQua: { sdt: string }[]; ngoaiPhamVi: unknown[]; doiChung: { daThu: number }; nghiTrung: { sdt: string }[]; phuHuynhSeGhi: number } };
    const dry = (await (await registeredPost(reqE(f, "dry-run", nc(nhom.WALK_IN)))).json()) as KqDC;
    expect(dry.data.ngoaiPhamVi).toHaveLength(1);
    expect(dry.data.phuHuynhSeGhi).toBe(1);
    expect(dry.data.doiChung.daThu).toBe(3_000_000); // chỉ tiền của phụ huynh SẼ GHI
    expect(dry.data.nghiTrung.some((r) => r.sdt.includes(SDT_E4.chan.slice(1)))).toBe(false);
    expect(dry.data.maNvGioiThieuBoQua.some((r) => r.sdt.includes(SDT_E4.chan.slice(1)))).toBe(false);

    // Đối chứng dương: Hội sở ⇒ không ai bị trừ ⇒ tổng đã thu = cả file, cặp Quân/Ngọc Quân bị nghi tách, và mã NV của họ được báo 'không áp dụng'.
    SESS.current = phienHoSo;
    const dry2 = (await (await registeredPost(reqE(f, "dry-run", nc(nhom.WALK_IN)))).json()) as KqDC;
    expect(dry2.data.ngoaiPhamVi).toHaveLength(0);
    expect(dry2.data.doiChung.daThu).toBe(3_000_000 + 4_000_000 + 4_640_000);
    expect(dry2.data.nghiTrung.some((r) => r.sdt.includes(SDT_E4.chan.slice(1)))).toBe(true);
    expect(dry2.data.maNvGioiThieuBoQua.some((r) => r.sdt.includes(SDT_E4.chan.slice(1)))).toBe(true);
  }, CASE);

  it("[EMNV-E6] đường E: file chỉ có SĐT thuộc lead cơ sở khác ⇒ `khongDoi` = 0 (không đếm phụ huynh bị TỪ CHỐI là 'đã import trước đó')", async () => {
    // Cấy: `khongDoi: plan.merges.length - …` (đếm cả `mergeRejected`) ⇒ thẻ in "1 không đổi (đã import trước đó)" cạnh "1 phụ huynh KHÔNG được tạo".
    const cs2 = await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    await dungSaleCs1E("e6");
    await db.lead.create({ data: { parentName: `${P}Lead CS2 E6`, phone: bienThe(SDT_E4.trung)[1]!, centerId: cs2.id, status: "MOI" as never, source: "Website" } });
    const f = fileDangKy([{ ten: `${P}Bé Trùng`, sdt: SDT_E4.trung }]);
    type KqKD = { data: { trungCoSoKhac: unknown[]; khongDoi: number; daGopLead: number; daTaoLead: number } };
    const conf = (await (await registeredPost(reqE(f, "confirm", nc(nhom.WALK_IN)))).json()) as KqKD;
    expect(conf.data.trungCoSoKhac).toHaveLength(1);
    expect(conf.data.daTaoLead).toBe(0);
    expect(conf.data.daGopLead).toBe(0);
    expect(conf.data.khongDoi).toBe(0);
  }, CASE);

  // ══ PHẦN ĐỌC CỦA LÕI MÃ NV (dữ liệu CŨ) — dựng bằng `taoLeadVoiMaNv` ═════════════════════════════════════════
  it("[EMNV-D1] (lõi) nhãn Nguồn TRỐNG + mã đúng (chữ thường) ⇒ nhóm nhân sự giới thiệu, đúng NGƯỜI, đủ ảnh chụp", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    await taoLeadVoiMaNv(SDT.d1, ["emnv.nv.001"]);
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

  it("[EMNV-D3] (lõi) nhãn 'Ads' + mã ⇒ KHÔNG ÉP NGUỒN: vẫn PAID_ADS, referrerEmployeeId NULL, nhãn mâu thuẫn vào hàng chờ", async () => {
    await dungNhanVien("EMNV.NV.001");
    await taoLeadVoiMaNv(SDT.d3, ["EMNV.NV.001"], { nhan: "Ads" });
    const a = (await attr(SDT.d3))!;
    expect(a.group.code).toBe("PAID_ADS");
    expect(a.referrerEmployeeId).toBeNull();
    expect(a.referrerKind).toBeNull();
    // Hướng F: nhãn MÂU THUẪN giữ nhóm theo nhãn, KHÔNG «thiếu người» (nhóm quảng cáo không cần người), nhưng mã người nhập gõ KHÔNG biến mất và lead vào hàng chờ.
    expect(a.referrerMissing).toBe(false);
    expect(sig(a)).toMatchObject({ coXemTay: true, xemTay: [MA_SAI], maNvSai: { loai: "NHAN_MAU_THUAN" } });
    expect(await trongHangCho(a.leadId)).toBe(true);
  }, CASE);

  it("[EMNV-D4] (lõi) ô chứa TÊN đầy đủ của nhân viên (không phải mã) ⇒ KHÔNG khớp theo tên; lead vào nhóm nhân sự THIẾU NGƯỜI + xem tay (KHÔNG còn UNKNOWN)", async () => {
    // Luật cũ (ghim tới 10/10): «nhãn trống + mã không dùng được ⇒ UNKNOWN» — mã người nhập gõ MẤT, hàng chờ chỉ thấy «chưa rõ nguồn». Đảo 11/10/2026 (hướng F).
    await dungNhanVien("EMNV.NV.001", { fullName: "EMNV Nguyễn Văn Sale" });
    await taoLeadVoiMaNv(SDT.d4, ["EMNV Nguyễn Văn Sale"]);
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

  it("[EMNV-D5] (lõi) mã không tồn tại / nhân sự đã nghỉ ⇒ KHÔNG ghi người, mỗi lead một lý do riêng, nằm hàng chờ (xem tay)", async () => {
    await dungNhanVien("EMNV.NV.002", { status: "RESIGNED" });
    await taoLeadVoiMaNv(SDT.d5, ["EMNV.NV.999"]);
    await taoLeadVoiMaNv(SDT.d5b, ["EMNV.NV.002"]);
    const khong = (await attr(SDT.d5))!;
    const nghi = (await attr(SDT.d5b))!;
    for (const a of [khong, nghi]) {
      expect(a.referrerEmployeeId).toBeNull();
      expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
      expect(a.referrerMissing).toBe(true);
      expect(sig(a).xemTay).toEqual([MA_SAI]);
      expect(await trongHangCho(a.leadId)).toBe(true);
    }
    expect(sig(khong).maNvSai?.loai).toBe("KHONG_TON_TAI");
    expect(sig(nghi).maNvSai?.loai).toBe("DA_NGHI");
  }, CASE);

  it("[EMNV-D16] (lõi) SĐT phụ huynh DÁN NHẦM vào ô «Mã NV» (mọi dạng viết) ⇒ vẫn vào hàng chờ với dấu «mã sai», nhưng KHÔNG SĐT nào lọt vào signals; mã dạng NV chưa tồn tại thì vẫn hiện", async () => {
    // Cấy: bỏ cổng đọc `canViewPii` (luôn trả raw) ⇒ khẳng định «KHÔNG quyền ⇒ không SĐT» đỏ; bỏ lưu raw ⇒ khẳng định «raw = chữ người gõ» đỏ; đối chứng dương (mã dạng NV) vẫn xanh nên không thể xanh nhờ «chặn tất».
    await taoLeadVoiMaNv(SDT.p1, ["0905123456"]);
    await taoLeadVoiMaNv(SDT.p2, ["0905.123.456"]);
    await taoLeadVoiMaNv(SDT.p3, ["EMNV.NV.998"]);
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

  it("[EMNV-D8] (lõi) nhiều dòng cùng SĐT: cùng mã ⇒ người đó; mã KHÁC nhau ⇒ không lấy mã nào (không phụ thuộc thứ tự dòng)", async () => {
    const a1 = await dungNhanVien("EMNV.NV.001");
    await dungNhanVien("EMNV.NV.003");
    await taoLeadVoiMaNv(SDT.d8a, ["EMNV.NV.001", "emnv.nv.001"], { ten: `${P}Nhà A` });
    const okAttr = (await attr(SDT.d8a))!;
    expect(okAttr.referrerEmployeeId).toBe(a1.employeeId);
    expect(okAttr.referrerMissing).toBe(false); // đối chứng dương: cùng mã ⇒ KHÔNG xem tay
    expect(sig(okAttr).maNvSai).toBeUndefined();

    await taoLeadVoiMaNv(SDT.d8b, ["EMNV.NV.001", "EMNV.NV.003"], { ten: `${P}Nhà B` });
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

  it("[EMNV-D10] (lõi) hai nhân viên cùng MỘT mã sau chuẩn hoá ('EMNV.NV.002' và 'NV.EMNV.002') ⇒ mơ hồ: không ghi người", async () => {
    await dungNhanVien("EMNV.NV.002");
    await dungNhanVien("NV.EMNV.002");
    await taoLeadVoiMaNv(SDT.d10, ["EMNV.NV.002"]);
    const a = (await attr(SDT.d10))!;
    expect(a.referrerEmployeeId).toBeNull(); // không đoán một trong hai người
    expect(a.group.code).toBe("EMPLOYEE_REFERRAL");
    expect(a.referrerMissing).toBe(true);
    expect(sig(a)).toMatchObject({ xemTay: [MA_SAI], maNvSai: { loai: "MO_HO" } });
    expect(await trongHangCho(a.leadId)).toBe(true);
  }, CASE);

  // ══ HƯỚNG F (11/10/2026) — MÃ NV GIỚI THIỆU SAI: phần đọc / resolve / engine ═════════════════════════════════
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

  it("[MNR-D1] (lõi) nhãn rỗng + mã SAI ⇒ nhóm nhân sự + THIẾU NGƯỜI + xem tay, KHÔNG UNKNOWN; đối chứng dương: không mã ⇒ UNKNOWN, mã ĐÚNG ⇒ có người và không xem tay", async () => {
    // Cấy: bỏ luật NV_GIOI_THIEU_SAI khỏi THU_TU_LUAT_MAC_DINH ⇒ dòng mã sai rơi UNKNOWN (đúng lỗi cũ) ⇒ ba khẳng định đầu đỏ.
    const nv = await dungNhanVien("EMNV.NV.001");
    await taoLeadVoiMaNv(SDT.m1, ["EMNV.NV.404"]);
    await taoLeadVoiMaNv(SDT.m2, [null]);
    await taoLeadVoiMaNv(SDT.m3, ["EMNV.NV.001"]);

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

  it("[MNR-D2] (lõi) engine hoa hồng: mã SAI ⇒ vai REFERRER_EMPLOYEE bị TREO THIEU_NGUOI_GIOI_THIEU (không sinh dòng 2%); đối chứng dương: mã ĐÚNG ⇒ CO_NGUOI", async () => {
    // Cấy: ghi `referrerEmployeeId` = người nhập khi mã sai ⇒ engine có người ⇒ ca đỏ. Cấy: bỏ `referrerMissing` ⇒ vẫn TREO nhưng [MNR-D1] đỏ (hai cổng canh hai tầng).
    const nv = await dungNhanVien("EMNV.NV.001");
    await taoLeadVoiMaNv(SDT.m4, ["EMNV.NV.404"]);
    await taoLeadVoiMaNv(SDT.m5, ["EMNV.NV.001"]);
    expect(phanGiaiNguoiHuong(VAI_NV_GT, await nguCanhTuQuyNguon(SDT.m4))).toMatchObject({ loai: "TREO", lyDo: "THIEU_NGUOI_GIOI_THIEU" });
    const co = phanGiaiNguoiHuong(VAI_NV_GT, await nguCanhTuQuyNguon(SDT.m5));
    expect(co.loai).toBe("CO_NGUOI");
    const user = await db.user.findFirstOrThrow({ where: { employeeId: nv.employeeId }, select: { id: true } });
    if (co.loai === "CO_NGUOI") expect(co.nguoi).toEqual([{ kind: "USER", id: user.id }]);
  }, CASE);

  it("[EMNV-D17] (lõi) §22: chuỗi gốc + ứng viên xung đột + lý do hiện đủ cho người CÓ quyền PII — qua hàng chờ lẫn sheet gán nguồn; người KHÔNG có quyền: dữ liệu server trả về KHÔNG chứa chữ số nào của SĐT", async () => {
    // Cấy: bỏ cổng `canViewPii ? ` ở `docMaNvSai` (luôn trả raw) ⇒ nửa "KHÔNG quyền" đỏ; trả raw = null cho mọi người ⇒ nửa "CÓ quyền" đỏ. Hai nửa cùng ca nên cổng không thể "xanh vì chặn tất".
    await dungNhanVien("EMNV.NV.001");
    await dungNhanVien("EMNV.NV.003");
    await taoLeadVoiMaNv(SDT.m9, [" 0905.123.456 "]); // SĐT dán nhầm (có khoảng trắng đầu/cuối)
    await taoLeadVoiMaNv(SDT.m10, ["emnv.nv.001", "0912 345 678"], { ten: `${P}Nhà xung đột` }); // KHÁC mã: một mã thật + một SĐT
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

  it("[EMNV-D19] (lõi) vòng 7: ô «Nguồn» của Excel là CHỮ TỰ DO — SĐT/tên gõ vào đó (và giải trình) lưu nguyên văn nhưng KHÔNG hiện cho người không có leads:view-pii, qua hàng chờ lẫn sheet gán nguồn", async () => {
    // Probe thật của reviewer: ô Nguồn = 'Chị Lan 0905123456 giới thiệu' ⇒ `signals.nhanGoc` nguyên văn + NHAN_NGUON_LA ⇒ vào hàng chờ ⇒ mở bằng vai KHÔNG có leads:view-pii.
    // Cấy: nối lại `nhanGoc: nhanGocTu(a.signals)` (bỏ docNhanGoc) ở doc-hang-cho.ts ⇒ nửa «hàng chờ» đỏ; `giaiTrinh: chuoi(a.otherSourceNote)` ở doc-gan-nguon.ts ⇒ nửa «sheet» đỏ;
    // docNhanGoc/docGiaiTrinh luôn trả «đã ẩn» ⇒ nửa «CÓ quyền» đỏ (hai nửa cùng ca nên cổng không thể xanh vì chặn tất).
    // 28/10/2026: hiện trường dựng bằng `taoLeadVoiMaNv` (nhãn lạ KHÔNG còn đi vào được từ route khi cờ BẬT — lead CŨ trên prod/test vẫn mang chuỗi này, và phía ĐỌC phải tiếp tục che chúng).
    const NHAN_PII = "Chị Lan 0905123456 giới thiệu";
    const GIAI_TRINH_PII = "Cô Hoa (mẹ bé Bin) 0912 345 678 nhờ giới thiệu";
    await taoLeadVoiMaNv(SDT.m14, [null], { nhan: NHAN_PII, ten: `${P}Chị Lan` });
    const a = (await attr(SDT.m14))!;
    expect(sig(a).xemTay, "tiền đề: nhãn lạ ⇒ xem tay NHAN_NGUON_LA").toContain("NHAN_NGUON_LA");
    expect((a.signals as { nhanGoc?: string }).nhanGoc, "tiền đề: chuỗi gốc được LƯU nguyên văn (người có quyền cần nó để duyệt)").toBe(NHAN_PII);
    await db.leadAttribution.update({ where: { id: a.id }, data: { otherSourceNote: GIAI_TRINH_PII } }); // giải trình nhóm «Khác» — phía ĐỌC là thứ được đo ở đây
    // F1 (19/10/2026): đường GHI không chép chuỗi tự do vào `Lead.source` (nhãn ngoài 28 nhãn ⇒ «Import Excel»). Nhưng dòng lead CŨ trên prod còn mang chuỗi tự do ở `Lead.source`,
    // và phía ĐỌC (`docDuongVao`) phải tiếp tục che chúng — nên giả lập đúng một dòng cũ (ghi thẳng cột) rồi mới đo phía đọc. KHÔNG gỡ nửa này.
    expect((await db.lead.findUniqueOrThrow({ where: { id: a.leadId }, select: { source: true } })).source, "F1: đường ghi mới KHÔNG chép chuỗi tự do vào Lead.source").toBe("Import Excel");
    await db.lead.update({ where: { id: a.leadId }, data: { source: NHAN_PII } }); // giả lập lead CŨ (trước F1)

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
    // ĐƯỜNG VÀO (`Lead.source`): lead CŨ mang nguyên văn ô «Nguồn» ở đó ⇒ cùng một luật (probe này TÌM RA lỗ — reviewer chỉ nêu nhanGoc/giaiTrinh).
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

  it("[EMNV-D18] (lõi) §22: resolve chọn Employee thật ⇒ snapshot nhân viên + attribution resolve; chuỗi gốc còn làm VẾT nhưng KHÔNG hiện lại (kể cả cho người có quyền)", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    await taoLeadVoiMaNv(SDT.m11, ["Nguyễn Thị Huệ (anh Tư)"]); // gõ TÊN thay vì mã
    const truoc = (await attr(SDT.m11))!;
    expect(sig(truoc).maNvSai!.raw).toBe("Nguyễn Thị Huệ (anh Tư)");
    const actor = capKhoaGhiNguon({
      userId: "u-d18", isSuperAdmin: false, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [],
      grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
    } as Actor);
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

  it("[MNR-D3] (lõi) RESOLVE: người duyệt chọn người ⇒ BO_SUNG_NGUOI, hết thiếu người + hết xem tay + RỜI hàng chờ, engine thấy người; vết mã sai KHÔNG còn hiện như đang chờ", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    await taoLeadVoiMaNv(SDT.m6, ["EMNV.NV.404"]);
    const truoc = (await attr(SDT.m6))!;
    expect(await trongHangCho(truoc.leadId)).toBe(true);

    const actor = capKhoaGhiNguon({
      userId: "u-mnr", isSuperAdmin: false, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [],
      grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
    } as Actor);
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

  // ══ C1b — F4: mã NV HỢP LỆ nhưng nhóm «nhân sự giới thiệu» mặc định đã tắt ═════════════════════════════════
  it("[EMNV-F4] (lõi) mã ĐÚNG + nhóm nhân sự mặc định TẮT ⇒ UNKNOWN + EMPLOYEE_REFERRAL_SOURCE_INACTIVE + người ở signals.nguoiGioiThieuChoDuyet, KHÔNG cột người giới thiệu, engine hoa hồng KHÔNG ra người, vào hàng chờ; đối chứng dương: nhóm đang chạy ⇒ ghi người như cũ", async () => {
    const nv = await dungNhanVien("EMNV.NV.001");
    // đối chứng dương TRƯỚC: nhóm đang chạy ⇒ người ĐƯỢC ghi, không dấu F4
    await taoLeadVoiMaNv(SDT.f4a, ["EMNV.NV.001"]);
    const a0 = (await attr(SDT.f4a))!;
    expect(a0.referrerEmployeeId).toBe(nv.employeeId);
    expect(sig(a0).xemTay ?? []).not.toContain("EMPLOYEE_REFERRAL_SOURCE_INACTIVE");
    expect((a0.signals as { nguoiGioiThieuChoDuyet?: unknown }).nguoiGioiThieuChoDuyet).toBeUndefined();

    await db.leadSourceGroup.update({ where: { code: "EMPLOYEE_REFERRAL" }, data: { status: "INACTIVE" } });
    clearSettingsCache();
    try {
      await taoLeadVoiMaNv(SDT.f4b, ["EMNV.NV.001"]);
      const a = (await attr(SDT.f4b))!;
      expect(a.group.code, "fail-closed: không ghi vào nguồn đã tắt").toBe("UNKNOWN");
      expect(sig(a).xemTay).toContain("EMPLOYEE_REFERRAL_SOURCE_INACTIVE");
      expect(sig(a).coXemTay).toBe(true);
      // người giới thiệu VẪN được ghi để người duyệt thấy…
      expect((a.signals as { nguoiGioiThieuChoDuyet?: { employeeId: string; employeeCode: string | null } }).nguoiGioiThieuChoDuyet).toEqual({ employeeId: nv.employeeId, employeeCode: "EMNV.NV.001" });
      // …nhưng KHÔNG ở cột mà hoa hồng đọc
      expect(a).toMatchObject({ referrerEmployeeId: null, referrerKind: null });
      expect(await trongHangCho(a.leadId)).toBe(true);
      // …và NGƯỜI DUYỆT thấy người đó ở hàng chờ (đường đọc thật `docHangChoNguon`, không dựng tay)
      const actorHo = { userId: "u-f4", isSuperAdmin: false, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as Actor;
      const hang = await docHangChoNguon(actorHo, { coSoId: null, lyDo: "XEM_TAY", trang: 1, now: new Date("2026-10-19T03:00:00.000Z"), canViewPii: false });
      expect(hang.dong.find((d) => d.leadId === a.leadId)!.nguoiChoDuyet).toEqual({ employeeCode: "EMNV.NV.001" });
      // engine hoa hồng dựng từ dòng ĐÃ GHI: KHÔNG ra người (không sinh hoa hồng cho nguồn chưa ai duyệt)
      expect(phanGiaiNguoiHuong(VAI_NV_GT, await nguCanhTuQuyNguon(SDT.f4b)).loai).not.toBe("CO_NGUOI");
      // mã SAI cùng lúc: dấu «mã sai» vẫn là của nó, dấu F4 KHÔNG xuất hiện (không có người hợp lệ nào bị bỏ)
      await taoLeadVoiMaNv(SDT.f4c, ["EMNV.NV.404"]);
      const sai = (await attr(SDT.f4c))!;
      expect(sig(sai).xemTay).toContain(MA_SAI);
      expect(sig(sai).xemTay).not.toContain("EMPLOYEE_REFERRAL_SOURCE_INACTIVE");
      // nhãn «Ads» + mã đúng ⇒ NHAN_MAU_THUAN (không phải người hợp lệ bị bỏ): không dấu F4
      await taoLeadVoiMaNv(SDT.f4d, ["EMNV.NV.001"], { nhan: "Ads" });
      expect(sig((await attr(SDT.f4d))!).xemTay ?? []).not.toContain("EMPLOYEE_REFERRAL_SOURCE_INACTIVE");
    } finally {
      await db.leadSourceGroup.update({ where: { code: "EMPLOYEE_REFERRAL" }, data: { status: "ACTIVE" } });
      clearSettingsCache();
    }
  }, CASE);
});
