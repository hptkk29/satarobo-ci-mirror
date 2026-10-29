import { withCron } from "@/lib/cron/handler";
import { runParentRequestReminder } from "@/lib/portal/parent-request-notify";
import { runMediaReviewOverdueNotify } from "@/lib/lms/media-review-overdue-run";

export const dynamic = "force-dynamic";

// Cron NHẮC VIỆC QUÁ HẠN CHO QUẢN LÝ CƠ SỞ — chạy mỗi giờ tròn (`0 * * * *`).
//
// #08 (L8.2, câu 40) — ParentRequest PENDING > 12h → nhắc Sale/QL cơ sở, dedupe theo requestId.
// F-21 — ảnh/video buổi học quá hạn duyệt (hạn F-20) mà chưa duyệt hết → nhắc QL của ĐÚNG
//        cơ sở có ảnh treo, dedupe theo folder × ngày VN.
//
// ⚠️ VÌ SAO F-21 ĐI NHỜ KHE NÀY, KHÔNG XIN KHE CRON RIÊNG:
// `vercel.json` đang giữ 25 khe. Ngân sách khe là tài nguyên chung của cả repo, và việc này
// không cần nhịp riêng: hạn duyệt của F-20 luôn rơi vào ĐÚNG GIỜ TRÒN (`media.reviewDeadlineHour`
// là số giờ 0..23, phút luôn = 0), mà khe này chạy đúng phút 0 mỗi giờ ⇒ thông báo bắn ngay
// trong lượt chạy đầu tiên sau khi hạn trôi qua. Một khe riêng cũng không sớm hơn được.
// Nếu sau này cần nhịp dày hơn phút-0 thì đổi lịch của khe này, đừng thêm khe.
//
// ⚠️ HAI VIỆC PHẢI ĐỘC LẬP: một bên nổ không được nuốt bên kia. `withCron` chỉ bọc lỗi ở
// vòng ngoài, nên mỗi nhánh tự bắt lỗi và trả về phần lỗi của mình — cron xanh nửa vời còn
// hơn cả hai cùng im.
export const GET = withCron("parent-request-reminder", async () => {
  const [parentRequest, mediaReview] = await Promise.all([
    runParentRequestReminder().catch((err: unknown) => {
      console.error("[cron:parent-request-reminder] nhánh yêu cầu PH lỗi", err);
      return { error: err instanceof Error ? err.message : "failed" };
    }),
    runMediaReviewOverdueNotify().catch((err: unknown) => {
      console.error("[cron:parent-request-reminder] nhánh F-21 ảnh quá hạn lỗi", err);
      return { error: err instanceof Error ? err.message : "failed" };
    }),
  ]);
  return { ok: true, data: { parentRequest, mediaReview } };
});
