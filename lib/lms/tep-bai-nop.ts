import { resolveActor } from "@/lib/auth/actor";
import { decidePermissionWithGrant } from "@/lib/auth/permission-decision";
import { db } from "@/lib/db";
import { layKhoTepRieng } from "@/lib/mobile-api/kho-tep-rieng";

/**
 * TẢI TỆP BÀI NỘP TRONG KHO RIÊNG (web) — `GET /api/lms/submission-file/:fileId` → 302 tới URL KÝ ngắn hạn (5 phút).
 * Tệp nộp từ ứng dụng nằm bucket RIÊNG nên `AssignmentSubmissionFile.fileUrl` là đường dẫn này (có phân quyền), không phải URL kho. Hai nhóm được tải:
 *  · PHỤ HUYNH sở hữu học viên của bài nộp (`Student.parentUserId`);
 *  · NHÂN SỰ có quyền `assignments:grade` TẠI LỚP của bài VÀ trong phạm vi: Quản trị tối cao / cấp Hội sở / giáo viên được phân lớp đó / quản lý đúng cơ sở của lớp.
 * Mọi trường hợp khác ⇒ 404 (cùng một câu: không lộ tệp có tồn tại hay không). Fail-closed: kho riêng chưa cấu hình ⇒ 503.
 */
export type KetQuaTaiTep = { ok: true; url: string } | { ok: false; ma: 401 | 404 | 503 };
const TTL_GIAY = 300;

export async function layUrlTaiTep(userId: string | null | undefined, fileId: string): Promise<KetQuaTaiTep> {
  if (!userId) return { ok: false, ma: 401 };
  const f = await db.assignmentSubmissionFile.findUnique({
    where: { id: fileId },
    select: { storageKey: true, fileName: true, submission: { select: { student: { select: { parentUserId: true } }, assignment: { select: { classId: true, class: { select: { centerId: true } } } } } } },
  });
  if (!f?.storageKey) return { ok: false, ma: 404 }; // tệp cũ (URL công khai của web) không đi đường này
  const { classId, class: lop } = f.submission.assignment;
  let duoc = f.submission.student.parentUserId === userId;
  if (!duoc) {
    const actor = await resolveActor(userId);
    const trongPhamVi = actor.isSuperAdmin || actor.isHoLevel || actor.assignedClassIds.has(classId) || (lop?.centerId ? actor.visibleCenterIds.includes(lop.centerId) : false);
    if (trongPhamVi) {
      // Quyết định THUẦN theo actor tải từ DB (không đọc phiên web): route web đã xác thực `userId`, còn bộ test gọi thẳng hàm này.
      const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, roles: true, centerId: true } });
      duoc = !!u && decidePermissionWithGrant({ sessionUser: u as never, actor, action: "assignments:grade", target: { classId } });
    }
  }
  if (!duoc) return { ok: false, ma: 404 };
  const kho = layKhoTepRieng();
  if (!kho) return { ok: false, ma: 503 };
  const url = await kho.kyGet(f.storageKey, TTL_GIAY, f.fileName).catch(() => null);
  return url ? { ok: true, url } : { ok: false, ma: 503 };
}
