// prisma/seed-lms/content.ts — Seed nội dung LMS: Curriculum + Lesson mỗi khoá,
// slide PDF (Document type SLIDE/PDF, fileUrl→R2), và N gói SCORM (ScormPackage).
//
// SCORM/slide: MẶC ĐỊNH chỉ tạo ROW DB (fileUrl/storagePrefix trỏ key GIẢ, sizeBytes
// hiển thị 10-50MB). List/gắn-buổi/RBAC/đếm chạy đủ; bấm "mở player"/"xem PDF" sẽ 404
// cho tới khi upload file thật lên R2 (xem README). Không cần env R2 để seed.
import type { PrismaClient } from "@prisma/client";
import type { SeedConfig } from "./_config";
import { batchCreate, pad, pick, rand } from "./_lib";

export type CourseContent = {
  curriculumId: string;
  lessonIds: string[];
};

const R2_BASE = process.env.R2_PUBLIC_URL ?? "https://cdn.satarobo.test";
const MB = 1024 * 1024;

const LESSON_TOPICS = [
  "Làm quen bộ kit & an toàn",
  "Lắp ráp khung robot cơ bản",
  "Động cơ & truyền động",
  "Cảm biến chạm & phản ứng",
  "Cảm biến khoảng cách",
  "Lập trình khối kéo-thả",
  "Vòng lặp & điều kiện",
  "Robot dò đường",
  "Cảm biến màu sắc",
  "Điều khiển từ xa",
  "Dự án: Robot tránh vật cản",
  "Thuật toán cơ bản",
  "Biến & phép toán",
  "Robot phân loại vật",
  "Cánh tay robot",
  "Dự án nhóm giữa kỳ",
  "Lập trình Python nhập môn",
  "Xử lý sự kiện",
  "Robot thi đấu tốc độ",
  "AI nhận diện hình ảnh",
  "Tối ưu thuật toán thi đấu",
  "Chiến thuật RoboSim",
  "Ôn tập & tổng kết",
  "Dự án cuối khoá",
] as const;

export async function seedContent(
  db: PrismaClient,
  cfg: SeedConfig,
  courseIds: { laptrinhrobot: string; luyenthirobosim: string },
  adminId: string,
): Promise<Record<string, CourseContent>> {
  const uploaderEmp = await db.employee.findFirst({
    where: { department: "DAO_TAO" },
    select: { id: true },
  });

  const curricula: unknown[] = [];
  const lessons: unknown[] = [];
  const documents: unknown[] = [];
  const scorms: unknown[] = [];
  const byCourse: Record<string, CourseContent> = {};

  const courses = [
    { slug: "laptrinhrobot", id: courseIds.laptrinhrobot },
    { slug: "luyenthirobosim", id: courseIds.luyenthirobosim },
  ];

  // Gom danh sách lesson toàn cục để rải SCORM.
  const allLessons: { id: string }[] = [];

  for (const course of courses) {
    const curriculumId = `slms-cur-${course.slug}`;
    curricula.push({
      id: curriculumId,
      courseId: course.id,
      version: 1,
      name: `Giáo trình ${course.slug === "laptrinhrobot" ? "Lập trình Robot" : "Luyện thi RoboSim"} 2026`,
      description: "Giáo trình seed cho môi trường test LMS.",
      isActive: true,
      status: "ACTIVE",
    });

    const lessonIds: string[] = [];
    for (let order = 1; order <= cfg.lessonsPerCourse; order++) {
      const lessonId = `slms-les-${course.slug}-${pad(order, 3)}`;
      lessonIds.push(lessonId);
      allLessons.push({ id: lessonId });
      lessons.push({
        id: lessonId,
        curriculumId,
        order,
        title: `Buổi ${order}: ${LESSON_TOPICS[(order - 1) % LESSON_TOPICS.length]}`,
        description: "Nội dung buổi học (seed).",
        duration: 90,
        objectives: ["Hiểu khái niệm", "Thực hành lắp ráp", "Lập trình mẫu"],
        materials: ["Kit ZMRobo", "Laptop", "Thẻ lệnh OID"],
        status: order <= cfg.lessonsPerCourse - 2 ? "IN_USE" : "COMPLETE",
        teacherGuide: "Hướng dẫn giảng dạy (seed).",
        expectedOutput: "Robot hoàn thành nhiệm vụ buổi học.",
      });

      // Slide PDF cho buổi (Document).
      const [smin, smax] = cfg.slidesPerLesson;
      const nSlides = rand(smin, smax);
      for (let k = 1; k <= nSlides; k++) {
        const docId = `slms-doc-${course.slug}-${pad(order, 3)}-${k}`;
        documents.push({
          id: docId,
          documentCode: docId.toUpperCase(),
          title: `Slide buổi ${order} (${k})`,
          type: k === 1 ? "SLIDE" : "PDF",
          fileUrl: `${R2_BASE}/seed/slides/${course.slug}/buoi-${pad(order, 2)}-${k}.pdf`,
          fileName: `buoi-${pad(order, 2)}-${k}.pdf`,
          fileSize: rand(1, 8) * MB,
          mimeType: "application/pdf",
          lessonId,
          isPublic: false,
          tags: ["slide", course.slug],
          uploadedById: uploaderEmp?.id ?? null,
        });
      }
    }
    byCourse[course.id] = { curriculumId, lessonIds };
  }

  // Rải N gói SCORM lên N lesson đầu (mỗi lesson tối đa 1 active).
  const scormLessons = allLessons.slice(0, cfg.scormPackages);
  for (let n = 0; n < scormLessons.length; n++) {
    const lessonId = scormLessons[n]!.id;
    const scormId = `slms-scorm-${pad(n + 1, 3)}`;
    scorms.push({
      id: scormId,
      lessonId,
      name: `Bài giảng SCORM ${pad(n + 1, 2)} — ${pick(LESSON_TOPICS)}`,
      scormVersion: "SCORM_12",
      storagePrefix: `scorm/${scormId}/`,
      uploadKey: `scorm/${scormId}/source.zip`,
      launchUrl: "index.html",
      sizeBytes: rand(10, 50) * MB,
      fileCount: rand(25, 90),
      status: "PUBLISHED",
      version: 1,
      isActiveForLesson: true,
      uploadedById: adminId,
    });
  }

  await batchCreate("curricula", curricula, (b) => db.curriculum.createMany({ data: b as never, skipDuplicates: true }), 100);
  await batchCreate("lessons", lessons, (b) => db.lesson.createMany({ data: b as never, skipDuplicates: true }), 200);
  await batchCreate("documents (slides)", documents, (b) => db.document.createMany({ data: b as never, skipDuplicates: true }), 500);
  await batchCreate("scorm packages", scorms, (b) => db.scormPackage.createMany({ data: b as never, skipDuplicates: true }), 100);

  console.log(
    `✅ Content: ${curricula.length} Curriculum · ${lessons.length} Lesson · ${documents.length} slide(Document) · ${scorms.length} SCORM`,
  );
  return byCourse;
}
