import { fail } from "@/lib/api/response";
import { isElearningEnabled, isElearningVideoEnabled } from "@/lib/flags";

/**
 * Cổng CỜ cho API của khu E-learning (đặc tả v1.4 §4.8, mức rollback 1: "ẩn hoàn toàn, dữ liệu giữ
 * nguyên").
 *
 * `/api/*` là infra path của `decideRoute()` — đi thẳng qua proxy, không qua cổng cờ của layout. Nên
 * mỗi route phải tự hỏi cờ, và hỏi TRƯỚC mọi thao tác khác (kể cả đọc phiên): cờ OFF thì route
 * không được phép tốn một câu truy vấn nào cho người gọi.
 *
 * Lưới `tests/elearning/api-gate.test.ts` quét MỌI `route.ts` dưới `app/api/elearning/`.
 */

/** Cờ chung OFF ⇒ 404 — không lộ rằng route có tồn tại. Trả `null` khi được đi tiếp. */
export function chanApiKhiTat(): Response | null {
  if (isElearningEnabled()) return null;
  return fail("NOT_FOUND", "Không tìm thấy", { status: 404 });
}

/**
 * Cờ RIÊNG của mảng phát + ĐO xem video (`ELEARNING_VIDEO_ENABLED`). OFF ⇒ 503 `FEATURE_OFF`: khác
 * 404 ở chỗ trang phát biết mà báo "đang tạm tắt" thay vì "không có". Gọi SAU `chanApiKhiTat()`.
 */
export function chanVideoKhiTat(): Response | null {
  if (isElearningVideoEnabled()) return null;
  return fail("FEATURE_OFF", "Tính năng xem video đang tạm tắt", { status: 503 });
}
