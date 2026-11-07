// lib/portal/muc-tam-an-thuan.ts — phần THUẦN của công tắc «Bài tập & bài thi» (tạm ẩn 03/11/2026). KHÔNG import gì: các vỏ menu `"use client"`
// (sr-shell · hv-shell · v2-shell · portal-nav) lọc mục bằng tệp này, không kéo `lib/flags` (đọc env — chỉ có ý nghĩa ở máy chủ) vào bó trình duyệt.
// Công tắc THẬT nằm ở `lib/portal/muc-tam-an.ts` (`mucBaiTapBaiThiDangHien`).

/** Các nhánh route thuộc mục này (cổng phụ huynh + cổng học sinh). */
export const NHANH_BAI_TAP_BAI_THI = [
  "/portal/bai-tap",
  "/portal/bai-thi",
  "/portal/hoc-sinh/bai-tap",
  "/portal/hoc-sinh/bai-thi",
] as const;

/** Đường dẫn có thuộc mục «Bài tập & bài thi» không (khớp theo ĐOẠN: `/portal/bai-tap-x` không tính). */
export function laDuongBaiTapBaiThi(duongDan: string): boolean {
  const p = duongDan.split(/[?#]/)[0] ?? "";
  return NHANH_BAI_TAP_BAI_THI.some((n) => p === n || p.startsWith(`${n}/`));
}

/** Bỏ khỏi danh sách mục menu những mục dẫn tới «Bài tập & bài thi» khi đang ẩn; đang hiện ⇒ trả bản sao nguyên danh sách. */
export function locMucBaiTapBaiThi<T extends { href: string }>(muc: readonly T[], dangHien: boolean): T[] {
  return dangHien ? [...muc] : muc.filter((m) => !laDuongBaiTapBaiThi(m.href));
}

/**
 * Các nhánh route thuộc mục «SataCoin» của Cổng phụ huynh (tạm ẩn 04/11/2026). Cổng học sinh KHÔNG có route riêng cho coin
 * (thẻ coin nằm trong «Hành trình & huy hiệu», route đó vẫn mở cho huy hiệu).
 */
export const NHANH_SATACOIN = ["/portal/satacoin"] as const;

/** Đường dẫn có thuộc mục «SataCoin» không (khớp theo ĐOẠN: `/portal/satacoin-x` không tính). */
export function laDuongSataCoin(duongDan: string): boolean {
  const p = duongDan.split(/[?#]/)[0] ?? "";
  return NHANH_SATACOIN.some((n) => p === n || p.startsWith(`${n}/`));
}

/** Bỏ khỏi danh sách mục menu những mục dẫn tới «SataCoin» khi đang ẩn; đang hiện ⇒ trả bản sao nguyên danh sách. */
export function locMucSataCoin<T extends { href: string }>(muc: readonly T[], dangHien: boolean): T[] {
  return dangHien ? [...muc] : muc.filter((m) => !laDuongSataCoin(m.href));
}

/** Lời từ chối của hành động (nộp bài / làm bài thi) khi mục đang ẩn — hành động là endpoint công khai nên phải tự chặn. */
export const LOI_MUC_DANG_AN = "Mục Bài tập & bài thi đang tạm ẩn. Ba mẹ vui lòng quay lại sau nhé.";
