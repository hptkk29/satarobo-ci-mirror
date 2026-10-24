// lib/hoa-hong/kieu.ts — KIỂU + LỖI dùng chung của lõi hoa hồng (PR4 → PR5 dùng lại). THUẦN.
//
// `HoaHongContext` là TOÀN BỘ cấu hình + danh mục mà một lượt tính cần, nạp MỘT lần rồi truyền xuống hàm thuần
// (L11: hàm thuần nhận dữ liệu đã nạp; hàm DB chỉ nạp + ghi). Thử tính, "dự kiến của bạn" và engine thật dựng
// cùng một `HoaHongContext` và gọi cùng `tinhChinhSachChoPhan` — chỗ này không có bản thứ hai.
//
// ⚠️ Không có giá trị mặc định nguy hiểm: `tranTongTiLe` và `thuTuPhamVi` do chỗ gọi nạp từ cấu hình
// (`getSetting`) và TRUYỀN vào; kiểu này bắt buộc cả hai (luật 7, lưới `[NHH-W3]`).
import type { NhomNguon, PhamVi, QuyTac } from "./chon-quy-tac";
import type { MucVat } from "./tien";
import type { KieuResolver } from "./vai-huong";

/** Lỗi nghiệp vụ của engine hoa hồng — `throw` trong `$transaction` để rollback (luật 12). */
export class HoaHongError extends Error {
  constructor(
    readonly ma: string,
    message?: string,
    /** Dữ liệu có cấu trúc đi kèm (vd danh sách lỗi guardrail) để tầng gọi dựng câu trả lời. */
    readonly chiTiet?: unknown,
  ) {
    super(message ?? ma);
    this.name = "HoaHongError";
  }
}

/** Xuất lại từ lá `khieu-nai-ma.ts` (gỡ vòng import với `vi-sao.ts`) — nơi gọi cũ vẫn `import { MA_KHOI_PHUC_HOAN_LEGACY } from "./kieu"`. */
export { MA_KHOI_PHUC_HOAN_LEGACY } from "./khieu-nai-ma";

/** Lý do tối thiểu (ký tự) của mọi thao tác ghi tiền/kỳ/mốc có audit — MỘT hằng cho `ky-service`, `giai-hang-cho`, `cutover`. */
export const LY_DO_TOI_THIEU = 10;

export function batLyDoToiThieu(lyDo: string | null | undefined, ten: string): string {
  const s = (lyDo ?? "").trim();
  if (s.length < LY_DO_TOI_THIEU) throw new HoaHongError("THIEU_LY_DO", `${ten} bắt buộc kèm lý do (≥ ${LY_DO_TOI_THIEU} ký tự).`);
  return s;
}

/** Mã lỗi của tầng chính sách (service) — `HoaHongError.ma`. */
export const MA_LOI_CHINH_SACH = [
  "VERSION_KHONG_TON_TAI",
  "VERSION_DA_KHOA",
  "VERSION_KHONG_PHAI_NHAP",
  /** Nháp bị sửa giữa lúc guardrail đọc và lúc ghi — bản sắp kích hoạt không còn là bản đã được kiểm. */
  "VERSION_DA_DOI",
  /** Tập version ACTIVE đổi giữa lúc guardrail đọc và lúc ghi — kết quả kiểm trần/chồng lấn đã cũ. */
  "TAP_HIEU_LUC_DA_DOI",
  /** Các nhóm nguồn mà guardrail đọc (trạng thái · người phụ trách · cờ hoa hồng · kiểu người giới thiệu) đổi giữa lúc kiểm và lúc ghi — W2, res3 L8. */
  "NGUON_DA_DOI",
  "KICH_HOAT_BI_CHAN",
  "POLICY_KHONG_TON_TAI",
  "DU_LIEU_KHONG_HOP_LE",
  "VAN_BAN_KHONG_TON_TAI",
  "DON_VI_KHONG_HOP_LE",
] as const;
export type MaLoiChinhSach = (typeof MA_LOI_CHINH_SACH)[number];

export type VaiHuongDong = {
  code: string;
  resolverType: KieuResolver;
  resolverKey: string | null;
  isAcquisition: boolean;
  isActive: boolean;
};

export type HoaHongContext = {
  /** Mọi rule đã nạp (nhiều version, nhiều phạm vi) — `chonQuyTac` tự lọc theo ngữ cảnh. */
  quyTac: readonly QuyTac[];
  /** Nhóm nguồn ĐANG HOẠT ĐỘNG (không gồm UNKNOWN), sắp theo `sortOrder` — hoà tiền thì nhóm đứng trước thắng. */
  nhomNguon: readonly NhomNguon[];
  vaiHuong: readonly VaiHuongDong[];
  thuTuPhamVi: readonly PhamVi[];
  /** Mã phiên bản thứ tự phạm vi — chụp lên mỗi dòng sổ (`scopeOrderVersion`). */
  phienBanThuTu: string;
  /** BẮT BUỘC: `getSetting("crm.commissionMaxTotalRate")`. */
  tranTongTiLe: number;
  vatTheoNgay: readonly MucVat[];
};
