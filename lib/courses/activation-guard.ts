// R7-03 — Guard: course có curriculum published/active hay không.
// Consumed by R7-06 để chặn kích hoạt lớp khi course chưa có curriculum.
import { db } from "@/lib/db";

/**
 * true nếu course có ≥1 Curriculum đang active (isActive: true) VÀ
 * status = ACTIVE (giá trị published/active của CurriculumStatus).
 */
export async function courseHasActiveCurriculum(courseId: string): Promise<boolean> {
  const count = await db.curriculum.count({
    where: {
      courseId,
      isActive: true,
      status: "ACTIVE",
    },
  });
  return count > 0;
}
