/**
 * lib/nguon/nhan-hien-thi.ts — CHỮ người đọc của các giá trị kỹ thuật trong quy nguồn. THUẦN.
 *
 * Một chỗ cho khối "Nguồn" trên lead, Sheet "Gán nguồn" và hàng chờ cùng nói MỘT câu về cùng một giá trị. Mã lạ
 * (nhóm admin thêm, lý do PR sau thêm) in nguyên mã thay vì đoán — một nhãn sai nghĩa tệ hơn một nhãn thô.
 */
import type { SourceIdentificationMethod, SourceStatus } from "@prisma/client";
import type { LyDoXemTayNguon } from "./tin-hieu";

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
  SDT_NHAN_VIEN: "SĐT khách trùng SĐT nhân viên",
  NGUOI_GT_LA_KHACH: "Người giới thiệu có SĐT trùng khách",
};

export function nhanXemTay(ma: string): string {
  return (NHAN_XEM_TAY as Record<string, string>)[ma] ?? ma;
}

// ── Hàng chờ nguồn ───────────────────────────────────────────────────────────────────────────────────

export const LY_DO_HANG_CHO = ["UNKNOWN", "THIEU_NGUOI", "THIEU_GIAI_TRINH", "CANH_BAO"] as const;
export type LyDoHangCho = (typeof LY_DO_HANG_CHO)[number];

export const NHAN_LY_DO: Record<LyDoHangCho, string> = {
  UNKNOWN: "Chưa rõ nguồn",
  THIEU_NGUOI: "Thiếu người giới thiệu",
  THIEU_GIAI_TRINH: "Thiếu giải trình",
  CANH_BAO: "Có cảnh báo",
};

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
