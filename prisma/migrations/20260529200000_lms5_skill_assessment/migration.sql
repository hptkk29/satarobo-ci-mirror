-- LMS-5 — StudentSkillAssessment (hồ sơ năng lực robotics)
CREATE TYPE "SkillLevel" AS ENUM ('NEED_SUPPORT', 'BASIC', 'GOOD', 'EXCELLENT');
CREATE TYPE "RoboticsSkill" AS ENUM ('MECH_ASSEMBLY', 'ALGORITHM', 'PROGRAMMING', 'SENSOR', 'MOTOR_CONTROL', 'PROBLEM_SOLVING', 'TEAMWORK', 'PRESENTATION', 'CREATIVITY', 'COMPETITION_READY');

CREATE TABLE "StudentSkillAssessment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "skill" "RoboticsSkill" NOT NULL,
    "level" "SkillLevel" NOT NULL,
    "note" TEXT,
    "assessedById" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentSkillAssessment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudentSkillAssessment_studentId_skill_idx" ON "StudentSkillAssessment"("studentId", "skill");
ALTER TABLE "StudentSkillAssessment" ADD CONSTRAINT "StudentSkillAssessment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
