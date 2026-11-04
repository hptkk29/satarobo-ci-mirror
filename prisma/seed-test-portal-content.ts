/**
 * Seed nội dung portal cho tài khoản test: nhận xét buổi học + ảnh lớp + consent media.
 *   pnpm tsx prisma/seed-test-portal-content.ts
 * Idempotent. KHÔNG cho prod.
 */
import { db } from "../lib/db";

const CLASS_ID = "cmqqhcvoj00061ey49q5eqc20";

const PHOTO_CAPTIONS = [
  ["Khám phá bộ kit Robotics", "Hướng dẫn an toàn phòng lab"],
  ["Lắp cảm biến siêu âm", "Đo khoảng cách thực tế", "Thảo luận nhóm"],
  ["Điều khiển động cơ DC", "Thử nghiệm bánh xe"],
  ["Dò đường hồng ngoại", "Robot chạy theo line"],
  ["Lắp ráp khung gầm", "Kiểm tra kết cấu", "Chạy thử nghiệm"],
];

function fb(name: string, lesson: string): string {
  return [
    "Đánh giá tổng quan quá trình học tập",
    `Điểm nổi bật: ${name} chủ động thực hành "${lesson}", làm đúng các bước và biết kiểm chứng kết quả.`,
    `Tiến bộ: So với buổi trước, con đã tự tin thao tác hơn và ít cần thầy nhắc lại.`,
    `Cần cải thiện: Con cần thao tác nhanh hơn một chút để theo kịp nhịp bài giảng.`,
    `Đề xuất: Cùng con ôn lại kiến thức buổi này ở nhà, khuyến khích con giải thích lại cách làm.`,
  ].join("\n");
}

async function main() {
  const students = await db.student.findMany({
    where: { studentCode: { in: ["CS1-TEST-001", "CS1-TEST-002"] } },
    select: { id: true, name: true },
  });
  const cls = await db.class.findUnique({ where: { id: CLASS_ID }, select: { teacherId: true } });
  const teacherId = cls?.teacherId ?? students[0]?.id ?? "";

  // Buổi đã qua (có lesson), sắp xếp cũ → mới
  const past = await db.classSession.findMany({
    where: { classId: CLASS_ID, date: { lt: new Date() } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, lesson: { select: { order: true, title: true } } },
  });

  // 1) Consent CLASS_MEDIA = GRANTED (để ảnh hiện)
  for (const s of students) {
    await db.studentConsent.upsert({
      where: { studentId_type: { studentId: s.id, type: "CLASS_MEDIA" } },
      update: { status: "GRANTED", revokedAt: null },
      create: { studentId: s.id, type: "CLASS_MEDIA", status: "GRANTED" },
    });
  }

  // 2) Nhận xét buổi học (mỗi con, 4 buổi gần nhất đã qua)
  const fbSessions = past.slice(-4);
  await db.studentSessionFeedback.deleteMany({
    where: { studentId: { in: students.map((s) => s.id) }, classSessionId: { in: past.map((p) => p.id) } },
  });
  let fbCount = 0;
  for (const s of students) {
    for (const ses of fbSessions) {
      await db.studentSessionFeedback.create({
        data: {
          classSessionId: ses.id,
          studentId: s.id,
          comment: fb(s.name, ses.lesson?.title ?? "buổi học"),
          rating: 4,
          createdById: teacherId,
        },
      });
      fbCount++;
    }
  }

  // 3) Ảnh lớp (class-wide, APPROVED) cho 5 buổi đầu đã qua
  const oldMedia = await db.classSessionMedia.findMany({ where: { classId: CLASS_ID }, select: { id: true } });
  if (oldMedia.length) await db.classSessionMedia.deleteMany({ where: { id: { in: oldMedia.map((m) => m.id) } } });
  let mediaCount = 0;
  const mediaSessions = past.slice(0, 5);
  for (let i = 0; i < mediaSessions.length; i++) {
    const ses = mediaSessions[i];
    const caps = PHOTO_CAPTIONS[i % PHOTO_CAPTIONS.length];
    for (let j = 0; j < caps.length; j++) {
      await db.classSessionMedia.create({
        data: {
          classId: CLASS_ID,
          classSessionId: ses.id,
          fileUrl: `seed-placeholder://${ses.id}-${j}`,
          caption: caps[j],
          status: "APPROVED",
          isClassWide: true,
          takenAt: ses.date,
          uploadedById: teacherId,
          uploadedByName: "Giáo viên",
          approvedById: teacherId,
          approvedByName: "Giáo viên",
          approvedAt: ses.date,
        },
      });
      mediaCount++;
    }
  }

  console.log(`✅ Seed portal content: ${fbCount} nhận xét, ${mediaCount} ảnh (5 buổi), consent GRANTED cho ${students.length} con.`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌", e);
    await db.$disconnect();
    process.exit(1);
  });
