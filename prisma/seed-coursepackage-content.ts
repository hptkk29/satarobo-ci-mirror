import { PrismaClient } from "@prisma/client";
import { courseDetails } from "../components/legacy-laptrinhrobot/_data/courses-details";

/**
 * Migrate detail content từ courses-details.ts → CoursePackage DB.
 * Idempotent: re-run sẽ overwrite các field nội dung nhưng KHÔNG đụng tới
 * các field khác (slug, code, name, price, etc).
 *
 * Sau khi seed chạy lần đầu, admin có thể edit qua /admin/course-packages
 * mà KHÔNG bị overwrite (vì seed chỉ chạy manual khi anh muốn reset).
 */
export async function seedCoursePackageContent(db: PrismaClient) {
  let updated = 0;
  let missing = 0;

  for (const [slug, detail] of Object.entries(courseDetails)) {
    const existing = await db.coursePackage.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!existing) {
      console.warn(
        `[seed-cp-content] CoursePackage slug=${slug} KHÔNG tồn tại — skip`,
      );
      missing++;
      continue;
    }

    await db.coursePackage.update({
      where: { slug },
      data: {
        audienceTag: detail.audienceTag,
        audienceDescription: detail.audienceDescription,
        mission: detail.mission,
        outcomesJson: detail.outcomes,
        // highlights → reuse existing field
        highlights: detail.highlights,
        noteForParents: detail.noteForParents ?? null,
        // SEO fields: ưu tiên giữ existing trong DB nếu admin đã edit
        // (KHÔNG overwrite seoTitle / seoDescription)
      },
    });
    updated++;
  }

  console.log(
    `CoursePackage detail content: ${updated} updated · ${missing} missing`,
  );
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedCoursePackageContent(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
