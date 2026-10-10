import "server-only";
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { thongBaoCaBu, type LoaiBaoGv } from "@/lib/hoc-bu/bao-gv";

/**
 * Báo giáo viên của case dạy bù (xem lib/hoc-bu/bao-gv.ts).
 *
 * Gọi SAU KHI giao dịch đã commit, và KHÔNG BAO GIỜ ném: chuông hỏng thì ca bù vẫn phải được
 * tạo / xếp / huỷ — để lỗi mạng của một cái chuông cuốn theo cả thao tác mới là hỏng nặng
 * (cùng nếp `baoSaleCoLeadMoi`, lib/lead/assign-lead.ts).
 *
 * Đọc bằng `db` trần: người bấm đã qua cổng quyền + phạm vi ở chính hàm ghi; ở đây chỉ đọc
 * lại đúng ca vừa ghi để dựng câu chữ, và người NHẬN là giáo viên của ca chứ không phải người bấm.
 */
export async function baoGvCaBu(loai: LoaiBaoGv, caseId: string, nguoiBamId: string): Promise<void> {
  try {
    const c = await db.makeupCase.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        teacherId: true,
        date: true,
        startTime: true,
        endTime: true,
        courseId: true,
        roomId: true,
        _count: { select: { students: true } },
      },
    });
    if (!c) return;
    const [khoa, phong] = await Promise.all([
      db.course.findUnique({ where: { id: c.courseId }, select: { name: true } }),
      c.roomId ? db.room.findUnique({ where: { id: c.roomId }, select: { name: true, code: true } }) : null,
    ]);
    const tb = thongBaoCaBu(
      loai,
      {
        caseId: c.id,
        teacherId: c.teacherId,
        date: c.date,
        startTime: c.startTime,
        endTime: c.endTime,
        tenKhoa: khoa?.name ?? null,
        tenPhong: phong ? (phong.code ?? phong.name) : null,
        soHocVien: c._count.students,
      },
      nguoiBamId,
      Date.now(),
    );
    if (!tb) return;
    await notifyStaff({ ...tb, category: "CLASS" });
  } catch (err) {
    console.error(`[hoc-bu] không gửi được thông báo "${loai}" cho giáo viên của case ${caseId}:`, err);
  }
}
