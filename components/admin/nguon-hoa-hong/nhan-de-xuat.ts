// components/admin/nguon-hoa-hong/nhan-de-xuat.ts — CHỮ HIỂN THỊ DÙNG CHUNG của đề xuất điều chỉnh (bảng · Sheet · khối trong Sheet khiếu nại). THUẦN.
// Một chỗ: bảng và Sheet tự ghép "+50.000đ" / "Duyệt cấp 2" là hai nơi sẽ lệch nhau (luật 12b).
import type { DeXuatHienThi } from "@/lib/hoa-hong/de-xuat-doc";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";

/** "+50.000đ" / "−50.000đ" — dấu là thông tin chính của một điều chỉnh (trả thêm hay đòi lại). */
export const soTienCoDau = (n: number): string => (n > 0 ? `+${dinhDangDong(n)}` : n < 0 ? `−${dinhDangDong(-n)}` : dinhDangDong(0));

/** Màu chữ theo dấu (token trạng thái, không hex). */
export const inkSo = (n: number): string => (n < 0 ? "text-state-danger-ink" : n > 0 ? "text-state-success-ink" : "text-foreground");

/**
 * SỐ TIỀN ĐỀ XUẤT nói thật. Gói điều chỉnh có thể là một chiều («+50.000đ» cho một người) hoặc CHUYỂN giữa người hưởng («A −16 triệu · B +16 triệu», ròng 0): in «0đ» làm số chính
 * che mất số tiền đang dịch chuyển — người duyệt không thấy mình sắp ghi gì (chụp thật 1280px 10/10/2026). Một chỗ cho bảng · Sheet · nút duyệt · khối trong Sheet khiếu nại (luật 12b).
 *   · một chiều (|ròng| = tổng tuyệt đối) ⇒ số có dấu như cũ;
 *   · ròng 0 ⇒ «Chuyển X» + «tổng hoa hồng không đổi»; còn lại ⇒ «Điều chỉnh X» + «Tổng hoa hồng ±Y».
 */
export function nhanSoTienDeXuat(s: { rong: number; tuyetDoi: number }): { chinh: string; phu: string | null; ink: string } {
  if (s.rong !== 0 && s.tuyetDoi === Math.abs(s.rong)) return { chinh: soTienCoDau(s.rong), phu: null, ink: inkSo(s.rong) };
  if (s.rong === 0) return { chinh: `Chuyển ${dinhDangDong(s.tuyetDoi)}`, phu: "Giữa các người hưởng — tổng hoa hồng không đổi", ink: "text-foreground" };
  return { chinh: `Điều chỉnh ${dinhDangDong(s.tuyetDoi)}`, phu: `Tổng hoa hồng ${soTienCoDau(s.rong)}`, ink: "text-foreground" };
}

/** Việc của người xem trên đề xuất — lấy từ `viec` (cùng hàm với cổng của service). */
export function nhanViecCuaBan(d: Pick<DeXuatHienThi, "viec">): string {
  if (d.viec.duyet) return `Duyệt cấp ${d.viec.cap}`;
  return d.viec.cap === null ? "—" : "Chỉ xem";
}
