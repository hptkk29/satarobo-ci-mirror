// lib/lms/attendance-edit-policy.ts — Task #16 (Kiệt duyệt 07/07/2026, Phương án A).
// Quyết định THUẦN cho ghi điểm danh buổi học: phân nhánh "đánh mới" (mark) vs
// "sửa/hồi tố" (edit) + cửa sổ hồi tố 7 NGÀY. KHÔNG chạm DB/auth → test trong Vitest.
//
// LUỒNG (xem markAttendance @ app/(admin)/admin/attendance/_actions.ts):
//  - GV chính/trợ giảng lớp mình, CENTER_MANAGER cùng cơ sở, SUPER_ADMIN
//    (canManageSessionClass) → được thao tác KHÔNG giới hạn thời gian. Buổi chưa có
//    bản ghi = ĐÁNH MỚI (mark); buổi đã có = SỬA (edit).
//  - CSKH (SALES_CSM) / "Quản lý lớp học" (CENTER_CLASS_MANAGER) chỉ có
//    attendance:edit theo cơ sở → chỉ được SỬA/hồi tố trong 7 ngày kể từ ngày học;
//    quá hạn phải nhờ CENTER_MANAGER/HO/SUPER_ADMIN.

/** Cửa sổ hồi tố (ngày) cho người KHÔNG phải quản lý lớp (CSKH / Quản lý lớp học). */
export const ATTENDANCE_RETRO_WINDOW_DAYS = 7;

export type AttendanceWriteDecision =
  | { ok: true; mode: "mark" | "edit" }
  | { ok: false; code: "FORBIDDEN" | "WINDOW_EXPIRED"; message: string };

/** Số ngày (thực, có phần lẻ) giữa `now` và `then`. */
export function daysBetween(now: Date, then: Date): number {
  return (now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Quyết định ghi điểm danh từ (khả năng quản lý lớp, quyền attendance:edit, buổi đã
 * có bản ghi chưa, ngày học). THUẦN — không side-effect.
 */
export function decideAttendanceWrite(params: {
  /** GV chính/trợ giảng lớp, CENTER_MANAGER cùng cơ sở, hoặc SUPER_ADMIN. */
  canManage: boolean;
  /** Có quyền attendance:edit theo cơ sở (checkPermission) — CSKH / Quản lý lớp học. */
  hasEditPermission: boolean;
  /** Buổi đã có bản ghi điểm danh (đang SỬA) hay chưa (ĐÁNH MỚI). */
  hasExistingAttendance: boolean;
  /** Ngày diễn ra buổi học. */
  sessionDate: Date;
  now?: Date;
  windowDays?: number;
}): AttendanceWriteDecision {
  const now = params.now ?? new Date();
  const windowDays = params.windowDays ?? ATTENDANCE_RETRO_WINDOW_DAYS;

  // Quản lý lớp/cơ sở/admin: KHÔNG giới hạn thời gian.
  if (params.canManage) {
    return { ok: true, mode: params.hasExistingAttendance ? "edit" : "mark" };
  }

  // Người sửa hồi tố (CSKH / Quản lý lớp học): cần attendance:edit + trong 7 ngày.
  if (params.hasEditPermission) {
    if (daysBetween(now, params.sessionDate) > windowDays) {
      return {
        ok: false,
        code: "WINDOW_EXPIRED",
        message: `Chỉ được sửa điểm danh trong vòng ${windowDays} ngày kể từ ngày học. Quá hạn cần Quản lý cơ sở thực hiện.`,
      };
    }
    return { ok: true, mode: "edit" };
  }

  return { ok: false, code: "FORBIDDEN", message: "Không có quyền sửa điểm danh" };
}
