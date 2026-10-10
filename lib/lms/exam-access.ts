// lib/lms/exam-access.ts — rà soát GIAO/NỘP/CHẤM: quyền làm đề + chuyển trạng thái
// HomeworkAssignment. Tách khỏi app/(portal)/portal/bai-thi/actions.ts ("use server"
// cần session) để test service-level được (tests/e2e/r7/assignment-fixes.spec.ts).
//
// 2 lỗi vá:
//   (a) Đề DÙNG CHUNG (classId=null) được auto-giao qua HomeworkAssignment
//       (lib/lms/assignment.ts — chủ đích OR {classId:null}) nhưng mọi cửa làm bài
//       đều `if (!classId) chặn` → ngõ cụt, HV không có đường nào làm. Nay:
//       classId=null → ownership = tồn tại HomeworkAssignment {studentId, examId}.
//   (b) HomeworkAssignment.status không bao giờ rời ASSIGNED (toàn repo không có
//       update nào) → PH thấy "Đã làm 0/N" vĩnh viễn. Nay flip khi submitAttempt.
//
// An toàn: mọi query neo studentId tường minh (caller lấy từ requireActiveStudent).
// Dùng db gốc là đúng tầng lib (như lib/portal/learning.ts); HomeworkAssignment vốn
// pass-through trong portalDb (không có đường sở hữu map sẵn).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/** HV "đang học" — khớp ACTIVE_ENROLLMENT của portal bai-thi. */
const ACTIVE_ENROLLMENT = ["CONFIRMED", "STUDYING", "ACTIVE"] as const;

/**
 * HS có quyền làm đề này không:
 * - Đề gắn lớp → phải đang học lớp đó (enrollment active, chưa xoá — FIX-C3).
 * - Đề dùng chung (classId=null) → phải ĐÃ được giao qua HomeworkAssignment.
 */
export async function studentCanAccessExam(opts: {
  studentId: string;
  examId: string;
  classId: string | null;
}): Promise<boolean> {
  if (opts.classId) {
    const enr = await db.enrollment.findFirst({
      where: {
        studentId: opts.studentId,
        classId: opts.classId,
        status: { in: [...ACTIVE_ENROLLMENT] },
        deletedAt: null, // FIX-C3
      },
      select: { id: true },
    });
    return !!enr;
  }
  const hw = await db.homeworkAssignment.findFirst({
    where: { studentId: opts.studentId, examId: opts.examId },
    select: { id: true },
  });
  return !!hw;
}

/**
 * Sau khi HV nộp attempt: HomeworkAssignment {studentId, examId} đang ASSIGNED →
 * SUBMITTED (đề có tự luận — chờ GV chấm) / GRADED (auto-chấm xong) — khớp đúng cách
 * submitAttempt phân biệt khi set ExamAttempt. Gọi TRONG transaction nộp bài (tx
 * chuẩn của portalTx). Chỉ đụng ASSIGNED — GRADED/MISSED giữ nguyên.
 */
export async function markHomeworkAfterAttempt(
  tx: Prisma.TransactionClient,
  opts: { studentId: string; examId: string; graded: boolean },
): Promise<number> {
  const res = await tx.homeworkAssignment.updateMany({
    where: { studentId: opts.studentId, examId: opts.examId, status: "ASSIGNED" },
    data: { status: opts.graded ? "GRADED" : "SUBMITTED" },
  });
  return res.count;
}
