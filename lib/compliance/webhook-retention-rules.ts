// lib/compliance/webhook-retention-rules.ts — S9-B7 (tích hợp ZaloCRM).
//
// LUẬT lưu trữ cho `WebhookDelivery` + `DomainEvent`, tách THUẦN khỏi phần chạm DB.
//
// Vì sao tách file: đây là chỗ quyết định "xoá dòng nào", tức là chỗ duy nhất mà một
// lỗi sẽ mang hình dạng "mất dữ liệu, không có lỗi nào được ném ra". Nó phải có test
// chạy THẬT trong CI. Job `unit-tests` không có Postgres và không có `DATABASE_URL`,
// nên bất cứ file nào kéo theo `@/lib/db` đều buộc test của nó phải `skipIf` — và
// một lưới tự bỏ qua thì không phải lưới. Cùng lý do repo đã tách
// `lib/inbox/send-rules.ts` khỏi `send.ts`, `lib/inbox/identity-rules.ts` khỏi
// `identity.ts`.
//
// KHÔNG import `@/lib/db`, KHÔNG `server-only` ở file này. Giữ nguyên như vậy.

/**
 * Số ngày giữ dấu vết webhook/sự kiện trước khi dọn.
 *
 * 30 ngày là mức đủ cho hai nhu cầu vận hành duy nhất mà bảng này phục vụ: đối soát
 * "tin đó có tới không" (tính bằng ngày, không bằng tháng) và replay một lượt giao
 * hỏng (`app/(admin)/admin/crm/webhook-replay/`). Giữ lâu hơn không thêm giá trị vận
 * hành nào mà chỉ tích thêm dữ liệu cá nhân: `WebhookDelivery.payload` là payload
 * THÔ của nhà cung cấp — tên và số điện thoại phụ huynh nằm nguyên văn trong đó,
 * không mã hoá, không cách ly cơ sở, không chủ sở hữu.
 */
export const WEBHOOK_RETENTION_DAYS = 30;

/**
 * Trạng thái `DomainEvent` được coi là ĐÃ XỬ LÝ XONG — chỉ những dòng này mới được dọn.
 *
 * ⚠️ `DomainEvent.status` là `String` tự do, KHÔNG phải enum Prisma (xem
 * `prisma/schema.prisma`, model `DomainEvent`). Trình biên dịch không bắt lỗi gõ sai:
 * viết nhầm một chữ thì cron chạy hằng đêm, trả về 0, không lỗi, và bảng cứ phình.
 * Bộ chữ THẬT do `lib/events/dispatcher.ts` ghi là PENDING → PROCESSING → DONE|FAILED.
 *
 * Đặc biệt KHÔNG có `PROCESSED` — chữ đó thuộc enum `WebhookStatus` của bảng
 * `WebhookDelivery`, một bảng khác. Hai bảng đi chung một cron nên rất dễ lẫn.
 *
 * Cố ý bỏ ngoài:
 *   • PENDING / PROCESSING — đang chờ dispatcher. Xoá = side-effect (email/ZNS/đồng bộ)
 *     biến mất vĩnh viễn mà không ai biết, vì outbox chính là bản ghi nhớ duy nhất.
 *   • FAILED — đang cần điều tra. Xoá = mất luôn `lastError`, tức mất bằng chứng.
 */
export const TRANG_THAI_DOMAIN_EVENT_DA_XONG = ["DONE"] as const;

/**
 * Mốc thời gian cắt: mọi dòng CŨ HƠN mốc này thuộc diện dọn.
 *
 * Ném khi `ngayGiuLai` không phải số nguyên dương. Đây không phải phòng thủ thừa:
 * `ngayGiuLai = 0` cho mốc cắt = đúng "bây giờ", tức xoá cả dòng vừa ghi một giây
 * trước — và một số 0 lọt vào từ biến môi trường gõ nhầm là chuyện thường
 * (`Number("") === 0`, `Number(undefined)` là NaN). Thà cron đỏ và có người đọc log
 * còn hơn bảng trống mà không ai biết vì sao.
 */
export function mocCatLuuTru(now: Date, ngayGiuLai: number = WEBHOOK_RETENTION_DAYS): Date {
  if (!Number.isFinite(ngayGiuLai) || ngayGiuLai < 1) {
    throw new Error(
      `[webhook-retention] ngayGiuLai phải là số ≥ 1, nhận được: ${String(ngayGiuLai)}`,
    );
  }
  return new Date(now.getTime() - ngayGiuLai * 24 * 60 * 60 * 1_000);
}

/**
 * Điều kiện xoá `WebhookDelivery` — CHỈ theo thời gian, KHÔNG theo trạng thái.
 *
 * Cả bảng đều là dấu vết chứa payload thô, nên mọi trạng thái đều đến hạn như nhau.
 * Hệ quả phải biết trước: dòng `FAILED` quá 30 ngày sẽ biến khỏi màn "Webhook lỗi —
 * Replay". Đó là chấp nhận có chủ đích — một lượt giao hỏng chưa ai replay sau 30
 * ngày thì cũng sẽ không còn ai replay nữa, trong khi payload của nó vẫn là dữ liệu
 * cá nhân đang nằm đó.
 */
export function dieuKienXoaWebhookDelivery(cutoff: Date): { receivedAt: { lt: Date } } {
  return { receivedAt: { lt: cutoff } };
}

/** Điều kiện xoá `DomainEvent` — đã xử lý xong VÀ quá hạn. Thiếu vế nào cũng là mất dữ liệu. */
export function dieuKienXoaDomainEvent(cutoff: Date): {
  status: { in: string[] };
  createdAt: { lt: Date };
} {
  return {
    status: { in: [...TRANG_THAI_DOMAIN_EVENT_DA_XONG] },
    createdAt: { lt: cutoff },
  };
}
