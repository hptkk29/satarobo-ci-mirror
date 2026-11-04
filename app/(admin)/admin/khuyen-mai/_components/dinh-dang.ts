// Định dạng dùng chung của màn Khuyến mãi — THUẦN, dùng được cả ở RSC lẫn client.
import type { PillTone } from "@/components/admin/ui/status-pill";
import { congNgay, soNgayGiua } from "@/lib/format/thoi-gian-vn";
import type { TrangThaiChinhSach } from "@/lib/khuyen-mai/hieu-luc";

/** "2026-09-01" → "01/09/2026". */
export function ngayVi(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

/** "01/09 → 31/12/2026" — bỏ năm ở đầu khi cùng năm (đọc nhanh hơn trong cột hẹp). */
export function khoangVi(tu: string, den: string): string {
  const cungNam = tu.slice(0, 4) === den.slice(0, 4);
  const dau = cungNam ? ngayVi(tu).slice(0, 5) : ngayVi(tu);
  return `${dau} → ${ngayVi(den)}`;
}

export const TONE_TRANG_THAI: Record<TrangThaiChinhSach, PillTone> = {
  dang_ap_dung: "success",
  sap_ap_dung: "info",
  het_han: "muted",
  da_thu_hoi: "danger",
};

/**
 * Câu nhắc thời gian cạnh khoảng hiệu lực — cái Sale cần là "còn bao lâu", không phải tự trừ ngày.
 * Trả null khi không có gì đáng nói (đã hết hạn lâu).
 */
export function nhacThoiGian(tt: TrangThaiChinhSach, tuNgay: string, ketThuc: string, homNay: string): string | null {
  if (tt === "sap_ap_dung") {
    const n = soNgayGiua(homNay, tuNgay);
    return n === 1 ? "bắt đầu ngày mai" : `bắt đầu sau ${n} ngày`;
  }
  if (tt === "dang_ap_dung") {
    const n = soNgayGiua(homNay, ketThuc);
    if (n === 0) return "hôm nay là ngày cuối";
    return `còn ${n + 1} ngày`;
  }
  if (tt === "het_han" && soNgayGiua(ketThuc, homNay) <= 30) {
    return `hết hạn từ ${ngayVi(congNgay(ketThuc, 1))}`;
  }
  return null;
}
