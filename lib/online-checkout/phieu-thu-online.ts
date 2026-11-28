// lib/online-checkout/phieu-thu-online.ts — V8.19: PHIẾU THU PDF của khoản thu ĐƠN ONLINE cho phụ huynh (SataRobo bán · không theo cơ sở).
//
// Vì sao cần riêng: `taoPdfPhieuThuChoPhuHuynh` (web) xác định sở hữu qua `Payment.enrollment.studentId` và pháp nhân qua CƠ SỞ của đơn. Đơn Online KHÔNG có ghi danh Offline
// (Receipt gắn Order + Payment) và không có cơ sở ⇒ đường cũ trả 404 cho mọi khoản Online. Ở đây:
//   · SỞ HỮU = `Order.createdById` là phụ huynh đăng nhập VÀ `Order.type = ONLINE` (điều kiện nằm TRONG `where`, không lọc sau);
//   · PHÁP NHÂN: `taoPdfPhieuThu` tự rẽ nhánh ONLINE (`Order.legalEntityId` → MST khớp cấu hình hoá đơn; không khớp ⇒ 409, không đoán MST) — kế toán/Sale in cùng một tờ.
// Không kiểm «hướng chứng từ» (`huongChungTu`): hoá đơn Online chưa phát hành được (BLOCKED_DESIGN) nên phụ huynh Online luôn nhận phiếu thu.
import { db } from "@/lib/db";
import { KHOAN_DA_DONG } from "@/lib/finance/debt";
import { napKhoaTheoDong } from "@/lib/finance/hoa-don/ten-dong-hoc-phi-db";
import { KHOAN_PHIEU_THU_INCLUDE, dongDonTuKhoan, taoPdfPhieuThu, type KetQuaPdfPhieuThu } from "@/lib/pdf/phieu-thu-khoan";

const dieuKienSoHuu = (parentUserId: string, paymentId: string) => ({
  id: paymentId,
  ...KHOAN_DA_DONG,
  paymentType: "PAYMENT" as const,
  order: { type: "ONLINE" as const, createdById: parentUserId },
  receipts: { some: { status: "ACTIVE" as const, deletedAt: null } },
});

/** Khoản Online ĐÃ ĐÓNG có biên nhận ACTIVE và thuộc đơn do chính phụ huynh này tạo? (không dựng PDF) */
export async function khoanOnlineTaiDuoc(parentUserId: string, paymentId: string): Promise<boolean> {
  if (!parentUserId || !paymentId || paymentId.length > 64) return false;
  return (await db.payment.count({ where: dieuKienSoHuu(parentUserId, paymentId) })) > 0;
}

/** `null` = không có / của người khác / không phải đơn Online (route trả 404 y hệt). */
export async function taoPdfPhieuThuOnlineChoPhuHuynh(parentUserId: string, paymentId: string): Promise<KetQuaPdfPhieuThu | null> {
  if (!parentUserId || !paymentId || paymentId.length > 64) return null;
  const khoan = await db.payment.findFirst({ where: dieuKienSoHuu(parentUserId, paymentId), include: KHOAN_PHIEU_THU_INCLUDE });
  if (!khoan || !khoan.order) return null;
  const [nguoiThu, khoaTheoId] = await Promise.all([
    khoan.recordedById ? db.user.findUnique({ where: { id: khoan.recordedById }, select: { name: true } }) : Promise.resolve(null),
    napKhoaTheoDong(db, dongDonTuKhoan(khoan)),
  ]);
  // Pháp nhân do CHÍNH `taoPdfPhieuThu` quyết theo `Order.legalEntityId` khi đơn là ONLINE (cùng một tờ cho phụ huynh · kế toán · Sale).
  return taoPdfPhieuThu({ khoan, nguoiThu: nguoiThu?.name ?? null, centerCode: null, khoaTheoId });
}
