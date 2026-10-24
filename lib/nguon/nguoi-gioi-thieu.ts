/**
 * lib/nguon/nguoi-gioi-thieu.ts — hỏi "người này có đang là NGƯỜI GIỚI THIỆU của lead nào không" (07 §2.8).
 *
 * Vì sao có: bốn FK `LeadAttribution.referrer{Employee,ParentUser,Student,Affiliate}Id` đều `onDelete: Restrict` (người giới thiệu
 * là căn cứ TIỀN — không để bị xoá lặng lẽ kéo mất dòng quy nguồn). Từ khi PR2 ghi dòng người giới thiệu đầu tiên, mọi đường XOÁ
 * CỨNG nhân viên/học viên/phụ huynh/đối tác phải hỏi trước để trả lỗi TIẾNG VIỆT thay vì lỗi RESTRICT thô (SQLSTATE 23001 — đo 08/10: Prisma KHÔNG dịch nó thành `P2003`, nên không thể "bắt P2003" mà chỉ có thể hỏi trước).
 *
 * Trả BOOLEAN, không trả số: số lead được giới thiệu là thông tin về lead của MỌI cơ sở, mà bảng nguồn không có cột đơn vị
 * (ngoại lệ luật Nền #3 — chỉ đọc qua `Lead` đã scope). Người xoá chỉ cần biết "có" hay "không".
 *
 * Đọc bằng `db` KHÔNG scope có chủ đích: câu hỏi "xoá được không" phải đúng với dữ liệu TOÀN HỆ, không phải phần người hỏi thấy.
 */
import { db } from "@/lib/db";

export type MucTieuNguoiGioiThieu = {
  employeeId?: string;
  /**
   * `User.id` — của phụ huynh (`referrerParentUserId`) HOẶC của Sale phụ trách phụ huynh giới thiệu (`referrerSaleUserId`, FK Restrict từ 09/10/2026). Hai cột cùng trỏ vào `User`
   * nên một câu hỏi "user này có đang bị dòng quy nguồn nào trỏ tới không" phải nhìn CẢ HAI: đường xoá cứng User nào cũng phải hỏi hàm này trước.
   */
  userId?: string;
  /**
   * `User.id` của tài khoản đăng nhập của MỘT NHÂN SỰ sắp bị xoá cứng — hỏi riêng cột `referrerSaleUserId`. Xoá `Employee` KHÔNG chạm User nên không vướng FK, nhưng nhân sự mất hồ sơ thì
   * `docNguCanhNguoiHuong` đọc `employee: null` = «không phải nhân sự ⇒ luôn hưởng» và D13 (người nghỉ không nhận hoa hồng) bị vượt qua IM LẶNG. Khác `userId`: không hỏi `referrerParentUserId`.
   */
  saleUserId?: string;
  studentId?: string;
  affiliateId?: string;
};

/**
 * Nhân sự có đang là NGƯỜI PHỤ TRÁCH của một nguồn không (`LeadSourceGroup.ownerEmployeeId`, FK Restrict — nguồn động).
 * Khác `nguoiDangGioiThieuLead`: đó là người giới thiệu MỘT lead, đây là người đứng tên cả một NGUỒN (đầu vào resolver
 * `SOURCE_OWNER`). Mọi đường XOÁ CỨNG nhân sự phải hỏi cả hai trước khi xoá.
 *
 * KHÔNG lọc theo `status`: FK Restrict chặn cả khi nguồn đã ARCHIVED (nguồn không bao giờ bị xoá cứng), nên câu hỏi phải
 * đúng với thứ DB sẽ làm, không phải với thứ giao diện đang hiện.
 */
export async function nhanSuDangPhuTrachNguon(m: { employeeId?: string }): Promise<boolean> {
  if (!m.employeeId) return false; // không hỏi gì ⇒ không bắt gì
  return (await db.leadSourceGroup.count({ where: { ownerEmployeeId: m.employeeId } })) > 0;
}

export async function nguoiDangGioiThieuLead(m: MucTieuNguoiGioiThieu): Promise<boolean> {
  const or = [
    ...(m.employeeId ? [{ referrerEmployeeId: m.employeeId }] : []),
    ...(m.userId ? [{ referrerParentUserId: m.userId }, { referrerSaleUserId: m.userId }] : []),
    ...(m.saleUserId ? [{ referrerSaleUserId: m.saleUserId }] : []),
    ...(m.studentId ? [{ referrerStudentId: m.studentId }] : []),
    ...(m.affiliateId ? [{ referrerAffiliateId: m.affiliateId }] : []),
  ];
  if (or.length === 0) return false; // không hỏi gì ⇒ không bắt gì (không bao giờ thành `where: {}` đếm hết bảng)
  return (await db.leadAttribution.count({ where: { OR: or } })) > 0;
}
