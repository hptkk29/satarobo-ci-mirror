// lib/online-revenue/quyen.ts — cổng quyền của API doanh thu Online.
//
// ĐÃ CHỌN quyền sẵn có `onl:report:view` ("Xem báo cáo tổng hợp khoá Online, không kèm PII"): seed hiện cấp cho Quản trị tối cao, Kế toán Hội sở,
// Marketing Hội sở, Đào tạo — đúng nhóm người cần xem số tổng hợp Online. KHÔNG đẻ quyền mới, KHÔNG sửa seed.
// ⚠️ Hệ quả phải để Owner xác nhận: vai Đào tạo (TRAINING) cũng có quyền này ⇒ cũng thấy TIỀN tổng hợp. Muốn tách "xem tiền" khỏi "xem tiến độ học"
// thì cần quyền mới (đề xuất `onl:revenue:view`) — ngoài phạm vi, chưa làm.
// KHÔNG có endpoint chi tiết theo người: mọi phản hồi chỉ là SỐ TỔNG HỢP + mã đơn/mã khuyến mãi/tên khoá/tên pháp nhân — không tên, SĐT, email, mã học viên.
// Quyền đi qua `checkPermission` (can() v2 động) — không so vai tại chỗ.
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";

export const QUYEN_XEM_DOANH_THU_ONLINE = "onl:report:view";

export async function nguoiXemDoanhThuOnline(): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403; ma: "UNAUTHENTICATED" | "FORBIDDEN" }> {
  const s = await auth();
  const id = (s?.user as { id?: string } | undefined)?.id;
  if (!id) return { ok: false, status: 401, ma: "UNAUTHENTICATED" };
  if (!(await checkPermission(QUYEN_XEM_DOANH_THU_ONLINE))) return { ok: false, status: 403, ma: "FORBIDDEN" };
  return { ok: true, userId: id };
}
