// lib/hoc-bu/rut-don-nghi.ts — PHỤ HUYNH RÚT ĐƠN XIN NGHỈ (13/11/2026, chủ dự án).
//
// Luật: Sale / QLCS TIẾP NHẬN đơn xin nghỉ ⇒ hệ thống tự ghi buổi đó VẮNG CÓ PHÉP (lý do = ghi chú của phụ huynh, để giáo viên biết). Phụ huynh đổi ý và RÚT đơn ⇒
// đơn đóng (CANCELLED) và buổi học trở lại "như bình thường": điểm danh vắng có phép do lúc tiếp nhận ghi bị gỡ, dòng cần bù sinh ra từ nó được thu hồi.
//
// CHỈ rút được khi MỌI điều dưới đây đúng — gặp một điều sai ⇒ TỪ CHỐI và nói rõ (không gỡ nửa vời):
//   1. buổi học CHƯA diễn ra (còn trong tương lai) và chưa bị huỷ;
//   2. điểm danh của buổi vẫn là ĐÚNG bản ghi lúc tiếp nhận để lại: `EXCUSED`, lý do = nội dung đơn, chưa học bù xong. Giáo viên đã sửa ⇒ không đè lên việc của họ;
//   3. dòng cần bù của buổi (nếu có) còn CHỜ XẾP: chưa vào case nào, chưa có đơn phí, chưa bị quản lý miễn/huỷ tay, không có yêu cầu thêm vào case đang chờ duyệt.
//
// Thứ tự: mọi cổng ĐỨNG TRƯỚC phép ghi đầu tiên; phép ghi đầu tiên là `updateMany` CÓ ĐIỀU KIỆN trạng thái đơn (hai người cùng lúc thì chỉ một lượt ăn).
// Từ chối LUÔN là `throw` (luật rollback của repo — `return` không rollback).
//
// Đọc/ghi bằng `db` trần: điểm danh + dòng cần bù không nằm trong phạm vi `portalDb`; QUYỀN SỞ HỮU (đơn thuộc con của phụ huynh đăng nhập) do NƠI GỌI kiểm trước
// (`cancelParentRequest` — `assertOwnsStudent`) và hàm này vẫn đối chiếu `studentId` của đơn với đối số.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { chuyenTrangThaiDong } from "@/lib/hoc-bu/dong-service";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";

type Tx = Prisma.TransactionClient;

export type KetQuaRutDon = { ok: true; goDiemDanh: boolean } | { ok: false; error: string };

class TuChoiRut extends Error {}
const tuChoi = (m: string): never => {
  throw new TuChoiRut(m);
};

/** Lý do mà lúc TIẾP NHẬN đã ghi vào điểm danh — MỘT hàm cho cả hai đầu (ghi lúc tiếp nhận, đối chiếu lúc rút). */
export const lyDoDiemDanhTuDon = (noiDungDon: string): string => noiDungDon.slice(0, 1000);

/** Rút đơn xin nghỉ ĐÃ ĐƯỢC TIẾP NHẬN (APPROVED). Đơn còn CHỜ (PENDING) chỉ cần đóng — `cancelParentRequest` đã làm đường đó. */
export async function rutDonXinNghiDaTiepNhan(p: { requestId: string; studentId: string; now?: Date }): Promise<KetQuaRutDon> {
  const now = p.now ?? new Date();
  try {
    return await db.$transaction(
      async (tx: Tx) => {
        const don = await tx.parentRequest.findUnique({
          where: { id: p.requestId },
          select: { type: true, status: true, studentId: true, sessionId: true, content: true },
        });
        if (!don || don.studentId !== p.studentId) return tuChoi("Không tìm thấy yêu cầu");
        if (don.type !== "ABSENCE") return tuChoi("Chỉ rút được đơn xin nghỉ.");
        if (don.status !== "APPROVED") return tuChoi("Chỉ rút được đơn đang chờ hoặc đã được trung tâm tiếp nhận.");

        let goDiemDanh = false;
        let dongCanHuy: string | null = null;
        let diemDanhId: string | null = null;

        if (don.sessionId) {
          const buoi = await tx.classSession.findUnique({ where: { id: don.sessionId }, select: { date: true, status: true } });
          if (!buoi) return tuChoi("Buổi học không còn tồn tại — liên hệ trung tâm để được hỗ trợ.");
          if (buoi.date.getTime() <= now.getTime()) {
            return tuChoi("Buổi học đã đến giờ hoặc đã diễn ra nên không rút đơn được nữa — ba mẹ liên hệ trung tâm giúp con nhé.");
          }
          if (buoi.status === "CANCELLED") return tuChoi("Buổi học này đã được huỷ nên không cần rút đơn.");

          const diemDanh = await tx.attendance.findUnique({
            where: { sessionId_studentId: { sessionId: don.sessionId, studentId: don.studentId } },
            select: { id: true, status: true, absenceReason: true, makeupStatus: true, makeupSessionId: true },
          });
          if (diemDanh) {
            const nguyenBan =
              diemDanh.status === "EXCUSED" &&
              diemDanh.absenceReason === lyDoDiemDanhTuDon(don.content) &&
              diemDanh.makeupStatus !== "MADE_UP" &&
              diemDanh.makeupSessionId === null;
            if (!nguyenBan) return tuChoi("Buổi này đã được thầy cô cập nhật điểm danh nên không tự rút được — ba mẹ liên hệ trung tâm giúp con nhé.");
            diemDanhId = diemDanh.id;
          }

          const dong = await tx.makeupNeed.findUnique({
            where: { studentId_missedSessionId: { studentId: don.studentId, missedSessionId: don.sessionId } },
            select: {
              id: true,
              status: true,
              waivedAt: true,
              feeOrderItemId: true,
              _count: { select: { caseStudents: true } },
            },
          });
          if (dong && dong.status !== "CANCELLED") {
            const dangXep = await tx.makeupCaseAddRequest.count({ where: { makeupNeedId: dong.id, status: "PENDING" } });
            if (dong.status !== "PENDING" || dong._count.caseStudents > 0 || dong.feeOrderItemId !== null || dong.waivedAt !== null || dangXep > 0) {
              return tuChoi("Trung tâm đã xếp hoặc đang xử lý buổi học bù cho buổi này nên không tự rút được — ba mẹ liên hệ trung tâm giúp con nhé.");
            }
            dongCanHuy = dong.id;
          }
        }

        // ── Từ đây mới GHI. Phép ghi đầu tiên: đóng đơn có điều kiện (hai lượt đồng thời ⇒ một lượt ăn). ──
        const dong = await tx.parentRequest.updateMany({
          where: { id: p.requestId, status: "APPROVED", studentId: p.studentId },
          data: { status: "CANCELLED", response: "Phụ huynh đã rút đơn xin nghỉ.", handledByName: "Phụ huynh", handledAt: now },
        });
        if (dong.count !== 1) return tuChoi("Đơn vừa được xử lý ở nơi khác — tải lại trang rồi thử lại.");

        if (dongCanHuy) {
          await chuyenTrangThaiDong(tx, { ids: [dongCanHuy], tu: "PENDING", sang: "CANCELLED", lyDo: "PH_RUT_DON_NGHI" });
        }
        if (diemDanhId && don.sessionId) {
          // Bản ghi vắng CÓ PHÉP không tạo dòng sổ cái quyền học (chỉ "có mặt" mới tạo), nên không có gì để đồng bộ ở sổ cái. Liên kết `originalAttendanceId` của
          // dòng cần bù là SET NULL — dòng đã được huỷ ở trên nên không còn nghĩa vụ nào trỏ vào bản ghi này.
          await tx.attendance.delete({ where: { id: diemDanhId } });
          goDiemDanh = true;
          await ghiNhatKy(tx, {
            actorId: null,
            ten: "Phụ huynh",
            entityType: "Attendance",
            entityId: diemDanhId,
            action: "hoc-bu.ph-rut-don-nghi",
            newValues: { requestId: p.requestId, studentId: don.studentId, sessionId: don.sessionId, dongHuy: dongCanHuy },
          });
        }
        return { ok: true as const, goDiemDanh };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (e instanceof TuChoiRut) return { ok: false, error: e.message };
    console.error("[rutDonXinNghiDaTiepNhan]", e);
    return { ok: false, error: "Chưa rút được đơn lúc này — ba mẹ thử lại sau ít phút." };
  }
}
