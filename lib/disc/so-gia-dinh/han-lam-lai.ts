/**
 * HẠN LÀM LẠI BÀI (doc 18, 7.1) — nhắc sau 6 tháng THEO LỊCH (31/08 + 6 tháng = 28/02).
 *
 *  · Mỗi người: hạn = ngày (giờ VN) của bài đang dùng + 6 tháng. Không có bài ⇒ KHÔNG bịa hạn (null).
 *  · Cả nhà lấy hạn SỚM NHẤT + danh sách người đã đến hạn.
 *  · Làm lại sớm hơn hạn: được — chỉ hiện lời nhắc «kết quả có thể chưa khác».
 *  · So hai mốc của cùng một người chỉ khi cách nhau ≥ 90 ngày VÀ cùng phiên bản bộ đề (xem `ho-so-dang-dung.soSanhTrucTiep`).
 *
 * Thuần. Tự cài phép cộng tháng trên chuỗi YYYY-MM-DD (không dùng `Date#getMonth` của giờ máy — máy chủ ở UTC, người dùng ở UTC+7).
 */
import { soNgayGiua } from "./kieu";

export const THANG_NHAC_LAI = 6;
export const NGAY_TOI_THIEU_DE_SO_SANH = 90;

/** Cộng `thang` tháng theo lịch; ngày không có ở tháng đích thì lùi về ngày cuối tháng. */
export function congThangYmd(ymd: string, thang: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const tong = (m - 1) + thang;
  const yy = y + Math.floor(tong / 12);
  const mm = ((tong % 12) + 12) % 12; // 0-based
  const cuoi = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  const dd = Math.min(d, cuoi);
  return `${String(yy).padStart(4, "0")}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export type HanMotNguoi = {
  readonly id: string;
  readonly ten: string;
  /** YYYY-MM-DD */
  readonly ngayDen: string;
  /** Số ngày còn lại; ÂM = đã quá hạn bấy nhiêu ngày; 0 = đúng hôm nay. */
  readonly conNgay: number;
  readonly denHan: boolean;
};

export type HanCaNha = {
  readonly som: HanMotNguoi;
  readonly tatCa: readonly HanMotNguoi[];
  readonly nguoiDenHan: readonly HanMotNguoi[];
};

export function hanCuaMotNguoi(
  nguoi: { readonly id: string; readonly ten: string },
  ngayLamYmd: string | null,
  homNayYmd: string,
  thang = THANG_NHAC_LAI,
): HanMotNguoi | null {
  if (!ngayLamYmd) return null;
  const ngayDen = congThangYmd(ngayLamYmd, thang);
  const conNgay = soNgayGiua(homNayYmd, ngayDen);
  return { id: nguoi.id, ten: nguoi.ten, ngayDen, conNgay, denHan: conNgay <= 0 };
}

export function hanCaNha(
  ds: readonly { readonly id: string; readonly ten: string; readonly ngayLamYmd: string | null }[],
  homNayYmd: string,
  thang = THANG_NHAC_LAI,
): HanCaNha | null {
  const tatCa = ds
    .map((n) => hanCuaMotNguoi(n, n.ngayLamYmd, homNayYmd, thang))
    .filter((h): h is HanMotNguoi => h !== null)
    .sort((a, b) => a.ngayDen.localeCompare(b.ngayDen) || a.id.localeCompare(b.id));
  const som = tatCa[0];
  if (!som) return null;
  return { som, tatCa, nguoiDenHan: tatCa.filter((h) => h.denHan) };
}

/** Hai mốc cách nhau đủ xa để đáng so sánh (≥ 90 ngày). */
export function duXaDeSoSanh(ngayCuYmd: string, ngayMoiYmd: string): boolean {
  return soNgayGiua(ngayCuYmd, ngayMoiYmd) >= NGAY_TOI_THIEU_DE_SO_SANH;
}
