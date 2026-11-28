import type { Prisma } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";

import type { LyDoThuHoi } from "./hang-so";

/**
 * THU HỒI MỌI PHIÊN DI ĐỘNG của một tài khoản — dùng khi mật khẩu bị ĐỔI ở một đường web KHÔNG tăng `tokenVersion` (B3.5, 17/11/2026).
 *
 * Vì sao có hàm này: phiên di động chết khi `tokenVersion` tăng (`[MA-08]`), nhưng hai đường web chủ ý GIỮ phiên web hiện tại nên không tăng nó:
 * `(auth)/doi-mat-khau` (đổi mật khẩu tạm lần đầu) và `(admin)/admin/settings` (tự đổi). Phiên di động bị đánh cắp khi đó sống tiếp sau khi chủ tài khoản đổi mật khẩu.
 * Hàm này chỉ chạm bảng `MobileSession` ⇒ phiên web (JWT) giữ nguyên đúng quy tắc đã duyệt.
 *
 * Lý do ghi vào phiên: `tai-khoan` (thay đổi thông tin xác thực của tài khoản — cùng giá trị `[MA-07/08]` dùng; cột `lyDoThuHoi` có CHECK `MobileSession_ly_do_gia_tri_check` nên không thêm giá trị mới ở đây). Nguyên nhân cụ thể (`doi-mat-khau`) nằm ở dòng kiểm toán.
 *
 * Luật:
 *  · BẮT BUỘC chạy TRONG giao dịch của phép ghi mật khẩu (`tx` là tham số bắt buộc, không mặc định): thu hồi hỏng ⇒ giao dịch cuộn lại ⇒ mật khẩu KHÔNG đổi,
 *    người gọi phải trả lỗi (không bao giờ báo "đã đổi" trong trạng thái nửa vời).
 *  · MỘT lệnh UPDATE có điều kiện `thuHoiLuc IS NULL` — cùng bốn cột token bị xoá như `thuHoi` ở `dich-vu.ts` (băm token không còn ⇒ access và refresh cũ đều bị từ chối).
 *  · Kiểm toán ghi SỐ phiên, không ghi token / băm / mật khẩu.
 * Trả số phiên vừa thu hồi.
 */
export async function thuHoiMoiPhienDiDong(
  tx: Prisma.TransactionClient,
  userId: string,
  lyDo: LyDoThuHoi,
  nguoiThucHien: { id: string | null; name: string },
  now: Date,
  nguyenNhan: string = "doi-mat-khau",
): Promise<number> {
  const r = await tx.mobileSession.updateMany({
    where: { userId, thuHoiLuc: null },
    data: { thuHoiLuc: now, lyDoThuHoi: lyDo, accessHash: null, accessHetHan: null, refreshHash: null, refreshHashTruoc: null },
  });
  if (r.count > 0) {
    await writeAudit({
      actor: nguoiThucHien,
      module: "mobile-auth",
      entityType: "User",
      entityId: userId,
      action: "mobile.sessions_revoked",
      newValues: { lyDo: nguyenNhan, lyDoPhien: lyDo, soPhien: r.count },
      tx,
    });
  }
  return r.count;
}
