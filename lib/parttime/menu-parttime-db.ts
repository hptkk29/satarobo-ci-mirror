// lib/parttime/menu-parttime-db.ts — mục "Công việc của tôi" (site GV) có HIỆN cho người này không.
//
// Chủ dự án chốt 19/10/2026 (MENU_HIDDEN_WHEN_DISABLED): Parttime chưa bật ở cơ sở của người dùng thì KHÔNG bày mục menu — prod sau
// deploy mà chưa thí điểm phải trông gần như hiện tại. Đường dẫn vẫn sống (thông báo cũ trỏ vào): màn tự nói "chưa bật".
//
// "Cơ sở liên quan" của một người = cơ sở NHÀ (`User.centerId`) ∪ cơ sở của lớp họ đứng chính / trợ giảng ∪ cơ sở của phân công
// Parttime của họ trong cửa sổ màn hiển thị (GV CS1 được phân dạy thay ở CS2 đang thí điểm ⇒ thấy). Xét TỪNG cơ sở — KHÔNG "bật ở
// đâu đó" (đó là nới phạm vi: GV CS1 thấy mục khi chỉ CS2 bật). Cùng phép HIỆU LỰC (bật + RBAC v2) với màn QLCS.
//
// Không nơi nào bật ⇒ trả `false` NGAY, không câu tra nào ngoài lượt đọc công tắc đã cache (nhân sự / GV khi tắt không trả giá).
import "server-only";
import { db } from "@/lib/db";
import { boXetCongTac } from "./cong-tac";

/** Cửa sổ ngày quá khứ của phân công được xét — bằng cửa sổ "Đã qua" của màn Công việc của tôi. */
export const SO_NGAY_PHAN_CONG_XET = 30;

export async function hienMucCongViecCuaToi(userId: string, homNay: string): Promise<boolean> {
  const xet = await boXetCongTac("STAFFING");
  if (!xet.coNoiNao) return false;
  const tu = new Date(new Date(`${homNay}T00:00:00Z`).getTime() - SO_NGAY_PHAN_CONG_XET * 86_400_000);
  // `db` trần: User / Class / SessionStaffAssignment đọc theo CHÍNH userId của phiên — GV dạy chéo cơ sở phải thấy cơ sở kia.
  const [u, lop, pc] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { centerId: true } }),
    db.class.findMany({ where: { OR: [{ teacherId: userId }, { assistantId: userId }], deletedAt: null }, distinct: ["centerId"], select: { centerId: true } }),
    db.sessionStaffAssignment.findMany({ where: { userId, ngay: { gte: tu } }, distinct: ["centerId"], select: { centerId: true } }),
  ]);
  const coSo = [u?.centerId, ...lop.map((l) => l.centerId), ...pc.map((p) => p.centerId)];
  return coSo.some((c) => !!c && xet.tai({ centerId: c }));
}
