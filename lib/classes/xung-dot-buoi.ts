// lib/classes/xung-dot-buoi.ts — soát TRÙNG LỊCH cho MỘT buổi lớp chính khi tạo/sửa (T09 + T09-F1), qua lõi `checkScheduleConflicts`.
//
// Tách khỏi `sessions/_actions.ts` ("use server" — mọi thứ export từ đó là một endpoint) để test được và để mọi đường tạo/sửa buổi dùng CHUNG:
//   · giáo viên + phòng của lớp so với lớp chính khác, buổi trial và CASE DẠY BÙ (HB-28);
//   · HỌC VIÊN đang học của lớp so với CASE DẠY BÙ của chính họ (T09-F1). Chỉ nguồn case dạy bù: đây là chiều "lớp thấy case"; còn "một bé ghi
//     danh hai lớp trùng giờ" là dữ liệu cũ có thật, chưa ai chốt làm lý do chặn sửa buổi.
//
// Đây là đường CHẶN (trả câu lỗi). Đường sinh/dời hàng loạt vẫn chỉ CẢNH BÁO (`detectBatchConflicts`).
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import {
  checkScheduleConflicts,
  dungThongDiepXungDot,
  khoaLichTrongTx,
  layHocVienDangHocCuaLop,
  rowsToSlots,
  sessionWindow,
} from "@/lib/lms/schedule-conflict";
import { phamViKiemTrung } from "@/lib/lms/scheduling";
import type { LoaiTru } from "@/lib/lms/lich-xung-dot";

/**
 * Trả câu lỗi cụ thể nếu buổi (lớp, ngày) trùng; null nếu không trùng / thiếu dữ liệu (lớp không tồn tại, lớp chưa có `startTime` ⇒ không chặn).
 * `kiemHocVien`: kiểm thêm học viên của lớp với case dạy bù — tạo mới luôn bật; SỬA chỉ bật khi ĐỔI NGÀY hoặc CHUYỂN LỚP (sửa chủ đề/ghi chú không
 * được vấp một trùng cũ không liên quan tới thứ vừa sửa).
 * Đọc bằng `db` TRẦN (hoặc `tx` của người gọi), cố ý: quyền xem KHÔNG được biến thành "không thấy ⇒ không bận" — GV/học viên có thể bận ở cơ sở
 * người sửa không đọc được. Câu nói thì ẩn tên nguồn ngoài tầm nhìn (`actor`).
 *
 * `tx`: gọi TRONG transaction ghi buổi ⇒ lấy khoá advisory hẹp (GV | phòng | học viên × ngày) rồi kiểm dưới khoá, nên hai lượt xếp cùng một GV/phòng/bé vào
 * cùng ngày xếp hàng (cùng khoá với `kiemLichTrongTx` của case dạy bù — hai phía chung một khoá thì mới thấy nhau). Không `tx` ⇒ chỉ kiểm, không khoá.
 */
export async function kiemXungDotBuoiLop(p: {
  actor: Actor;
  classId: string;
  date: Date;
  sessionId?: string;
  kiemHocVien: boolean;
  tx?: Prisma.TransactionClient;
}): Promise<string | null> {
  const doc = p.tx ?? db;
  const cls = await doc.class.findUnique({
    where: { id: p.classId },
    select: { teacherId: true, roomId: true, startTime: true, endTime: true },
  });
  if (!cls?.startTime) return null;
  // Phòng/GV HIỆU LỰC của chính buổi (substitute ?? actual ?? cấp buổi ?? lớp — `rowsToSlots`), không phải cấp lớp. Chỉ CHẶN vì thứ thao tác này
  // làm đổi (09/10/2026 — `phamViKiemTrung`): sửa chủ đề/ghi chú không được vấp một trùng phòng/GV CÓ SẴN. Buổi mới / chuyển lớp ⇒ kiểm hết.
  const cu = p.sessionId
    ? await doc.classSession.findUnique({
        where: { id: p.sessionId },
        select: {
          classId: true,
          date: true,
          roomId: true,
          actualRoomId: true,
          actualTeacherId: true,
          substituteRoomId: true,
          substituteTeacherId: true,
          class: { select: { roomId: true, teacherId: true, startTime: true, endTime: true } },
        },
      })
    : null;
  const [truoc] = cu ? rowsToSlots([{ id: p.sessionId!, ...cu }]) : [null];
  const [sau] = cu
    ? rowsToSlots([{ id: p.sessionId!, ...cu, date: p.date, class: cls }])
    : [{ roomId: cls.roomId, teacherId: cls.teacherId }];
  const pv = phamViKiemTrung({
    truoc: truoc && cu?.classId === p.classId ? { roomId: truoc.roomId ?? null, teacherId: truoc.teacherId ?? null } : null,
    sau: { roomId: sau?.roomId ?? null, teacherId: sau?.teacherId ?? null },
    doiGio: !cu || cu.date.getTime() !== p.date.getTime(),
  });
  const teacherId = pv.chanGv ? sau?.teacherId ?? null : null;
  const roomId = pv.chanPhong ? sau?.roomId ?? null : null;
  const studentIds = p.kiemHocVien ? await layHocVienDangHocCuaLop(doc, p.classId) : [];
  if (!teacherId && !roomId && studentIds.length === 0) return null;
  const exclude: LoaiTru[] = [{ type: "CLASS", id: p.classId }];
  if (p.sessionId) exclude.push({ type: "CLASS_SESSION", id: p.sessionId });
  // Mốc đầu PHẢI áp giờ lớp (`sessionWindow`) — xem ghi chú ở lib/lms/schedule-conflict.ts.
  const tham = { khung: sessionWindow(p.date, cls.startTime, cls.endTime), teacherId, roomId, studentIds };
  if (p.tx) await khoaLichTrongTx(p.tx, tham);
  const kq = await checkScheduleConflicts({ ...tham, nguonHocVien: ["MAKEUP_CASE"], exclude }, doc);
  if (!kq.coXungDot) return null;
  return `Trùng lịch — ${(await dungThongDiepXungDot(kq, { actor: p.actor })).join(" ")}`;
}
