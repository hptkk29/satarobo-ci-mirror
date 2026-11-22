// prisma/seed-lms/index.ts — Orchestrator seed test diện rộng LMS + CRM.
//
// CHẠY (DB local test — an toàn):
//   pnpm exec dotenv -e .env.test -- tsx prisma/seed-lms/index.ts
// Yêu cầu chạy base seed trước (Center/Course/OrgUnit/Role/Dept/admin):
//   pnpm exec dotenv -e .env.test -- tsx prisma/seed.ts
//
// ENV:
//   SEED_SCALE=smoke|full   (mặc định smoke)
//   SEED_MODULES=all|staff,parents,content,classes,crm
//   SEED_PASSWORD=...        (mật khẩu login cho user seed; mặc định Test@2026!)
//   SEED_ALLOW_REMOTE=1      (bỏ guard local — TỰ CHỊU TRÁCH NHIỆM)
import { PrismaClient } from "@prisma/client";
import { loadConfig, enabledModules } from "./_config";
import { assertLocalDb, requireFoundation, seedRng, OPERATING_CENTERS } from "./_lib";
import { seedStaff, type TeacherPool } from "./staff";
import { seedParentsStudents, type StudentRec } from "./parents-students";
import { seedContent, type CourseContent } from "./content";
import { seedClasses } from "./classes";
import { seedCrm } from "./crm";

const db = new PrismaClient();

async function fetchTeacherPool(): Promise<TeacherPool> {
  const teachers = await db.user.findMany({
    where: { roles: { has: "TEACHER" }, centerId: { in: [...OPERATING_CENTERS] } },
    select: { id: true, centerId: true },
  });
  return teachers.filter((t) => t.centerId).map((t) => ({ userId: t.id, centerId: t.centerId! }));
}

async function fetchStudentRecs(): Promise<StudentRec[]> {
  const students = await db.student.findMany({
    where: { centerId: { in: [...OPERATING_CENTERS] }, parentUserId: { not: null } },
    select: { id: true, centerId: true, currentGrade: true },
  });
  return students
    .filter((s) => s.centerId)
    .map((s) => ({ id: s.id, centerId: s.centerId!, grade: s.currentGrade ?? 3 }));
}

async function fetchContent(courseIds: {
  laptrinhrobot: string;
  luyenthirobosim: string;
}): Promise<Record<string, CourseContent>> {
  const out: Record<string, CourseContent> = {};
  for (const courseId of [courseIds.laptrinhrobot, courseIds.luyenthirobosim]) {
    const cur = await db.curriculum.findFirst({
      where: { courseId },
      orderBy: { version: "desc" },
      select: { id: true, lessons: { orderBy: { order: "asc" }, select: { id: true } } },
    });
    if (cur) out[courseId] = { curriculumId: cur.id, lessonIds: cur.lessons.map((l) => l.id) };
  }
  return out;
}

async function summary(): Promise<void> {
  const [users, parents, students, classes, enrollments, sessions, attendance, scorm, docs, leads, orders, payments] =
    await Promise.all([
      db.user.count(),
      db.user.count({ where: { role: "PARENT" } }),
      db.student.count(),
      db.class.count(),
      db.enrollment.count(),
      db.classSession.count(),
      db.attendance.count(),
      db.scormPackage.count(),
      db.document.count(),
      db.lead.count(),
      db.order.count(),
      db.payment.count(),
    ]);
  console.log("\n📊 Tổng kết DB test:");
  console.table({
    "User (tổng)": users,
    "  ├─ Phụ huynh": parents,
    "Học viên (Student)": students,
    "Lớp (Class)": classes,
    "Ghi danh (Enrollment)": enrollments,
    "Buổi học (ClassSession)": sessions,
    "Điểm danh (Attendance)": attendance,
    "SCORM (ScormPackage)": scorm,
    "Slide (Document)": docs,
    "Lead (CRM)": leads,
    "Đơn (Order)": orders,
    "Thanh toán (Payment)": payments,
  });
}

async function main() {
  assertLocalDb();
  seedRng();
  const cfg = loadConfig();
  const mods = enabledModules();
  console.log(`🌱 Seed LMS test · scale=${cfg.scale} · modules=${[...mods].join(",")}`);
  const started = Date.now();

  const fnd = await requireFoundation(db);

  let teacherPool: TeacherPool | undefined;
  let studentRecs: StudentRec[] | undefined;
  let content: Record<string, CourseContent> | undefined;

  if (mods.has("staff")) teacherPool = await seedStaff(db, cfg);
  if (mods.has("parents")) studentRecs = await seedParentsStudents(db, cfg);
  if (mods.has("content")) content = await seedContent(db, cfg, fnd.courseIds, fnd.adminId);

  if (mods.has("classes")) {
    teacherPool ??= await fetchTeacherPool();
    studentRecs ??= await fetchStudentRecs();
    content ??= await fetchContent(fnd.courseIds);
    await seedClasses(db, cfg, studentRecs, teacherPool, content, fnd.courseIds);
  }

  if (mods.has("crm")) await seedCrm(db, cfg);

  await summary();
  console.log(`\n🎉 Hoàn tất trong ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error("❌ Seed LMS thất bại:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
