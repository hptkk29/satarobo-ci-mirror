// app/(teacher)/teacher/kho-bai-tap/_types.ts — plain data server → client (Kho bài tập).
//
// Parity 18/08: câu hỏi truyền xuống client theo shape ContentQuestion (8 loại) —
// deserialize từ hàng Question ở server (question-content-db.ts), dùng thẳng cho
// preview (QuestionView) lẫn editor (QuestionListEditor).
import type { AssignmentKind } from "@prisma/client";
import type { ContentQuestion } from "@/lib/assignments/question-content";

export interface KhoTemplate {
  id: string;
  title: string;
  description: string;
  kind: AssignmentKind; // HOMEWORK = "Bài tập" · CLASSWORK = "Kiểm tra"
  /** Khoá học của đề (suy từ curriculum.courseId) — null = dùng chung mọi khoá. */
  courseId: string | null;
  courseName: string | null;
  totalPoints: number;
  questionCount: number;
  /** Đã format "dd/MM/yyyy" (giờ VN) — string để truyền xuống client an toàn. */
  createdAt: string;
  questions: ContentQuestion[];
}

/** Khoá học GV có thể gắn đề (suy từ lớp phụ trách). */
export interface KhoCourseOption {
  id: string;
  name: string;
}
