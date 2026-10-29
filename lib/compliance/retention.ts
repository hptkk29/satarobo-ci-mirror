import "server-only";
import { db } from "@/lib/db";

// =============================================================================
// C6 / NĐ13 — Lưu trữ & rà soát: học viên đã nghỉ (INACTIVE) quá thời hạn lưu trữ
// → ĐƯA VÀO DANH SÁCH RÀ SOÁT để người phụ trách dữ liệu quyết định xoá (ẩn danh).
// KHÔNG tự động xoá (dữ liệu trẻ em — xoá là không thể hoàn tác, cần người xác nhận).
// =============================================================================

// Mặc định 5 năm sau khi cập nhật cuối (proxy cho "hoạt động cuối"). Cấu hình qua env.
export const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 365 * 5);

export type RetentionDueRow = {
  id: string;
  studentCode: string | null;
  updatedAt: string;
};

/** HV đã INACTIVE + cập nhật cuối quá hạn + CHƯA bị ẩn danh (tên chưa "[Đã xoá"). */
export async function findStudentsDueForRetention(
  now: Date = new Date(),
  days: number = RETENTION_DAYS,
): Promise<RetentionDueRow[]> {
  const cutoff = new Date(now.getTime() - days * 24 * 3_600_000);
  const rows = await db.student.findMany({
    where: {
      status: "INACTIVE",
      updatedAt: { lt: cutoff },
      NOT: { name: { startsWith: "[Đã xoá" } },
      deletedAt: null,
    },
    select: { id: true, studentCode: true, updatedAt: true },
    take: 500,
    orderBy: { updatedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    studentCode: r.studentCode,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function runRetentionScan(
  now: Date = new Date(),
): Promise<{ dueForReview: number; cutoffDays: number }> {
  const due = await findStudentsDueForRetention(now);
  if (due.length > 0) {
    console.warn(`[retention] ${due.length} học viên quá hạn lưu trữ — cần rà soát xoá (NĐ13).`);
  }
  return { dueForReview: due.length, cutoffDays: RETENTION_DAYS };
}
