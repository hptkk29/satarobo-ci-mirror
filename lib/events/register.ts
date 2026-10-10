// lib/events/register.ts — A0-07: đăng ký handler 1 lần/process (idempotent).
// Nghiệp vụ thật thêm registerXxx() ở đây. Hiện chỉ demo.ping (A0 dựng cơ chế).
import { registerPingDemo } from "@/lib/events/_demo/ping-handlers";
import { registerElearningNotifyHandlers } from "@/lib/elearning/_handlers/notify";
import { registerLeadConvertedHandlers } from "@/lib/crm/_handlers/lead-converted";
import { registerR7NotificationHandlers } from "@/lib/_handlers/r7-notifications";
import { registerR7LifecycleHandlers } from "@/lib/_handlers/r7-lifecycle";
import { registerReportCardHandlers } from "@/lib/_handlers/report-card";
import { registerHomeworkAssignHandlers } from "@/lib/events/handlers/homework-assign";
import { registerTrialNotifHandlers } from "@/lib/_handlers/trial-notif";
import { registerMakeupNotifHandlers } from "@/lib/_handlers/makeup-notif";
import { registerEvalNotifHandlers } from "@/lib/_handlers/eval-notif";
import { registerHomeworkNotifHandlers } from "@/lib/_handlers/homework-notif";
import { registerScormIngestHandlers } from "@/lib/events/handlers/scorm-ingest";
import { registerTrialScheduleNotifHandlers } from "@/lib/_handlers/trial-schedule-notif";
import { registerTrialEvalNotifHandlers } from "@/lib/_handlers/trial-eval-notif";
import { registerAccountNotifHandlers } from "@/lib/_handlers/account-notif";
import { registerCommentNotifHandlers } from "@/lib/_handlers/comment-notif";
import { registerConversationNotifHandlers } from "@/lib/_handlers/conversation-notif";
import { registerParentRequestHandlers } from "@/lib/events/handlers/parent-request";
import { registerChatParticipantRemovedHandlers } from "@/lib/chat/_handlers/participant-removed";
import { registerAttendanceDayHandlers } from "@/lib/cham-cong/_handlers/attendance-day";
import { registerHoaDonHandlers } from "@/lib/finance/hoa-don/gui-email";

let registered = false;

export function ensureHandlersRegistered(): void {
  if (registered) return;
  registered = true;
  registerPingDemo();
  registerLeadConvertedHandlers(); // R2 C2.5 — gửi xác nhận đăng ký sau convert
  registerR7NotificationHandlers(); // R7-17 — payment.confirmed / class.session_changed / lead.trialAttended
  registerR7LifecycleHandlers(); // R7-07 — enrollment.assigned / session.taught
  registerReportCardHandlers(); // R7-15 — reportcard.published → thông báo PH
  registerHomeworkAssignHandlers(); // R7-14 — session.taught → auto-giao HomeworkAssignment
  registerTrialNotifHandlers(); // R7-17 — trial.assigned → báo Sale xếp lớp trải nghiệm
  registerMakeupNotifHandlers(); // R7-17 — makeup.requested / makeup.confirmed → thông báo HV
  registerEvalNotifHandlers(); // R7-17 — eval.opened → thông báo HV/PH đợt đánh giá/khảo sát
  registerHomeworkNotifHandlers(); // R7-17 — session.taught → thông báo "Bài tập mới" cho HV
  registerScormIngestHandlers(); // R7-11 — scorm.uploaded → giải nén + upload R2 + parse manifest → tự phát hành + thay giáo án cũ
  registerTrialScheduleNotifHandlers(); // R7-17 — trial.schedule_changed → báo Sale phụ trách
  registerTrialEvalNotifHandlers(); // 03/09 — trial.evaluated → báo Sale phiếu đã chấm xong
  registerAccountNotifHandlers(); // R7-17 — account.activated → chào mừng PH lên portal
  registerCommentNotifHandlers(); // R7-17 — comment.added → báo PH có nhận xét mới của GV
  registerConversationNotifHandlers(); // LMS-15 — conversation.message_posted → báo GV (PH gửi) / PH (GV trả lời)
  registerParentRequestHandlers(); // #08 — parent_request.created → báo Sale + Quản lý cơ sở
  registerChatParticipantRemovedHandlers(); // US-07/F-KICK — chat.participant_removed → đá client ra khỏi kênh realtime
  registerElearningNotifyHandlers(); // EL-06 — giao bài / quá hạn / hoàn thành → in-app + email (KHÔNG ZNS)
  registerAttendanceDayHandlers(); // Chấm công v3 L2 — hr.attendance_day_dirty → recomputeAttendanceDay (không xin khe cron)
  registerHoaDonHandlers(); // Hoá đơn điện tử GĐ 6 — hoa-don.gui → xếp email · hoa-don.khong-email → báo sale gửi Zalo
}
