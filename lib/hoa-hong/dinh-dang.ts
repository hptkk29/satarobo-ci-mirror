// lib/hoa-hong/dinh-dang.ts — ĐỊNH DẠNG NGÀY của màn chính sách hoa hồng. THUẦN.
//
// Mọi ngày in ra theo lịch VN (UTC+7 cố định). Máy chủ chạy UTC: `toLocaleDateString()` trần in sai một ngày với mốc 00:00 VN
// (lưu 17:00Z hôm trước). Nên đi qua `ngayVN` của `ngay-lam-viec.ts`, không tự cộng giờ ở chỗ khác.
import { ngayVN } from "./ngay-lam-viec";
import { ngayDMY } from "./hang-rao-ui";

const MS_NGAY = 86_400_000;

export const ngayDMYTuMoc = (d: Date): string => ngayDMY(ngayVN(d));

export function ngayGioVN(d: Date): string {
  const gio = new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(11, 16);
  return `${ngayDMYTuMoc(d)} ${gio}`;
}

/** "01/11/2026 → hết 31/12/2026" — `effectiveTo` là biên mở nên ngày CUỐI còn áp dụng là ngày trước đó. */
export function khoangHieuLuc(from: Date, to: Date | null): string {
  return to === null ? `${ngayDMYTuMoc(from)} → chưa kết thúc` : `${ngayDMYTuMoc(from)} → hết ${ngayDMYTuMoc(new Date(to.getTime() - MS_NGAY))}`;
}

/** Bản NGẮN cho ô bảng: "từ 01/11/2026" khi chưa kết thúc; "01/11/2026 → 31/12/2026" khi có ngày cuối (đã gồm cả ngày cuối). */
export function khoangHieuLucNgan(from: Date, to: Date | null): string {
  return to === null ? `từ ${ngayDMYTuMoc(from)}` : `${ngayDMYTuMoc(from)} → ${ngayDMYTuMoc(new Date(to.getTime() - MS_NGAY))}`;
}

/** Kỳ "2026-10" → "10/2026" (kỳ hoa hồng theo tháng). Giá trị không đúng dạng yyyy-MM giữ NGUYÊN (không bịa). MỘT hàm cho mọi màn của module — đừng tự cắt chuỗi ở chỗ khác. */
export const kyHienThi = (k: string): string => (/^\d{4}-\d{2}$/.test(k) ? `${k.slice(5)}/${k.slice(0, 4)}` : k);
