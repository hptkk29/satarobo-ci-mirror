import type { TeacherRank, EmploymentType, TeacherStatus } from "@prisma/client";

// FIX 10 — nhãn tiếng Việt cho hồ sơ giáo viên (dùng chung list + profile).

export const RANK_LABEL: Record<TeacherRank, string> = {
  TRAINEE: "Tập sự",
  JUNIOR: "Junior",
  ADVANCED: "Advanced",
  SENIOR: "Senior",
  EXPERT: "Expert",
};

export const RANK_COLOR: Record<TeacherRank, string> = {
  TRAINEE: "bg-gray-100 text-gray-600",
  JUNIOR: "bg-blue-100 text-blue-700",
  ADVANCED: "bg-indigo-100 text-indigo-700",
  SENIOR: "bg-purple-100 text-purple-700",
  EXPERT: "bg-amber-100 text-amber-700",
};

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  FULLTIME: "Toàn thời gian",
  PARTTIME: "Bán thời gian",
};

export const TEACHER_STATUS_LABEL: Record<TeacherStatus, string> = {
  ACTIVE: "Đang dạy",
  ON_LEAVE: "Tạm nghỉ",
  INACTIVE: "Ngưng",
};

export const TEACHER_STATUS_COLOR: Record<TeacherStatus, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  ON_LEAVE: "bg-amber-100 text-amber-700",
  INACTIVE: "bg-gray-100 text-gray-500",
};
