// lib/uat/nguon-final.ts — BỘ DỮ LIỆU UAT "UAT SOURCE FINAL" (lane C2 · mục 7): fixture TEST đại diện cho mọi loại nguồn + hai hàng chờ + ba tài khoản. THUẦN (không DB, không env, không đồng hồ).
//
// MỘT nguồn cho ba nơi: (1) `nguon-final-db.ts` / `nguon-final-lead-cu.ts` dựng dữ liệu theo đây; (2) `prisma/seed-uat/00-tai-khoan.ts` khai ba tài khoản cùng email; (3) lưới `nguon-final.test.ts` +
// `tests/hoa-hong/uat-nguon-final.spec.ts` đo chúng khớp nhau. Sửa một nơi mà quên nơi kia là test đỏ.
//
// KHÔNG nằm trong `KICH_BAN_UAT` (cố ý): checklist 09 ghim con số của bộ S02–S10B (`doc-so-khop.test.ts`) và spec `uat-vi-du-so` đo engine so với `kyVong`; thêm kịch bản vào đó là đổi con số của checklist.
// Dữ liệu ở đây mang tiền tố RIÊNG ("UAT SOURCE FINAL" ở tên hiển thị; "UATSF" ở mã đơn / id / ghi chú khoản thu) — không bắt đầu bằng "UAT-" / "UAT:" nên các phép đếm theo tiền tố của bộ cũ không thấy chúng.
import { MOC_KHAO_SAT_0610, type LyDoXemTay } from "@/lib/nguon/anh-xa-nhan-cu";

/** Tên hiển thị của mọi bản ghi do bộ này dựng (tên lead, tên nguồn, tên học viên). */
export const TIEN_TO_NGUON_FINAL = "UAT SOURCE FINAL";
/** Tiền tố của mã đơn / id / ghi chú khoản thu. KHÔNG được bắt đầu bằng `UAT-` hay `UAT:` (bộ cũ đếm theo hai tiền tố đó). */
export const MA_NGUON_FINAL = "UATSF";

/** Ba tài khoản UAT của lane này. Email khớp `prisma/seed-uat/00-tai-khoan.ts` (lưới `[SRC-INT-52]`). `.nguonduyet1` thay vì `.nguon.duyet1`: regex của `[UAT-DOC-04]` chỉ nhận `uat.[a-z0-9]+`. */
export const EMAIL_NGUON_FINAL = {
  /** N1 — người duyệt thứ nhất: HO_ACCOUNTANT neo ở CS1 ⇒ `commission_periods:manage` CHỈ tại CS1. */
  duyet1: "uat.nguonduyet1@satarobo.vn",
  /** N2 — người duyệt thứ hai: như N1, một tài khoản KHÁC (bốn mắt). */
  duyet2: "uat.nguonduyet2@satarobo.vn",
  /** Chỉ-xem: CENTER_ACCOUNTANT neo ở CS1 — thấy sổ/hàng chờ của CS1, KHÔNG có `commission_periods:manage`. */
  xem: "uat.nguonxem@satarobo.vn",
} as const;
export type KhoaTaiKhoanNguonFinal = keyof typeof EMAIL_NGUON_FINAL;

/** Mã vai (RoleDef.code) mà seed tài khoản gán cho từng tài khoản — lưới đối chiếu với seed. KHÔNG đẻ khoá quyền mới: hai vai này đã có trong `prisma/seed-roles.ts`. */
export const VAI_NGUON_FINAL: Record<KhoaTaiKhoanNguonFinal, string> = { duyet1: "HO_ACCOUNTANT", duyet2: "HO_ACCOUNTANT", xem: "CENTER_ACCOUNTANT" };
/** Khoá quyền mà N1/N2 phải giữ tại cơ sở hàng chờ và tài khoản chỉ-xem KHÔNG được giữ. */
export const KHOA_XU_LY_HANG_CHO = "commission_periods:manage";

/** Nguồn tuỳ biến do admin "tạo bằng giao diện" — ở đây dựng bằng `taoNguon` thật. Mã chữ HOA không dấu, tiền tố UAT_SF. */
export const NGUON_TUY_BIEN = { code: "UAT_SF_TUY_BIEN", ten: `${TIEN_TO_NGUON_FINAL} — Nguồn tuỳ biến`, cuaSoNgay: 60 } as const;
/** Giải trình bắt buộc (≥ 10 ký tự) của lead thuộc nhóm OTHER. */
export const GIAI_TRINH_OTHER = `${TIEN_TO_NGUON_FINAL}: nguồn khác dùng để kiểm màn giải trình (không phải khách thật)`;

// ── Lead mới (đã quy nguồn qua đường thật `ghiQuyNguonLeadMoi`) ──────────────────────────────────────────────────────────────────

export type MaLeadMoi = "PAID_ADS" | "PARENT_REFERRAL" | "EMPLOYEE_REFERRAL" | "TUY_BIEN" | "OTHER";
export type LeadMoi = { ma: MaLeadMoi; /** Mã nhóm nguồn mong đợi của `LeadAttribution.group.code`. */ nhom: string; tieuDe: string };

export const LEAD_MOI: readonly LeadMoi[] = [
  { ma: "PAID_ADS", nhom: "PAID_ADS", tieuDe: "Quảng cáo — tín hiệu form quảng cáo ⇒ AD_FORM_CAMPAIGN" },
  { ma: "PARENT_REFERRAL", nhom: "PARENT_REFERRAL", tieuDe: "Phụ huynh giới thiệu — Sale phụ trách phụ huynh được chụp lại lúc ghi nhận" },
  { ma: "EMPLOYEE_REFERRAL", nhom: "EMPLOYEE_REFERRAL", tieuDe: "Nhân sự giới thiệu — nhân sự CS2 (uat.sale2)" },
  { ma: "TUY_BIEN", nhom: NGUON_TUY_BIEN.code, tieuDe: "Nguồn tuỳ biến (admin tạo, có chủ) chọn tay" },
  { ma: "OTHER", nhom: "OTHER", tieuDe: "Nguồn khác có giải trình (≥ 10 ký tự)" },
] as const;

// ── Lead CŨ (nhãn `Lead.source` cũ, CHƯA quy nguồn) — mồi cho lượt «Vét lead cũ» ─────────────────────────────────────────────────────

export type LopLeadCu = "AUTO" | "MANUAL_REVIEW" | "OTHER";
export type LeadCu = {
  ma: LopLeadCu;
  /** Nhãn `Lead.source` NGUYÊN VĂN (nằm trong bảng 28 nhãn đã chốt 06/10/2026 — nhãn lạ ⇒ INVALID và chặn `--apply` của vét lead cũ). */
  nhan: string;
  /** Ngày tạo TUYỆT ĐỐI (luật 19). Nhãn #14 «Nguồn khác» chỉ ra OTHER khi phiếu tạo SAU mốc khảo sát 06/10/2026. */
  taoLuc: Date;
  tieuDe: string;
};

export const LEAD_CU: readonly LeadCu[] = [
  { ma: "AUTO", nhan: "Ads", taoLuc: new Date("2026-10-12T03:00:00.000Z"), tieuDe: "Nhãn «Ads» ⇒ PAID_ADS, không lý do xem tay ⇒ cột AUTO của báo cáo vét lead cũ" },
  { ma: "MANUAL_REVIEW", nhan: "Giới thiệu", taoLuc: new Date("2026-10-12T03:05:00.000Z"), tieuDe: "Nhãn «Giới thiệu» ⇒ PARENT_REFERRAL nhưng nhãn không mang người ⇒ THIEU_NGUOI ⇒ cột MANUAL_REVIEW" },
  { ma: "OTHER", nhan: "Nguồn khác", taoLuc: new Date("2026-10-12T03:10:00.000Z"), tieuDe: "Nhãn «Nguồn khác» tạo sau mốc 06/10 ⇒ nhóm OTHER + NHAN_CHOT_THEO_PHIEU (xem tay)" },
] as const;

/** Mốc mà `taoLuc` của lead cũ phải đứng SAU (nhãn chốt theo phiếu). Phơi ra để lưới kiểm — đổi mốc ở `anh-xa-nhan-cu.ts` mà quên ngày ở đây là test đỏ. */
export const MOC_LEAD_CU_PHAI_SAU = MOC_KHAO_SAT_0610;

// ── Lead CŨ ĐẠI DIỆN — đường TƯỜNG MINH `uat-nap-lead-cu-*` (lane F5, 20/10/2026) ───────────────────────────────────────────────────
// Vì sao có: DB TEST đã ĐẶT MỐC CUTOVER nên bộ nạp chung (`napNguonFinalUat`) BỎ QUA `LEAD_CU` (BO_QUA — đúng, nạp lead chưa quy nguồn SAU bước vét là sai trình tự); hệ quả là TEST không còn lead nào chưa
// quy nguồn để UAT backfill (`vet-lead-cu-*` báo N=0). Đây là bộ lead nhãn cũ cho đúng lượt UAT đó, nạp bằng NÚT RIÊNG, và KHÔNG đổi hành vi bộ nạp chung (`LEAD_CU` ở trên giữ nguyên, SĐT dải `09904`).
// KHÔNG có nhãn nào ngoài bảng 28 nhãn (INVALID > 0 chặn `--apply` của vét lead cũ — «INVALID phải = 0» là cổng, không phải thứ để thử bằng dữ liệu nạp). Ngày tạo TUYỆT ĐỐI (luật 19) và nằm trong QUÁ KHỨ
// so với mọi mốc `--den` hợp lý (muộn nhất 07/10/2026); nhãn «chốt theo phiếu» (#10/#14/#22) cần ngày SAU mốc 06/10 để ra OTHER, ngày TRƯỚC mốc thì ra EMPLOYEE_REFERRAL.
export type LeadCuDaiDien = {
  /** Khoá ổn định của dòng — dùng cho SĐT giả và tên lead. */
  ma: string;
  /** Nhãn `Lead.source` NGUYÊN VĂN (nằm trong bảng 28 nhãn). */
  nhan: string;
  taoLuc: Date;
  /** Mã nhóm gốc mà `anhXaNhanCu` PHẢI ra (lưới `[SRC-INT-79]` đo bằng chính hàm thật). */
  nhom: string;
  /** Lý do xem tay mong đợi; `null` = AUTO (cột AUTO của báo cáo vét lead cũ). */
  xemTay: LyDoXemTay | null;
  tieuDe: string;
};

const T = (s: string): Date => new Date(`${s}.000Z`);

export const LEAD_CU_DAI_DIEN: readonly LeadCuDaiDien[] = [
  // ── AUTO — nhiều loại nhãn, nhiều nhóm đích ─────────────────────────────────────────────────────────────────────────────────────
  { ma: "ADS", nhan: "Ads", taoLuc: T("2026-09-10T03:00:00"), nhom: "PAID_ADS", xemTay: null, tieuDe: "«Ads» ⇒ PAID_ADS" },
  { ma: "LEGACY_SHEET", nhan: "legacy-sheet", taoLuc: T("2026-09-10T03:05:00"), nhom: "PAID_ADS", xemTay: null, tieuDe: "«legacy-sheet» ⇒ PAID_ADS" },
  { ma: "FORM", nhan: "Form", taoLuc: T("2026-09-10T03:10:00"), nhom: "PAID_ADS", xemTay: null, tieuDe: "«Form» ⇒ PAID_ADS" },
  { ma: "QUATANG", nhan: "quatang", taoLuc: T("2026-09-10T03:15:00"), nhom: "PAID_ADS", xemTay: null, tieuDe: "«quatang» không có affiliate ⇒ PAID_ADS (nhánh THEO_AFF)" },
  { ma: "SALE_FORM_CU", nhan: "sale-form", taoLuc: T("2026-09-20T03:00:00"), nhom: "PAID_ADS", xemTay: null, tieuDe: "«sale-form» tạo TRƯỚC 01/10/2026 ⇒ PAID_ADS (nhánh THEO_NGUOI_NHAP cũ)" },
  { ma: "ORGANIC", nhan: "Organic", taoLuc: T("2026-09-10T03:20:00"), nhom: "CENTER_ORGANIC", xemTay: null, tieuDe: "«Organic» ⇒ CENTER_ORGANIC" },
  { ma: "WEBSITE", nhan: "Website", taoLuc: T("2026-09-10T03:25:00"), nhom: "WALK_IN", xemTay: null, tieuDe: "«Website» ⇒ WALK_IN" },
  { ma: "LIEN_HE", nhan: "lien-he", taoLuc: T("2026-09-10T03:30:00"), nhom: "WALK_IN", xemTay: null, tieuDe: "«lien-he» ⇒ WALK_IN" },
  // ── MANUAL_REVIEW — nhóm cần NGƯỜI mà nhãn cũ không mang người (không bao giờ tự gán theo tên trong note) ────────────────────────────────
  { ma: "GIOI_THIEU", nhan: "Giới thiệu", taoLuc: T("2026-09-12T03:00:00"), nhom: "PARENT_REFERRAL", xemTay: "THIEU_NGUOI", tieuDe: "«Giới thiệu» ⇒ PARENT_REFERRAL nhưng thiếu người" },
  { ma: "QL_TRUNG_TAM", nhan: "Quản Lý Trung Tâm", taoLuc: T("2026-09-12T03:05:00"), nhom: "EMPLOYEE_REFERRAL", xemTay: "THIEU_NGUOI", tieuDe: "«Quản Lý Trung Tâm» ⇒ EMPLOYEE_REFERRAL (vai MANAGER) thiếu người" },
  { ma: "SALE_TU_KIEM", nhan: "Sale tự kiếm", taoLuc: T("2026-09-12T03:10:00"), nhom: "EMPLOYEE_REFERRAL", xemTay: "THIEU_NGUOI", tieuDe: "«Sale tự kiếm» ⇒ EMPLOYEE_REFERRAL (vai SALE) thiếu người" },
  { ma: "KHAC_TRUOC_MOC", nhan: "Khác", taoLuc: T("2026-09-25T03:00:00"), nhom: "EMPLOYEE_REFERRAL", xemTay: "THIEU_NGUOI", tieuDe: "«Khác» tạo TRƯỚC mốc 06/10 ⇒ EMPLOYEE_REFERRAL thiếu người" },
  { ma: "SALE_FORM_APP_MOI", nhan: "sale-form-app", taoLuc: T("2026-10-03T03:00:00"), nhom: "OTHER", xemTay: "MA_NV_KHONG_GIAI", tieuDe: "«sale-form-app» từ 01/10/2026 không có mã/ID người nhập ⇒ OTHER + xem tay" },
  // ── OTHER — nhãn kiểu «Khác» tạo SAU mốc 06/10: chưa có đích, xem tay ───────────────────────────────────────────────────────────────
  { ma: "NGUON_KHAC", nhan: "Nguồn khác", taoLuc: T("2026-10-07T03:00:00"), nhom: "OTHER", xemTay: "NHAN_CHOT_THEO_PHIEU", tieuDe: "«Nguồn khác» sau mốc 06/10 ⇒ OTHER + NHAN_CHOT_THEO_PHIEU" },
  { ma: "KHAC_SAU_MOC", nhan: "Khác", taoLuc: T("2026-10-07T03:05:00"), nhom: "OTHER", xemTay: "NHAN_CHOT_THEO_PHIEU", tieuDe: "«Khác» sau mốc 06/10 ⇒ OTHER + NHAN_CHOT_THEO_PHIEU" },
  { ma: "NHAP_TAY_SAU_MOC", nhan: "Nhập tay", taoLuc: T("2026-10-07T03:10:00"), nhom: "OTHER", xemTay: "NHAN_CHOT_THEO_PHIEU", tieuDe: "«Nhập tay» sau mốc 06/10 ⇒ OTHER + NHAN_CHOT_THEO_PHIEU" },
] as const;

/** Lớp của dòng theo cách báo cáo vét lead cũ gọi: AUTO (không lý do xem tay) · OTHER (nhóm OTHER, xem tay) · MANUAL_REVIEW (nhóm cần người nhưng nhãn không mang người). Phân hoạch THẬT của báo cáo gộp OTHER-có-xem-tay vào MANUAL_REVIEW — số M của lệnh ghi = MANUAL_REVIEW + OTHER ở đây. */
export const lopLeadCuDaiDien = (lc: Pick<LeadCuDaiDien, "nhom" | "xemTay">): LopLeadCu => (lc.xemTay === null ? "AUTO" : lc.nhom === "OTHER" ? "OTHER" : "MANUAL_REVIEW");

// ── Hàng chờ do ENGINE THẬT sinh ra ──────────────────────────────────────────────────────────────────────────────────────────────

export type MaHangCho = "DRIFT" | "WITHDRAWN";
export type KichBanHangCho = { ma: MaHangCho; maHold: "INPUT_DRIFT" | "PAYMENT_WITHDRAWN"; soTien: number; ngayTrongKy: number; tieuDe: string };

export const HOC_PHI_NGUON_FINAL = 10_000_000;
export const KICH_BAN_HANG_CHO: readonly KichBanHangCho[] = [
  { ma: "DRIFT", maHold: "INPUT_DRIFT", soTien: HOC_PHI_NGUON_FINAL, ngayTrongKy: 9, tieuDe: "Thu 10tr → engine ghi sổ → người chốt (Sale) bị đổi → quét lại ⇒ INPUT_DRIFT" },
  { ma: "WITHDRAWN", maHold: "PAYMENT_WITHDRAWN", soTien: HOC_PHI_NGUON_FINAL, ngayTrongKy: 11, tieuDe: "Thu 10tr → engine ghi sổ → kế toán TỪ CHỐI khoản thu → quét lại ⇒ PAYMENT_WITHDRAWN" },
] as const;

/**
 * Hàng chờ nằm ở kỳ T + 3 tháng (T = mốc cutover): kỳ T và hai kỳ kế là nơi bộ S02–S10B của checklist 09 đặt khoản thu (S06 rơi vào T+2) — checklist in sẵn "quét 14 khoản / 13 khoản"
 * của kỳ T và kỳ tương ứng, nên khoản của bộ này KHÔNG được rơi cùng kỳ với chúng.
 */
export const SO_THANG_SAU_MOC_HANG_CHO = 3;

const cong = (ky: string, soThang: number): string => {
  const [y, m] = ky.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + soThang;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
export const kyCuaHangCho = (kyCutover: string): string => cong(kyCutover, SO_THANG_SAU_MOC_HANG_CHO);
/** Ngày của khoản thu (03:00 UTC = 10:00 VN: tháng VN trùng tháng UTC). */
export const ngayThuHangCho = (kyCutover: string, kb: Pick<KichBanHangCho, "ngayTrongKy">): Date => new Date(`${kyCuaHangCho(kyCutover)}-${String(kb.ngayTrongKy).padStart(2, "0")}T03:00:00.000Z`);

// ── Mã / SĐT / tên ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** SĐT giả hiếm: `09903NNNNN` lead mới · `09904NNNNN` lead cũ · `09905NNNNN` hàng chờ · `09906NNNNN` lead gốc của phụ huynh giới thiệu · `09907NNNNN` lead cũ ĐẠI DIỆN của đường `uat-nap-lead-cu-*` (bộ cũ dùng `09901` / `09902`). */
const phone = (goc: string, i: number): string => `${goc}${String(i + 1).padStart(5, "0")}`;
export const phoneLeadMoi = (ma: MaLeadMoi): string => phone("09903", LEAD_MOI.findIndex((x) => x.ma === ma));
export const phoneLeadCu = (ma: LopLeadCu): string => phone("09904", LEAD_CU.findIndex((x) => x.ma === ma));
export const phoneLeadCuDaiDien = (ma: string): string => {
  const i = LEAD_CU_DAI_DIEN.findIndex((x) => x.ma === ma);
  if (i < 0) throw new Error(`Lead cũ đại diện lạ: ${ma}`);
  return phone("09907", i);
};
export const phoneHangCho = (ma: MaHangCho): string => phone("09905", KICH_BAN_HANG_CHO.findIndex((x) => x.ma === ma));
export const phonePhGoc = (ma: MaLeadMoi): string => phone("09906", LEAD_MOI.findIndex((x) => x.ma === ma));

export const tenLead = (ma: string): string => `${TIEN_TO_NGUON_FINAL} · ${ma}`;
export const tenLeadCu = (ma: LopLeadCu): string => `${TIEN_TO_NGUON_FINAL} · nhãn cũ ${ma}`;
export const tenLeadCuDaiDien = (ma: string): string => `${TIEN_TO_NGUON_FINAL} · nhãn cũ ${ma}`;
export const maDonHangCho = (ma: MaHangCho): string => `${MA_NGUON_FINAL}-${ma}-DON`;
export const ghiChuKhoanHangCho = (ma: MaHangCho): string => `${MA_NGUON_FINAL}:${ma}:1`;
export const idHocVienHangCho = (ma: MaHangCho): string => `${MA_NGUON_FINAL}-${ma}-hv`;
export const idHocVienPhGoc = (ma: MaLeadMoi): string => `${MA_NGUON_FINAL}-${ma}-hv-ph`;
export const ID_KHOA_NGUON_FINAL = `${MA_NGUON_FINAL}-khoa`;
export const ID_LOP_NGUON_FINAL = `${MA_NGUON_FINAL}-lop`;
export const SLUG_KHOA_NGUON_FINAL = "uatsf-sata3";

// ── Kết quả nạp (dùng chung cho `nguon-final-db.ts` và `nguon-final-lead-cu.ts` — đặt ở tệp thuần để hai tệp không import vòng nhau) ──────────────────────────────────────────

export type TrangThaiMucNf = "DA_CO" | "SE_TAO" | "DA_TAO" | "THIEU" | "BO_QUA";
export type MucNapNf = { nhom: string; ma: string; trangThai: TrangThaiMucNf; ghiChu?: string };
