/**
 * Seed MakeupNeed cho lớp test (Portal v2 — trang Yêu cầu học bù giống SataUI).
 *   pnpm tsx prisma/seed-test-makeup.ts
 * Idempotent: upsert theo unique [studentId, missedSessionId]. KHÔNG cho prod.
 * Cần chạy sau seed-test-sessions (dùng buổi đã qua làm buổi lỡ).
 */
import { db } from "../lib/db";
import { laDbCucBo, laTenDbTest, loiTunnelVps } from "../lib/security/url-db-cuc-bo";

const CLASS_ID = "cmqqhcvoj00061ey49q5eqc20";

async function main() {
  // Guard runtime: chỉ chạy trên DB test local — bên dưới deleteMany MakeupNeed,
  // .env local đang trỏ Supabase DEV dùng chung → trỏ nhầm sẽ xoá dữ liệu THẬT
  // (cùng lý do guard ở seed-test-surveys.ts).
  const dbUrl = process.env.DATABASE_URL ?? "";
  // 28/09/2026 — tunnel VPS (127.0.0.1:<cổng tunnel PROD>/:<cổng tunnel TEST>) trông y hệt DB máy ⇒ chặn trước.
  const tunnel = loiTunnelVps(dbUrl);
  if (tunnel) throw new Error(`seed-test-makeup: ${tunnel}`);
  if (!laDbCucBo(dbUrl) && !laTenDbTest(dbUrl)) {
    throw new Error(
      "seed-test-makeup: DATABASE_URL không phải DB test local (cần chứa 127.0.0.1/localhost/satarobo_test) — dừng.",
    );
  }

  const cls = await db.class.findUnique({ where: { id: CLASS_ID }, select: { centerId: true, courseId: true } });
  if (!cls) throw new Error(`Không tìm thấy lớp test ${CLASS_ID} — kiểm tra CLASS_ID / chạy seed-test-sessions trước.`);
  const students = await db.student.findMany({
    where: { studentCode: { in: ["CS1-TEST-001", "CS1-TEST-002"] } },
    select: { id: true },
  });
  if (students.length === 0) throw new Error("Chưa có học viên test — chạy seed-test-parent + seed-test-sessions trước.");

  // Dọn MakeupNeed cũ của lớp test: seed-test-sessions xoá + tạo lại session với ID MỚI,
  // missedSessionId là cột phẳng (không FK) → row cũ thành orphan tích luỹ nếu không xoá.
  await db.makeupNeed.deleteMany({
    where: { classId: CLASS_ID, studentId: { in: students.map((s) => s.id) } },
  });

  // Buổi đã qua (COMPLETED), sớm→muộn.
  const past = await db.classSession.findMany({
    where: { classId: CLASS_ID, status: "COMPLETED" },
    orderBy: { date: "asc" },
    select: { id: true, lessonId: true },
  });
  if (past.length < 3) throw new Error("Chưa đủ buổi đã qua — chạy seed-test-sessions trước.");

  const doneSess = past[0]; // buổi đã bù xong (lịch sử)
  const needSess = past[2]; // buổi vắng cần bù (idx=2, khớp attendance ABSENT)

  let n = 0;
  for (const st of students) {
    // 1) PENDING — buổi cần học bù
    await db.makeupNeed.upsert({
      where: { studentId_missedSessionId: { studentId: st.id, missedSessionId: needSess.id } },
      update: { status: "PENDING", note: "Nghỉ có phép", classId: CLASS_ID, centerId: cls?.centerId ?? null, missedLessonId: needSess.lessonId },
      create: {
        studentId: st.id,
        classId: CLASS_ID,
        centerId: cls?.centerId ?? null,
        missedSessionId: needSess.id,
        missedLessonId: needSess.lessonId,
        courseId: cls.courseId,
        sourceType: "ABSENCE",
        status: "PENDING",
        note: "Nghỉ có phép",
      },
    });
    // 2) COMPLETED — lịch sử đã học bù
    await db.makeupNeed.upsert({
      where: { studentId_missedSessionId: { studentId: st.id, missedSessionId: doneSess.id } },
      update: { status: "COMPLETED", note: "Nghỉ ốm", classId: CLASS_ID, centerId: cls?.centerId ?? null, missedLessonId: doneSess.lessonId, completedAt: new Date() },
      create: {
        studentId: st.id,
        classId: CLASS_ID,
        centerId: cls?.centerId ?? null,
        missedSessionId: doneSess.id,
        missedLessonId: doneSess.lessonId,
        courseId: cls.courseId,
        sourceType: "ABSENCE",
        status: "COMPLETED",
        note: "Nghỉ ốm",
        completedAt: new Date(),
      },
    });
    n += 2;
  }

  console.log(`✅ Seed học bù: ${n} MakeupNeed (mỗi con 1 PENDING + 1 COMPLETED).`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌", e);
    await db.$disconnect();
    process.exit(1);
  });
