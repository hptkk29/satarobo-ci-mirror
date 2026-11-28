import type { RoboticsSkill, SkillLevel } from "@prisma/client";

// LMS-5 — nhãn + thang điểm năng lực robotics.

export const SKILL_LABEL: Record<RoboticsSkill, string> = {
  MECH_ASSEMBLY: "Lắp ráp cơ khí",
  ALGORITHM: "Tư duy thuật toán",
  PROGRAMMING: "Lập trình",
  SENSOR: "Cảm biến",
  MOTOR_CONTROL: "Điều khiển động cơ",
  PROBLEM_SOLVING: "Giải quyết vấn đề",
  TEAMWORK: "Làm việc nhóm",
  PRESENTATION: "Thuyết trình",
  CREATIVITY: "Sáng tạo",
  COMPETITION_READY: "Sẵn sàng thi đấu",
};

// Thứ tự hiển thị 10 kỹ năng.
export const SKILL_ORDER: RoboticsSkill[] = [
  "MECH_ASSEMBLY",
  "ALGORITHM",
  "PROGRAMMING",
  "SENSOR",
  "MOTOR_CONTROL",
  "PROBLEM_SOLVING",
  "TEAMWORK",
  "PRESENTATION",
  "CREATIVITY",
  "COMPETITION_READY",
];

export const LEVEL_LABEL: Record<SkillLevel, string> = {
  NEED_SUPPORT: "Cần hỗ trợ",
  BASIC: "Cơ bản",
  GOOD: "Tốt",
  EXCELLENT: "Xuất sắc",
};

export const LEVEL_SCORE: Record<SkillLevel, number> = {
  NEED_SUPPORT: 1,
  BASIC: 2,
  GOOD: 3,
  EXCELLENT: 4,
};

export const LEVEL_COLOR: Record<SkillLevel, string> = {
  NEED_SUPPORT: "bg-rose-100 text-rose-700",
  BASIC: "bg-amber-100 text-amber-700",
  GOOD: "bg-blue-100 text-blue-700",
  EXCELLENT: "bg-emerald-100 text-emerald-700",
};
