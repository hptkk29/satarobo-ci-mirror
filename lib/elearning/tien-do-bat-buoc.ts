import type { ScopedDb } from "@/lib/actions/factory";
import type { BaiCuaLuot } from "@/lib/elearning/ban-cua-luot";
import { tinhTienDoBatBuoc } from "@/lib/elearning/de-cuong-pure";

/**
 * "n/m bài BẮT BUỘC" dùng chung cho Tổng quan và Khoá của tôi (D-11: MỘT định nghĩa — hai màn không được in hai mẫu số cho một khoá).
 * MỘT truy vấn gộp bài `DONE` của người này trong mọi lượt; không theo từng khoá.
 */
export async function napBaiXongTheoLuot(
  db: ScopedDb,
  userId: string,
  enrollmentIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const ra = new Map<string, Set<string>>();
  if (enrollmentIds.length === 0) return ra;
  const xong = await db.trnLessonProgress.findMany({
    where: { userId, status: "DONE", enrollmentId: { in: [...enrollmentIds] } },
    select: { enrollmentId: true, lessonId: true },
  });
  for (const x of xong) {
    const s = ra.get(x.enrollmentId) ?? new Set<string>();
    s.add(x.lessonId);
    ra.set(x.enrollmentId, s);
  }
  return ra;
}

/** THUẦN — n/m của MỘT lượt từ danh sách bài (đã theo phiên bản ghim) và tập bài đã xong. `tong = 0` ⇒ khoá chưa có bài bắt buộc. */
export function tienDoCuaLuot(ds: readonly BaiCuaLuot[], daXongBai: ReadonlySet<string>): { xong: number; tong: number } {
  return tinhTienDoBatBuoc(
    ds.map((b) => b.id),
    new Map(ds.map((b) => [b.id, b.required])),
    daXongBai,
  );
}
