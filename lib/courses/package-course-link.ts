// lib/courses/package-course-link.ts — FL1-05: gộp gói bán (CoursePackage) ↔ khoá dạy (Course).
// Gói = đơn vị BÁN (giá, marketing). Khoá = đơn vị DẠY (catalog, curriculum).
// Khi gói có `courseId` → giáo trình lấy từ Course (relation); JSON `curriculum` cũ
// GIỮ làm fallback (deprecate 2-phase — KHÔNG xoá). Các hàm dưới THUẦN → test được.

/** 1 mục giáo trình hiển thị (topic + số buổi). */
export type CurriculumRef = { topic: string; lessons: number };

/** Nguồn giáo trình của 1 gói: liên kết khoá dạy ("course") hoặc JSON cũ ("json"). */
export type CurriculumSource = "course" | "json";

/** Có liên kết khoá dạy không (chỉ dựa vào courseId — không suy từ field khác). */
export function hasLinkedCourse(pkg: { courseId?: string | null }): boolean {
  return Boolean(pkg.courseId);
}

/** Chuẩn hoá JSON curriculum cũ (mảng {topic, lessons}) — bỏ phần tử rác. */
export function normalizeJsonCurriculum(value: unknown): CurriculumRef[] {
  if (!Array.isArray(value)) return [];
  const out: CurriculumRef[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const topic = typeof rec.topic === "string" ? rec.topic : "";
    if (!topic) continue;
    const lessons = typeof rec.lessons === "number" && Number.isFinite(rec.lessons) ? rec.lessons : 0;
    out.push({ topic, lessons });
  }
  return out;
}

/**
 * Quyết định giáo trình hiển thị cho 1 gói.
 * - Gói có courseId VÀ khoá dạy có giáo trình → dùng giáo trình của khoá (source "course").
 * - Ngược lại → fallback JSON cũ của gói (source "json"). JSON luôn được giữ, không drop.
 */
export function resolvePackageCurriculum(
  pkg: { courseId?: string | null; curriculum?: unknown },
  courseCurriculum: CurriculumRef[] | null | undefined,
): { source: CurriculumSource; items: CurriculumRef[] } {
  if (hasLinkedCourse(pkg) && courseCurriculum && courseCurriculum.length > 0) {
    return { source: "course", items: courseCurriculum };
  }
  return { source: "json", items: normalizeJsonCurriculum(pkg.curriculum) };
}
