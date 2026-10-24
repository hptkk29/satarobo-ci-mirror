/**
 * Seed đánh giá kỹ năng (StudentSkillAssessment) cho Tổng quan Cổng học sinh (KỸ NĂNG CỦA EM).
 *   pnpm tsx prisma/seed-test-skills.ts
 * Idempotent: xoá đánh giá cũ của HV test rồi tạo lại. KHÔNG cho prod.
 */
import { db } from "../lib/db";

const CLASS_ID = "cmqqhcvoj00061ey49q5eqc20";

const SKILLS = [
  { skill: "ALGORITHM" as const, level: "GOOD" as const },
  { skill: "CREATIVITY" as const, level: "EXCELLENT" as const },
  { skill: "TEAMWORK" as const, level: "GOOD" as const },
  { skill: "PROGRAMMING" as const, level: "GOOD" as const },
  { skill: "PROBLEM_SOLVING" as const, level: "BASIC" as const },
  { skill: "MECH_ASSEMBLY" as const, level: "GOOD" as const },
];

async function main() {
  const cls = await db.class.findUnique({ where: { id: CLASS_ID }, select: { teacherId: true } });
  const assessedById = cls?.teacherId;
  if (!assessedById) throw new Error("Lớp test chưa có GV (teacherId) — không seed được đánh giá kỹ năng.");

  const students = await db.student.findMany({
    where: { studentCode: { in: ["CS1-TEST-001", "CS1-TEST-002"] } },
    select: { id: true },
  });
  if (students.length === 0) throw new Error("Chưa có HV test — chạy seed-test-parent trước.");

  let n = 0;
  for (const st of students) {
    await db.studentSkillAssessment.deleteMany({ where: { studentId: st.id } });
    for (const s of SKILLS) {
      await db.studentSkillAssessment.create({
        data: { studentId: st.id, skill: s.skill, level: s.level, assessedById },
      });
      n++;
    }
  }
  console.log(`✅ Seed kỹ năng: ${n} đánh giá (${SKILLS.length} kỹ năng × ${students.length} HV).`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌", e);
    await db.$disconnect();
    process.exit(1);
  });
