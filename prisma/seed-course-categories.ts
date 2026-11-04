// Đợt 3D bước 3 — chuẩn hoá danh mục/khoá. Idempotent. KHÔNG xoá dữ liệu.
// Chạy: pnpm exec dotenv -e .env -- tsx prisma/seed-course-categories.ts
import { db } from "../lib/db";
import { CourseCategory } from "@prisma/client";

const TEACHABLE: Record<string, CourseCategory> = {
  sata1: "LUYEN_THI_ROBOSIM",
  sata2: "LUYEN_THI_ROBOSIM",
  "combo-luyen-thi": "LUYEN_THI_ROBOSIM",
  sata8: "LUYEN_THI_ROBOSIM",
  sata3: "LAP_TRINH_ROBOT",
  sata4: "LAP_TRINH_ROBOT",
  sata5: "LAP_TRINH_ROBOT",
  sata6: "LAP_TRINH_ROBOT",
  sata7: "LAP_TRINH_ROBOT",
};

async function main() {
  // 1) Gán category + isTeachable cho khoá cụ thể.
  for (const [slug, category] of Object.entries(TEACHABLE)) {
    const r = await db.course.updateMany({
      where: { slug },
      data: { category, isTeachable: true },
    });
    console.log(`  ✓ ${slug} → ${category} teachable=true (${r.count} updated)`);
  }
  // 2) Mọi khoá KHÁC (LTR/LTRS, …) → không phải khoá dạy.
  const reset = await db.course.updateMany({
    where: { slug: { notIn: Object.keys(TEACHABLE) } },
    data: { category: null, isTeachable: false },
  });
  console.log(`  ✓ ${reset.count} khoá khác → category=null, isTeachable=false`);

  // 3) Giữ tiên quyết Sata8 ← Sata1.
  const [s8, s1] = await Promise.all([
    db.course.findUnique({ where: { slug: "sata8" }, select: { id: true } }),
    db.course.findUnique({ where: { slug: "sata1" }, select: { id: true } }),
  ]);
  if (s8 && s1) {
    await db.coursePrerequisite.upsert({
      where: { courseId_requiredCourseId: { courseId: s8.id, requiredCourseId: s1.id } },
      update: {},
      create: { courseId: s8.id, requiredCourseId: s1.id },
    });
    console.log("  ✓ Tiên quyết Sata8 ← Sata1 đảm bảo tồn tại");
  }

  // 4) CẢNH BÁO: Class/Curriculum trỏ vào khoá KHÔNG teachable → cần xử lý thủ công.
  const badClasses = await db.class.findMany({
    where: { course: { isTeachable: false } },
    select: { id: true, name: true, classCode: true, course: { select: { code: true, name: true } } },
  });
  const badCurric = await db.curriculum.findMany({
    where: { course: { isTeachable: false } },
    select: { id: true, name: true, course: { select: { code: true, name: true } } },
  });
  console.log(`\n=== CẢNH BÁO (cần người dùng quyết, KHÔNG tự đổi) ===`);
  console.log(`Class trỏ vào khoá không-teachable: ${badClasses.length}`);
  badClasses.forEach((c) => console.log(`  - Lớp "${c.classCode ?? c.name}" → khoá ${c.course.code ?? c.course.name}`));
  console.log(`Curriculum trỏ vào khoá không-teachable: ${badCurric.length}`);
  badCurric.forEach((c) => console.log(`  - Giáo trình "${c.name}" → khoá ${c.course.code ?? c.course.name}`));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
