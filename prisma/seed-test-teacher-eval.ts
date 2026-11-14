/**
 * Seed đợt Đánh giá Giáo viên (TEACHER_EVAL) cho Cổng học sinh demo form sao/emoji.
 *   pnpm tsx prisma/seed-test-teacher-eval.ts
 * Cần EVAL_V2_ENABLED=true để trang /portal/hoc-sinh/danh-gia-gv hiện form.
 * Idempotent theo tên form/đợt. KHÔNG cho prod (guard DB test-ưu tiên bỏ qua vì dev Supabase).
 */
import { db } from "../lib/db";

const FORM_TITLE = "Phiếu đánh giá GV (TEST)";
const ROUND_NAME = "Đợt đánh giá giữa khóa";

const QUESTIONS = [
  { type: "RADIO" as const, label: "Thầy/Cô dạy có vui và thân thiện không?", options: ["😢 Buồn", "😐 Bình thường", "🙂 Vui", "😄 Rất vui"], required: true },
  { type: "STAR_RATING" as const, label: "Em có dễ hiểu bài giảng và hướng dẫn không?", options: null, required: true },
  { type: "STAR_RATING" as const, label: "Lớp học có nhiều hoạt động thú vị không?", options: null, required: true },
  { type: "STAR_RATING" as const, label: "Em có được thầy/cô quan tâm, giúp đỡ không?", options: null, required: true },
  { type: "TEXTBOX" as const, label: "Em muốn nhắn gì cho thầy/cô? (không bắt buộc)", options: null, required: false },
];

async function main() {
  const cls = await db.class.findUnique({ where: { id: "cmqqhcvoj00061ey49q5eqc20" }, select: { centerId: true } });
  const centerId = cls?.centerId ?? null;

  // Idempotent: xoá đợt + form test cũ (cascade responses/answers/questions).
  const oldRounds = await db.evaluationRound.findMany({ where: { name: ROUND_NAME }, select: { id: true } });
  if (oldRounds.length) await db.evaluationRound.deleteMany({ where: { id: { in: oldRounds.map((r) => r.id) } } });
  const oldForms = await db.evalForm.findMany({ where: { title: FORM_TITLE }, select: { id: true } });
  if (oldForms.length) await db.evalForm.deleteMany({ where: { id: { in: oldForms.map((f) => f.id) } } });

  const form = await db.evalForm.create({
    data: {
      title: FORM_TITLE,
      scope: "TEACHER_EVAL",
      status: "ACTIVE",
      questions: {
        create: QUESTIONS.map((q, i) => ({
          type: q.type,
          label: q.label,
          options: q.options ?? undefined,
          required: q.required,
          order: i + 1,
        })),
      },
    },
    select: { id: true },
  });

  const now = new Date();
  const opensAt = new Date(now.getTime() - 3 * 86400000); // mở 3 ngày trước
  const closesAt = new Date(now.getTime() + 60 * 86400000); // đóng sau 60 ngày

  await db.evaluationRound.create({
    data: {
      formId: form.id,
      scope: "TEACHER_EVAL",
      name: ROUND_NAME,
      centerId,
      courseId: null,
      opensAt,
      closesAt,
      status: "OPEN",
    },
  });

  console.log(`✅ Seed đánh giá GV: form ${form.id} (${QUESTIONS.length} câu) + đợt "${ROUND_NAME}" OPEN (center=${centerId ?? "ALL"}).`);
  console.log("   → Đặt EVAL_V2_ENABLED=true trong .env.local rồi mở /portal/hoc-sinh/danh-gia-gv.");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌", e);
    await db.$disconnect();
    process.exit(1);
  });
