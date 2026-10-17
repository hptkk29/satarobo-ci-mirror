/**
 * lib/nguon/nhan-hien-thi.ts — CHỮ người đọc của các giá trị kỹ thuật trong quy nguồn. THUẦN.
 *
 * Một chỗ cho khối "Nguồn" trên lead, Sheet "Gán nguồn" và hàng chờ cùng nói MỘT câu về cùng một giá trị. Mã lạ
 * (nhóm admin thêm, lý do PR sau thêm) in nguyên mã thay vì đoán — một nhãn sai nghĩa tệ hơn một nhãn thô.
 */
import type { SourceIdentificationMethod, SourceStatus } from "@prisma/client";
import type { LoaiMaNvSai, LyDoXemTayNguon } from "./tin-hieu";

/** `identificationMethod` → "Cách xác định" (03 §1.2). */
export const NHAN_CACH_XAC_DINH: Readonly<Record<SourceIdentificationMethod, string>> = {
  EXISTING_LEAD: "Kế thừa từ hồ sơ cũ cùng SĐT",
  REFERRAL_CODE: "Mã giới thiệu",
  EVENT_QR: "Mã QR sự kiện",
  PARTNER_CODE: "Mã đối tác",
  AFFILIATE: "Cộng tác viên",
  AD_FORM_CAMPAIGN: "Tín hiệu quảng cáo",
  PAGE_MAPPING: "Page đã gán nguồn",
  EMPLOYEE_REFERRAL: "Nhân sự giới thiệu",
  PARENT_REFERRAL: "Phụ huynh giới thiệu",
  MANUAL: "Người nhập chọn tay",
  SYSTEM_IMPORT: "Nhập từ file Excel",
  SYSTEM_DEFAULT: "Theo đường vào mặc định",
  UNKNOWN: "Chưa xác định được",
};

export function nhanCachXacDinh(m: string): string {
  return (NHAN_CACH_XAC_DINH as Record<string, string>)[m] ?? m;
}

/** Lý do một lead nằm trong hàng chờ xem tay (`signals.xemTay[]`) → câu cho người duyệt. */
export const NHAN_XEM_TAY: Readonly<Record<LyDoXemTayNguon, string>> = {
  THIEU_NGUOI: "Nguồn cần người giới thiệu mà chưa có",
  MA_NV_KHONG_GIAI: "Mã nhân viên trên phiếu không có trong hệ thống",
  AFF_CHUA_PHAN_LOAI: "Có mã giới thiệu nhưng chưa phân loại được đối tác",
  NHAN_CHOT_THEO_PHIEU: "Nhãn nguồn cần xác nhận theo phiếu",
  VAI_SUY_TU_HIEN_TAI: "Nhóm nguồn suy từ vai hiện tại của người nhập",
  NHAN_NGUON_LA: "Nhãn nguồn không có trong danh sách",
  PAGE_CHUA_MAP_NGUON: "Page chưa được gán nguồn",
  THIEU_SALE_PH: "Phụ huynh giới thiệu nhưng chưa xác định Sale phụ trách phụ huynh",
  INVALID_EMPLOYEE_REFERRER_CODE: "Mã nhân viên giới thiệu người nhập gõ không dùng được",
  SDT_NHAN_VIEN: "SĐT khách trùng SĐT nhân viên",
  NGUOI_GT_LA_KHACH: "Người giới thiệu có SĐT trùng khách",
};

export function nhanXemTay(ma: string): string {
  return (NHAN_XEM_TAY as Record<string, string>)[ma] ?? ma;
}

/**
 * VÌ SAO một mã NV giới thiệu không dùng được (`MaNvSai.loai`) → câu cho người duyệt. `Record<LoaiMaNvSai, …>` ⇒ thêm loại ở `tin-hieu.ts` mà quên nhãn là LỖI BIÊN DỊCH.
 * Câu nói NGUYÊN NHÂN, không chỉ «sai»: «mã đã nghỉ» và «hai người cùng mã» được xử lý khác nhau.
 */
export const NHAN_LOAI_MA_NV_SAI: Readonly<Record<LoaiMaNvSai, string>> = {
  KHONG_TON_TAI: "mã không có trong hệ thống",
  MO_HO: "mã khớp nhiều nhân viên",
  DA_NGHI: "nhân sự đã nghỉ",
  KHAC_MA: "các dòng cùng SĐT ghi mã khác nhau",
  NHAN_MAU_THUAN: "nhãn nguồn của dòng không phải nguồn nhân sự giới thiệu",
  LOI_HE_THONG: "lỗi hệ thống khi tra mã",
};

export function nhanLoaiMaNvSai(ma: string): string {
  return (NHAN_LOAI_MA_NV_SAI as Record<string, string>)[ma] ?? ma;
}

/**
 * Chữ HIỂN THỊ của «mã NV người nhập đã gõ» — MỘT chỗ cho cả hàng chờ lẫn trang chi tiết nguồn.
 *  · `raw` (chuỗi gốc, server CHỈ đưa khi người xem có quyền PII) ⇒ in đúng chuỗi người nhập gõ;
 *  · không có `raw` mà `ma` có dạng mã ⇒ in `ma`;
 *  · cả hai null ⇒ thứ họ gõ KHÔNG phải dạng mã nhân viên (có thể là SĐT phụ huynh / tên người): nói THẬT là «đã ẩn» + độ dài (người KHÔNG có quyền), hoặc «chưa lưu chuỗi gốc» (người CÓ quyền
 *    nhưng dòng ghi trước khi hệ thống lưu chuỗi gốc) — không ai che gì với họ nên đừng nói «đã ẩn». Đừng im lặng bỏ dấu «mã sai»: người duyệt vẫn cần biết có một mã sai để mở file gốc xem.
 */
export function nhanMaNvDaGo(m: { ma: string | null; doDai: number; raw?: string | null; coQuyenXem?: boolean }): string {
  if (m.raw) return m.raw;
  if (m.ma) return m.ma;
  const dai = m.doDai > 0 ? `${m.doDai} ký tự, ` : "";
  return m.coQuyenXem === true ? `không phải dạng mã nhân viên (${dai}chưa lưu chuỗi gốc)` : `không phải dạng mã nhân viên (${dai}đã ẩn)`;
}

/** Tiêu đề dòng «mã người nhập đã gõ»: loại `KHAC_MA` là các ỨNG VIÊN xung đột (nhiều dòng cùng SĐT ghi mã khác nhau), không phải một mã. */
export function nhanTieuDeMaNvSai(loai: string): string {
  return loai === "KHAC_MA" ? "Các mã xung đột" : "Mã NV đã gõ";
}

// ── Hàng chờ nguồn ───────────────────────────────────────────────────────────────────────────────────

export const LY_DO_HANG_CHO = ["UNKNOWN", "THIEU_NGUOI", "THIEU_GIAI_TRINH", "CANH_BAO", "XEM_TAY"] as const;
export type LyDoHangCho = (typeof LY_DO_HANG_CHO)[number];

export const NHAN_LY_DO: Record<LyDoHangCho, string> = {
  UNKNOWN: "Chưa rõ nguồn",
  THIEU_NGUOI: "Thiếu người giới thiệu",
  THIEU_GIAI_TRINH: "Thiếu giải trình",
  CANH_BAO: "Có cảnh báo",
  XEM_TAY: "Cần xem tay",
};

/**
 * Lý do xem tay (`signals.xemTay[]`) khiến một lead vào hàng chờ dưới chip «Cần xem tay» — DANH SÁCH HẸP, MỘT chỗ (cả `dieuKienLyDo` lẫn `lyDoCuaDong` đọc từ đây).
 * Cố ý KHÔNG gồm: `THIEU_NGUOI` (đã có lý do riêng theo cột `referrerMissing`) · `VAI_SUY_TU_HIEN_TAI` (nhóm đã đúng, chỉ vai là suy — không cần người quyết) ·
 * `THIEU_SALE_PH`/`SDT_NHAN_VIEN`/`NGUOI_GT_LA_KHACH` (có đường riêng) · `AFF_CHUA_PHAN_LOAI`/`PAGE_CHUA_MAP_NGUON` (thuộc đợt PR7/PR11). Thêm một lý do ở đây là THÊM LEAD VÀO HÀNG CHỜ.
 */
export const LY_DO_XEM_TAY_HANG_CHO = ["INVALID_EMPLOYEE_REFERRER_CODE", "NHAN_CHOT_THEO_PHIEU", "MA_NV_KHONG_GIAI", "NHAN_NGUON_LA"] as const satisfies readonly LyDoXemTayNguon[];
export type LyDoXemTayHangCho = (typeof LY_DO_XEM_TAY_HANG_CHO)[number];

/** Mã cảnh báo gian lận đã biết (02 §7.1) → câu người đọc được; mã lạ in nguyên, không đoán. */
export const NHAN_CANH_BAO: Record<string, string> = {
  SDT_NHAN_VIEN: "SĐT trùng nhân viên",
  NGUOI_GT_LA_KHACH: "Người giới thiệu là khách",
  TU_CLAIM: "Tự đặt mình làm người hưởng",
};

export function nhanCanhBao(ma: string): string {
  return NHAN_CANH_BAO[ma] ?? `Cảnh báo ${ma}`;
}

// ── Nguồn & vai hưởng trong TRÌNH SOẠN chính sách hoa hồng (E2a, 09/10/2026) ───────────────────────────────────────
// Chữ của trạng thái nguồn, nhóm hoa hồng và cách một vai tìm ra người nhận. Một chỗ: ô chọn nguồn, bước «Người hưởng», ma trận và bảng phiên bản cùng nói MỘT câu.
// (Nhãn «người giới thiệu» theo `referrerRequirement` ở `components/admin/nguon-hoa-hong/nhan-nguon.ts` — không chép lại ở đây.)

/**
 * TRẠNG THÁI NGUỒN (`SourceStatus`) → chữ người đọc. ĐÂY LÀ BẢNG GỐC DUY NHẤT: pill ở bảng danh mục, chip lọc, nhật ký chi tiết, trình soạn chính sách và câu giải thích đều đọc từ đây
 * (trước đợt W4 mỗi nơi tự gõ: «Tạm ngừng» / «Đã ngừng» / «Ngừng», «Đang dùng» / «Đang hoạt động»). `Record<SourceStatus, …>` ⇒ thêm trạng thái ở schema mà quên nhãn là LỖI BIÊN DỊCH.
 * Nhãn là TRẠNG THÁI (danh từ); tên nút bấm («Kích hoạt», «Ngừng», «Lưu trữ», «Khôi phục») là ĐỘNG TỪ và ở `form-nguon.ts`.
 */
export const NHAN_TRANG_THAI_NGUON_DB: Readonly<Record<SourceStatus, string>> = {
  DRAFT: "Nháp",
  ACTIVE: "Đang dùng",
  INACTIVE: "Tạm ngừng",
  ARCHIVED: "Lưu trữ",
};

const THU_TU_TRANG_THAI_NGUON: Readonly<Record<SourceStatus, number>> = { DRAFT: 0, ACTIVE: 1, INACTIVE: 2, ARCHIVED: 3 };

/** Mọi trạng thái, theo thứ tự hiển thị của bộ lọc — dựng từ `Record` nên thêm trạng thái mà quên chỗ này là lỗi biên dịch. */
export const DANH_SACH_TRANG_THAI_NGUON: readonly SourceStatus[] = (Object.keys(THU_TU_TRANG_THAI_NGUON) as SourceStatus[]).sort(
  (a, b) => THU_TU_TRANG_THAI_NGUON[a] - THU_TU_TRANG_THAI_NGUON[b],
);

/** Nhãn của một mã trạng thái chưa biết kiểu (nhật ký lưu chuỗi). Mã lạ in nguyên — nhãn sai nghĩa tệ hơn nhãn thô. */
export function nhanTrangThaiNguon(ma: string): string {
  return (NHAN_TRANG_THAI_NGUON_DB as Record<string, string>)[ma] ?? ma;
}

/** Khoá trạng thái nguồn như trình soạn thấy: `status` của DB cộng khoảng hiệu lực (tính ở máy chủ — `lib/hoa-hong/nguon-cho-soan.ts`). Bốn khoá đầu mượn chữ của bảng gốc ở trên. */
export const NHAN_TRANG_THAI_NGUON = {
  HOAT_DONG: NHAN_TRANG_THAI_NGUON_DB.ACTIVE,
  CHUA_HIEU_LUC: "Chưa tới ngày hiệu lực",
  HET_HAN: "Hết hạn chọn cho lead mới",
  NHAP: NHAN_TRANG_THAI_NGUON_DB.DRAFT,
  NGUNG: NHAN_TRANG_THAI_NGUON_DB.INACTIVE,
  LUU_TRU: NHAN_TRANG_THAI_NGUON_DB.ARCHIVED,
} as const;
export type KhoaTrangThaiNguon = keyof typeof NHAN_TRANG_THAI_NGUON;

/** Hai nhóm vai hưởng theo `BeneficiaryRole.isAcquisition`: hoa hồng GHI THEO NGUỒN (chỉ trong cửa sổ ghi công) và hoa hồng GIAO DỊCH khác (chốt đơn, quản lý, dạy trial…). */
export const NHAN_NHOM_HOA_HONG = {
  NGUON: "Hoa hồng nguồn (acquisition)",
  GIAO_DICH: "Hoa hồng giao dịch khác",
} as const;
export type KhoaNhomHoaHong = keyof typeof NHAN_NHOM_HOA_HONG;

/** Giải thích dưới nhóm — vì sao hai nhóm tách ra. */
export const MO_TA_NHOM_HOA_HONG: Readonly<Record<KhoaNhomHoaHong, string>> = {
  NGUON: "Trả theo nguồn khách đến; chỉ tính trong cửa sổ ghi công của nguồn.",
  GIAO_DICH: "Trả theo vai trong giao dịch hoặc đơn vị; không phụ thuộc nguồn khách.",
};

const NHAN_KIEU_RESOLVER: Readonly<Record<string, string>> = {
  TRANSACTION_ROLE: "Người có vai trong giao dịch (chốt đơn, dạy trial…)",
  ORG_UNIT_ROLE: "Người được cơ sở phân công phụ trách",
  DIRECT_PERSON: "Người giới thiệu — theo nguồn lead",
  SOURCE_MEMBER: "Thành viên của nguồn",
  SOURCE_OWNER: "Người phụ trách nguồn — khai ở cấu hình nguồn",
};

/** Với kiểu `DIRECT_PERSON` một kiểu chứa nhiều vai; phân biệt bằng KHOÁ của vai (không phải mã vai). Khoá lạ ⇒ rơi về câu theo kiểu. */
const NHAN_KHOA_DIRECT: Readonly<Record<string, string>> = {
  REFERRER_PARENT: "Phụ huynh giới thiệu — theo nguồn lead",
  REFERRER_EMPLOYEE: "Nhân sự giới thiệu — theo nguồn lead",
  AFFILIATE: "Đối tác giới thiệu — theo nguồn lead",
  REFERRER_PARENT_SALE: "Sale phụ trách phụ huynh giới thiệu — chốt tại lúc ghi nhận nguồn",
};

/** Câu mô tả «người nhận cụ thể được tìm thế nào» của một vai. Kiểu/khoá lạ in nguyên, không đoán. */
export function moTaCachXacDinhVai(v: { resolverType: string; resolverKey: string | null }): string {
  if (v.resolverType === "DIRECT_PERSON" && v.resolverKey !== null && NHAN_KHOA_DIRECT[v.resolverKey]) return NHAN_KHOA_DIRECT[v.resolverKey]!;
  return NHAN_KIEU_RESOLVER[v.resolverType] ?? v.resolverType;
}
// ── Bổ sung Sale phụ trách phụ huynh (khối Nguồn của lead) ───────────────────────────────────────────

/** Vì sao nguồn của lead KHÔNG chọn được nữa (`LyDoNguonNgung` ở `bo-sung-sale.ts`) → cụm động từ đứng sau «đang/đã». */
export const NHAN_NGUON_NGUNG: Readonly<Record<"TRANG_THAI" | "LUU_TRU" | "TAT_CHON" | "NGOAI_HIEU_LUC", string>> = {
  TRANG_THAI: "đang ngừng hoặc chưa kích hoạt",
  LUU_TRU: "đã lưu trữ (phải chuyển về «Ngừng» rồi «Kích hoạt»)",
  TAT_CHON: "đang tắt chức năng cho chọn",
  NGOAI_HIEU_LUC: "đang ngoài khoảng ngày hiệu lực",
};
