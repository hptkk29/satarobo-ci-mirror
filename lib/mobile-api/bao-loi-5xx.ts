import * as Sentry from "@sentry/nextjs";

/**
 * SEC-11 (V8.45) — BÁO LỖI 5XX KHÔNG LƯỜNG TRƯỚC của API di động. Trước đây `traLoi` nuốt mọi lỗi lạ rồi trả 500 chung (đúng — không lộ nội bộ) nhưng KHÔNG ghi gì ở production ⇒ DB sập /
 * injection thất bại hàng loạt không để lại dấu, điều tra sự cố mù. Nay:
 *  · gửi lên Sentry (`captureException`, gắn thẻ `area=mobile-api` + `requestId` KHỚP `requestId` trả cho app ⇒ tra ngược từ ảnh chụp lỗi của người dùng); bộ che bí mật của
 *    `sentry.server.config.ts` (`cheSauBiMat`) vẫn áp lên sự kiện — KHÔNG gửi thân yêu cầu / token từ đây;
 *  · MỘT dòng nhật ký có cấu trúc `[mobile-api-5xx] {requestId,name,code}` để ĐẾM 5xx (log shipping / grep) — CỐ Ý KHÔNG ghi `message` của lỗi (lỗi Prisma có thể kèm giá trị tham số / PII).
 * Báo lỗi hỏng KHÔNG được làm hỏng phản hồi (mọi ngoại lệ ở đây bị nuốt).
 */
export function baoLoiKhongLuongTruoc(e: unknown, requestId: string): void {
  try {
    const ten = e instanceof Error ? e.name : typeof e;
    const ma = typeof (e as { code?: unknown } | null)?.code === "string" ? (e as { code: string }).code : undefined;
    console.error(`[mobile-api-5xx] ${JSON.stringify({ requestId, name: ten, ...(ma ? { code: ma } : {}) })}`);
    Sentry.captureException(e, { tags: { area: "mobile-api", requestId }, level: "error" });
  } catch {
    /* báo lỗi hỏng không được làm hỏng phản hồi */
  }
}
