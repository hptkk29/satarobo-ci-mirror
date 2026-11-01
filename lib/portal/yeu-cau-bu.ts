// lib/portal/yeu-cau-bu.ts — cổng MÁY CHỦ cho đơn "xin học bù" của phụ huynh (T11, 08/10/2026).
//
// Đơn xin bù gắn ĐÚNG MỘT dòng cần bù (`ParentRequest.makeupNeedId`). Cổng này trả lời "đơn này có nên được tạo không":
//   · dòng phải là của CON MÌNH (tra qua `portalDb` ⇒ dòng nhà khác không khớp, không lộ tồn tại);
//   · dòng phải còn CHỜ XẾP (PENDING, chưa bị quản lý huỷ). Đã xếp case / đã bù xong / đã huỷ thì gửi đơn là vô nghĩa — và đơn sẽ không bao giờ được đóng nếu tạo
//     SAU lúc dòng đã rời trạng thái (hệ thống chỉ đóng đơn lúc dòng ĐỔI trạng thái, xem `dongYeuCauPhuHuynh`);
//   · mỗi dòng tối đa MỘT đơn đang mở (đơn mở trùng chiếm trần 10 đơn của phụ huynh mà không thêm thông tin nào cho trung tâm).
import type { portalDb } from "@/lib/portal/db";

type Pdb = Pick<ReturnType<typeof portalDb>, "makeupNeed" | "parentRequest">;

export type KetQuaKiemDong = { ok: true; sessionId: string } | { ok: false; error: string };

export async function kiemDongChoYeuCau(pdb: Pdb, p: { studentId: string; needId: string }): Promise<KetQuaKiemDong> {
  const need = await pdb.makeupNeed.findFirst({
    where: { id: p.needId, studentId: p.studentId },
    select: { missedSessionId: true, status: true, waivedAt: true },
  });
  if (!need) return { ok: false, error: "Buổi cần bù không hợp lệ" };
  if (need.status !== "PENDING" || need.waivedAt !== null) {
    return {
      ok: false,
      error:
        need.status === "SCHEDULED"
          ? "Buổi này đã được trung tâm xếp lịch học bù — xem ngày giờ ở mục Buổi học bù, không cần gửi thêm yêu cầu."
          : need.status === "COMPLETED"
            ? "Buổi này đã học bù xong."
            : "Buổi này không còn cần học bù.",
    };
  }
  const daCo = await pdb.parentRequest.findFirst({
    where: {
      type: "MAKEUP",
      status: "PENDING",
      OR: [{ makeupNeedId: p.needId }, { studentId: p.studentId, sessionId: need.missedSessionId, makeupNeedId: null }],
    },
    select: { id: true },
  });
  if (daCo) return { ok: false, error: "Bạn đã gửi yêu cầu cho buổi này — trung tâm đang xử lý." };
  return { ok: true, sessionId: need.missedSessionId };
}
