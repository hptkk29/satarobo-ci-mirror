// lib/_handlers/exam-notif.ts — V8.24: thông báo khi GIÁO VIÊN/NHÂN SỰ CHẤM BÀI THI (ExamAttempt — LMS lớp offline).
//
//   exam.attempt.graded  { attemptId, examId, studentId, gradedAtMs }  → «Bài thi đã được chấm» cho học viên của lượt thi
//
// Ghi vào bảng `Notification` (audience=STUDENT + studentId) — cùng nguồn với «Bài tập đã được chấm» (assignment-notif.ts): chuông phụ huynh web và `GET /notifications` của app đọc chung.
// ⛔ NỘI DUNG KHÔNG CHỨA ĐIỂM / NHẬN XÉT / ĐẠT-KHÔNG ĐẠT: điểm chỉ hiện khi đề cho phép (`showResultAfterSubmit`) và theo cấu hình hiển thị điểm; thông báo chỉ nói «đã chấm».
// ⛔ Cờ `PORTAL_BAI_TAP_BAI_THI_ENABLED` TẮT ⇒ KHÔNG tạo thông báo (route/menu cũng ẩn; kiểm lúc xử lý sự kiện, một chỗ). KHÔNG cộng SataCoin, không gửi push. Không tin payload: đọc lại lượt thi, CHỈ báo khi lượt thật sự GRADED và thuộc đúng học viên trong payload.
// Idempotent: `dedupeKey` UNIQUE ⇒ dispatcher retry / phát trùng không tạo hai dòng. Cố ý KHÔNG nuốt lỗi DB (để outbox retry).
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { mucBaiTapBaiThiDangHien } from "@/lib/portal/muc-tam-an";

const str = (v: unknown): string => (v == null ? "" : String(v));

export async function onExamAttemptGradedNotif(event: DomainEventLite): Promise<void> {
  if (!mucBaiTapBaiThiDangHien()) return; // «Bài tập & bài thi» đang ẩn (PORTAL_BAI_TAP_BAI_THI_ENABLED tắt) ⇒ không báo về thứ không hiện
  const attemptId = str(event.payload.attemptId);
  const studentId = str(event.payload.studentId);
  const moc = Number(event.payload.gradedAtMs);
  if (!attemptId || !studentId || !Number.isFinite(moc)) return;
  const l = await db.examAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, studentId: true, status: true, exam: { select: { id: true, title: true, classId: true, class: { select: { centerId: true } } } } },
  });
  if (!l || l.studentId !== studentId || l.status !== "GRADED") return;
  await db.notification.createMany({
    data: [
      {
        title: "Bài thi đã được chấm",
        body: `Giáo viên đã chấm bài thi «${l.exam.title}».`,
        audience: "STUDENT" as const,
        studentId: l.studentId,
        classId: l.exam.classId,
        centerId: l.exam.class?.centerId ?? null,
        isPublished: true,
        dedupeKey: `exam.attempt.graded:${l.id}:${moc}`,
      },
    ],
    skipDuplicates: true,
  });
}

export function registerExamNotifHandlers(): void {
  on("exam.attempt.graded", onExamAttemptGradedNotif);
}
