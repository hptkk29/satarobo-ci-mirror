/**
 * Seed 3 khảo sát trung tâm cho Portal v2 (giống SataUI 3 thẻ danh mục).
 *   pnpm tsx prisma/seed-test-surveys.ts
 * Idempotent: xoá survey test theo title rồi tạo lại. KHÔNG cho prod.
 */
import { db } from "../lib/db";
import { laDbCucBo, laTenDbTest, loiTunnelVps } from "../lib/security/url-db-cuc-bo";

const SURVEYS = [
  {
    title: "Chất lượng giảng dạy & Giáo trình",
    description: "Đánh giá chất lượng bài giảng và phương pháp truyền đạt tại trung tâm.",
    q: 8,
  },
  {
    title: "Cơ sở vật chất & Phòng Lab",
    description: "Khảo sát mức độ hài lòng về thiết bị, linh kiện và không gian học.",
    q: 5,
  },
  {
    title: "Dịch vụ & Chăm sóc học viên",
    description: "Đánh giá thái độ đón tiếp, hỗ trợ và cập nhật thông tin cho phụ huynh.",
    q: 5,
  },
];

async function main() {
  // Guard runtime: chỉ chạy trên DB test local — bên dưới deleteMany SurveyResponse
  // theo title trùng, trỏ nhầm DB dev/prod dùng chung sẽ xoá phản hồi THẬT.
  const dbUrl = process.env.DATABASE_URL ?? "";
  // 28/09/2026 — tunnel VPS (127.0.0.1:<cổng tunnel PROD>/:<cổng tunnel TEST>) trông y hệt DB máy ⇒ chặn trước.
  const tunnel = loiTunnelVps(dbUrl);
  if (tunnel) throw new Error(`seed-test-surveys: ${tunnel}`);
  if (!laDbCucBo(dbUrl) && !laTenDbTest(dbUrl)) {
    throw new Error(
      "seed-test-surveys: DATABASE_URL không phải DB test local (cần chứa 127.0.0.1/localhost/satarobo_test) — dừng.",
    );
  }

  const student = await db.student.findFirst({
    where: { studentCode: "CS1-TEST-002" },
    select: { id: true, centerId: true },
  });
  // Bail nếu thiếu student test: KHÔNG fallback centerId=null (survey toàn hệ thống
  // sẽ hiện cho mọi phụ huynh ở mọi cơ sở).
  if (!student?.centerId) {
    throw new Error(
      "seed-test-surveys: không tìm thấy student test CS1-TEST-002 (có centerId) — chạy seed-test-parent trước.",
    );
  }
  const centerId = student.centerId;

  const titles = SURVEYS.map((s) => s.title);
  const existing = await db.survey.findMany({ where: { title: { in: titles } }, select: { id: true } });
  if (existing.length) {
    await db.surveyQuestion.deleteMany({ where: { surveyId: { in: existing.map((e) => e.id) } } });
    await db.surveyResponse.deleteMany({ where: { surveyId: { in: existing.map((e) => e.id) } } });
    await db.survey.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } });
  }

  const createdIds: string[] = [];
  for (const s of SURVEYS) {
    const created = await db.survey.create({
      data: {
        title: s.title,
        description: s.description,
        milestone: "GENERAL",
        isActive: true,
        centerId,
        questions: {
          create: Array.from({ length: s.q }, (_, i) => ({
            text: `Câu hỏi ${i + 1}`,
            type: "RATING" as const,
            order: i + 1,
          })),
        },
      },
      select: { id: true },
    });
    createdIds.push(created.id);
  }

  // 1 survey "đã làm" cho student test (2 survey còn lại "chưa làm") — đối chiếu
  // badge Đã làm/Chưa làm theo con + kiểm RSC payload /portal/khao-sat không còn
  // text câu hỏi của survey đã trả lời.
  const answeredId = createdIds[0];
  if (answeredId) {
    await db.surveyResponse.create({
      data: { surveyId: answeredId, studentId: student.id, centerId },
    });
  }

  console.log(
    `✅ Seed khảo sát: ${SURVEYS.length} survey (center=${centerId ?? "ALL"}), 1 survey đã trả lời cho student ${student.id}.`,
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌", e);
    await db.$disconnect();
    process.exit(1);
  });
