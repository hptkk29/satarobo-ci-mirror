import "server-only";
// Đọc bài làm TỪNG CÂU của một bài nộp cho màn chấm của giáo viên. Phần dựng nằm ở `xem-bai-lam.ts` (thuần, có test).
//
// ⚠️ Hàm này KHÔNG tự kiểm quyền: người gọi phải ĐÃ đọc bài nộp qua `scopedDb` và đối chiếu lớp với `assignedClassIds` (cả hai màn chấm đều
// làm vậy trước khi vẽ). Bản xem mang ĐÁP ÁN ĐÚNG — không bao giờ đưa nó sang cổng học viên/phụ huynh.
import { db } from "@/lib/db";
import { deserializeQuestionRow } from "@/lib/assignments/question-content-db";
import type { DapAn } from "@/lib/assignments/lam-bai";
import { dungBaiLamXem, type BaiLamXem } from "@/lib/assignments/xem-bai-lam";

/** Bài không có câu hỏi nào ⇒ null (màn chấm giữ nguyên dạng cũ: văn bản + tệp). */
export async function docBaiLamChoGV(input: {
  submissionId: string;
  assignmentId: string;
  totalPoints: number;
}): Promise<BaiLamXem | null> {
  const rows = await db.question.findMany({
    where: { assignmentId: input.assignmentId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      type: true,
      text: true,
      correctAnswer: true,
      meta: true,
      points: true,
      choices: { select: { order: true, text: true, isCorrect: true } },
    },
  });
  if (rows.length === 0) return null;
  const traLoi = await db.assignmentAnswer.findMany({
    where: { submissionId: input.submissionId },
    select: { questionId: true, answer: true },
  });
  return dungBaiLamXem(
    rows.map((r) => ({ q: deserializeQuestionRow(r), diemCau: r.points })),
    new Map(traLoi.map((t) => [t.questionId, t.answer as unknown as DapAn])),
    input.totalPoints,
  );
}
