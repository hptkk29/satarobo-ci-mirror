import type { Role } from "@prisma/client";

// =============================================================================
// LABELS tiếng Việt — single source of truth cho hiển thị
// =============================================================================

// Phase T0.1 — nhãn role tiếng Việt (8 roles).
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Quản trị tối cao",
  CENTER_MANAGER: "Quản lý cơ sở",
  HR: "Nhân sự",
  SALES_CSM: "Tư vấn & Chăm sóc",
  TEACHER: "Giáo viên",
  TRAINING: "Đào tạo",
  MARKETING: "Marketing",
  ACCOUNTANT: "Kế toán",
  PARENT: "Phụ huynh",
};

// 14 RoleDef code của RBAC v2 (nguồn nhãn: prisma/seed-roles.ts `name`). Cần vì khi cờ
// RBAC_V2_ENABLED bật, RoleSwitcher chọn theo RoleDef code chứ không theo Role enum
// legacy — hai bộ mã chỉ trùng nhau 5/9 (xem lib/auth/active-role.ts).
export const ROLE_DEF_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Quản trị tối cao",
  HO_ACCOUNTANT: "Kế toán Hội sở",
  HO_HR: "Nhân sự Hội sở",
  CENTER_HR: "Nhân sự cơ sở",
  HO_MARKETING: "Marketing Hội sở",
  TRAINING: "Đào tạo (toàn LMS)",
  HO_SALE: "Sale Hội sở (chỉ xem)",
  CENTER_MANAGER: "Quản lý cơ sở",
  CENTER_CLASS_MANAGER: "Quản lý lớp học",
  CENTER_SALES_CSM: "Tư vấn & CSKH cơ sở",
  TEACHER: "Giáo viên",
  ASSISTANT_TEACHER: "Trợ giảng",
  CENTER_ACCOUNTANT: "Kế toán cơ sở",
  PARENT: "Phụ huynh",
};

/** Nhãn cho mã vai bất kỳ: ưu tiên RoleDef (v2), lùi về Role enum legacy (v1). */
export function roleCodeLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return ROLE_DEF_LABELS[code] ?? roleLabel(code);
}

export function roleLabel(role: Role | string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role as Role] ?? String(role);
}

// Màu badge role — single source (gộp từ users/role-badge.tsx).
export const ROLE_COLORS: Record<Role, string> = {
  SUPER_ADMIN: "bg-red-100 text-red-700",
  CENTER_MANAGER: "bg-purple-100 text-purple-700",
  HR: "bg-pink-100 text-pink-700",
  SALES_CSM: "bg-blue-100 text-blue-700",
  TEACHER: "bg-green-100 text-green-700",
  TRAINING: "bg-indigo-100 text-indigo-700",
  MARKETING: "bg-orange-100 text-orange-700",
  ACCOUNTANT: "bg-yellow-100 text-yellow-700",
  PARENT: "bg-teal-100 text-teal-700",
};

export function roleColor(role: Role | string | null | undefined): string {
  return ROLE_COLORS[role as Role] ?? "bg-gray-100 text-gray-700";
}

// Role gán được cho nhân viên (loại PARENT — phụ huynh không phải nhân sự).
export const ASSIGNABLE_ROLES: Role[] = [
  "SUPER_ADMIN",
  "CENTER_MANAGER",
  "HR",
  "SALES_CSM",
  "TEACHER",
  "MARKETING",
  "ACCOUNTANT",
];

/** Option {value,label} cho dropdown chọn role. Mặc định = toàn bộ role gán được. */
export function getRoleOptions(
  roles: Role[] = ASSIGNABLE_ROLES,
): Array<{ value: Role; label: string }> {
  return roles.map((value) => ({ value, label: ROLE_LABELS[value] }));
}

// =============================================================================
// R7-08 (XĐ-8 PA2) — 6 NHÃN ĐIỂM DANH hiển thị.
//
// Enum DB giữ theo Doc 15 (status + makeupStatus + SessionStatus). Nhãn HIỂN THỊ
// suy ra từ 3 nguồn qua attendanceLabel(...) — KHÔNG đổi enum. Buổi CANCELLED →
// "Buổi học bị hủy", KHÔNG tính vắng (countsAbsent=false, countsAttended=false).
// =============================================================================

export type AttendanceStatusValue =
  | "PRESENT"
  | "LATE"
  | "ABSENT"
  | "EXCUSED"
  | "ABSENT_EXCUSED"
  | "ABSENT_UNEXCUSED";

export type MakeupStatusValue = "NONE" | "NEEDS_MAKEUP" | "MADE_UP";

export type SessionStatusValue = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

/** 6 nhãn SRS + nhãn đặc biệt buổi hủy. */
export type AttendanceLabelKey =
  | "PRESENT"
  | "LATE"
  | "ABSENT_EXCUSED"
  | "ABSENT_UNEXCUSED"
  | "NEEDS_MAKEUP"
  | "MADE_UP"
  | "CANCELLED";

export type AttendanceLabelTone = "green" | "amber" | "blue" | "red" | "purple" | "neutral";

export interface AttendanceLabelInfo {
  key: AttendanceLabelKey;
  label: string;
  tone: AttendanceLabelTone;
  /** Có tính là "đã học" (đếm tiến độ) không. */
  countsAttended: boolean;
  /** Có tính là "vắng" không (buổi hủy = false). */
  countsAbsent: boolean;
}

/** Bảng nhãn — đổi text/màu ở 1 chỗ. */
export const ATTENDANCE_LABELS: Record<AttendanceLabelKey, AttendanceLabelInfo> = {
  PRESENT: { key: "PRESENT", label: "Có mặt", tone: "green", countsAttended: true, countsAbsent: false },
  LATE: { key: "LATE", label: "Đi muộn", tone: "amber", countsAttended: true, countsAbsent: false },
  ABSENT_EXCUSED: { key: "ABSENT_EXCUSED", label: "Vắng có phép", tone: "blue", countsAttended: false, countsAbsent: true },
  ABSENT_UNEXCUSED: { key: "ABSENT_UNEXCUSED", label: "Vắng không phép", tone: "red", countsAttended: false, countsAbsent: true },
  NEEDS_MAKEUP: { key: "NEEDS_MAKEUP", label: "Chờ học bù", tone: "amber", countsAttended: false, countsAbsent: true },
  MADE_UP: { key: "MADE_UP", label: "Đã học bù", tone: "purple", countsAttended: true, countsAbsent: false },
  CANCELLED: { key: "CANCELLED", label: "Buổi học bị hủy", tone: "neutral", countsAttended: false, countsAbsent: false },
};

/**
 * Nhãn tính là ĐI HỌC (chưa kể học bù — `makeupStatus === "MADE_UP"` xét riêng).
 *
 * ⚠️ Dùng HAI tập dưới đây thay vì tự viết mảng ở từng file. Enum `AttendanceStatus` có
 * 6 giá trị: 2 nhãn ABSENT_EXCUSED/ABSENT_UNEXCUSED thêm ở R7-08 (2-phase, chưa drop
 * ABSENT/EXCUSED cũ) và site giáo viên — đường điểm danh CHÍNH — chỉ ghi nhãn MỚI.
 * File nào còn lọc `["ABSENT","EXCUSED"]` sẽ đếm 0 buổi vắng cho toàn bộ dữ liệu thật:
 * đó đúng là lỗi tìm thấy ở lib/students/progress.ts ngày 19/08.
 */
export const PRESENT_STATUSES: ReadonlySet<AttendanceStatusValue> = new Set([
  "PRESENT",
  "LATE",
]);

/** Nhãn tính là VẮNG — đủ cả 6 giá trị enum (buổi CANCELLED xét riêng, không vắng). */
export const ABSENT_STATUSES: ReadonlySet<AttendanceStatusValue> = new Set([
  "ABSENT",
  "EXCUSED",
  "ABSENT_EXCUSED",
  "ABSENT_UNEXCUSED",
]);

const EXCUSED_SET = new Set<AttendanceStatusValue>(["EXCUSED", "ABSENT_EXCUSED"]);

/**
 * Map (status, makeupStatus, sessionStatus) → 1 trong 6 nhãn (+ buổi hủy).
 * Ưu tiên: buổi hủy > đã học bù > chờ học bù > trạng thái điểm danh.
 */
export function attendanceLabel(
  status: AttendanceStatusValue,
  makeupStatus: MakeupStatusValue = "NONE",
  sessionStatus?: SessionStatusValue | null,
): AttendanceLabelInfo {
  if (sessionStatus === "CANCELLED") return ATTENDANCE_LABELS.CANCELLED;
  if (makeupStatus === "MADE_UP") return ATTENDANCE_LABELS.MADE_UP;
  if (makeupStatus === "NEEDS_MAKEUP") return ATTENDANCE_LABELS.NEEDS_MAKEUP;
  switch (status) {
    case "PRESENT":
      return ATTENDANCE_LABELS.PRESENT;
    case "LATE":
      return ATTENDANCE_LABELS.LATE;
    default:
      return EXCUSED_SET.has(status)
        ? ATTENDANCE_LABELS.ABSENT_EXCUSED
        : ATTENDANCE_LABELS.ABSENT_UNEXCUSED;
  }
}
