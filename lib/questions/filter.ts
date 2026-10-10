import type { Prisma, QuestionType, QuestionDifficulty } from "@prisma/client";

/**
 * FL1-03 — bộ lọc ngân hàng câu hỏi.
 *
 * Tách thành helper thuần (không đụng DB) để:
 *  - trang danh sách `/admin/questions` dùng,
 *  - picker khi soạn bài tập (assignment) dùng chung (lọc theo khung CT,
 *    vd chọn Sata 4 chỉ thấy câu hỏi khung Sata 4),
 *  - test logic lọc độc lập.
 */
export interface QuestionFilter {
  /** Tìm trong `text` hoặc `questionCode`. */
  q?: string | null;
  type?: QuestionType | null;
  difficulty?: QuestionDifficulty | null;
  /** Khung chương trình — lọc theo `Question.curriculumId`. */
  curriculumId?: string | null;
  /** Khoá dạy — lọc theo `Question.courseId`. */
  courseId?: string | null;
  lessonId?: string | null;
  tag?: string | null;
  /** Chỉ lấy câu hỏi public (dùng cho picker chia sẻ giữa GV). */
  publicOnly?: boolean;
}

function clean(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Dựng `Prisma.QuestionWhereInput` từ bộ lọc đã chuẩn hoá.
 * Bỏ qua field trống. Khi `curriculumId` được set → chỉ trả câu hỏi đúng
 * khung chương trình đó (AC2: soạn bài Sata 4 không thấy câu Sata 3).
 */
export function buildQuestionWhere(
  filter: QuestionFilter,
): Prisma.QuestionWhereInput {
  const q = clean(filter.q);
  const curriculumId = clean(filter.curriculumId);
  const courseId = clean(filter.courseId);
  const lessonId = clean(filter.lessonId);
  const tag = clean(filter.tag);

  const where: Prisma.QuestionWhereInput = {
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.difficulty ? { difficulty: filter.difficulty } : {}),
    ...(curriculumId ? { curriculumId } : {}),
    ...(courseId ? { courseId } : {}),
    ...(lessonId ? { lessonId } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
    ...(filter.publicOnly ? { isPublic: true } : {}),
    ...(q
      ? {
          OR: [
            { text: { contains: q, mode: "insensitive" as const } },
            { questionCode: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  return where;
}
