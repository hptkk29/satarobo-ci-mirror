// lib/portal/muc-tam-an.ts — MỘT công tắc cho mục «Bài tập & bài thi» của Cổng phụ huynh + Cổng học sinh (tạm ẩn 03/11/2026,
// chủ dự án: hệ thống chưa có bài tập, bài thi). Chỉ dùng ở MÁY CHỦ (đọc env). Vỏ menu `"use client"` import phần thuần từ `muc-tam-an-thuan.ts`.
//
// Cách bật lại: đặt env `PORTAL_BAI_TAP_BAI_THI_ENABLED="true"` (đọc ở `lib/flags.ts`). KHÔNG xoá mã bài tập / bài thi — chỉ ẩn.
// Tệp này còn giữ công tắc thứ hai, ĐỘC LẬP: «SataCoin» (tạm ẩn 04/11/2026) — env `PORTAL_SATACOIN_ENABLED="true"` (xem `mucSataCoinDangHien`).
//
// ⚠️ Chỉ ẨN lối vào + CHẶN route/hành động. Đừng thêm công tắc thứ hai ở nơi khác: mục menu, thẻ, số đếm, tin, route và action
// đều hỏi `mucBaiTapBaiThiDangHien()` — hai nơi hỏi hai cách là nơi menu nói "không có" còn route vẫn mở (hoặc ngược lại).
import { isPortalBaiTapBaiThiEnabled, isPortalSataCoinEnabled } from "@/lib/flags";

export {
  LOI_MUC_DANG_AN,
  NHANH_BAI_TAP_BAI_THI,
  NHANH_SATACOIN,
  laDuongBaiTapBaiThi,
  laDuongSataCoin,
  locMucBaiTapBaiThi,
  locMucSataCoin,
} from "@/lib/portal/muc-tam-an-thuan";

/** Mục «Bài tập & bài thi» đang hiện ở hai cổng không? Tắt (mặc định) ⇒ ẩn khỏi menu/thẻ/đếm/tin và 404 các route. */
export function mucBaiTapBaiThiDangHien(): boolean {
  return isPortalBaiTapBaiThiEnabled();
}

/**
 * Mục «SataCoin» đang hiện ở hai cổng không? (tạm ẩn 04/11/2026 — chủ dự án sẽ tự làm rồi mở lại; bật lại bằng env
 * `PORTAL_SATACOIN_ENABLED="true"`). Tắt (mặc định) ⇒ bộ nạp dữ liệu trả `coin: null` và KHÔNG đọc số dư; mọi chỗ vẽ coin
 * chỉ vẽ khi `coin !== null`; menu phụ huynh lọc bằng `locMucSataCoin`; route `/portal/satacoin` trả 404.
 * Cùng một công tắc cho mọi chỗ — đừng thêm cờ thứ hai.
 */
export function mucSataCoinDangHien(): boolean {
  return isPortalSataCoinEnabled();
}
