// lib/portal/phieu-thu-ph.ts — PHỤ HUYNH tải PHIẾU THU PDF của con mình (12/11/2026).
//
// Luật hiển thị (chủ dự án): đơn CŨ (trước 01/11/2026) luôn hiện PHIẾU THU; đơn MỚI hiện HOÁ ĐƠN nếu phụ huynh có yêu cầu hoá đơn,
// không thì PHIẾU THU. Quyết định ở MỘT hàm `huongChungTu` (hoa-don-phu-huynh-thuan.ts) — danh sách học phí và route tải dùng chung,
// nên không có chuyện hiện nút tải phiếu cho đơn mà luật bảo phải hiện hoá đơn.
//
// QUYỀN = QUYỀN SỞ HỮU (không có `can()` nào cho phụ huynh): khoản phải thuộc ghi danh của MỘT TRONG CÁC CON của phụ huynh đăng nhập
// (`childIds` lấy từ phiên, không từ URL). Không thấy / của người khác / không đúng nhóm chứng từ ⇒ `null` (route trả 404 y hệt).
// Dùng `db` trần ở `lib/` (ESLint cấm ở `app/(portal)/**`); điều kiện sở hữu nằm ngay trong `where`, không lọc sau.
import { db } from "@/lib/db";
import { KHOAN_DA_DONG } from "@/lib/finance/debt";
import { napKhoaTheoDong } from "@/lib/finance/hoa-don/ten-dong-hoc-phi-db";
import { KHOAN_PHIEU_THU_INCLUDE, dongDonTuKhoan, taoPdfPhieuThu, type KetQuaPdfPhieuThu } from "@/lib/pdf/phieu-thu-khoan";
import { huongChungTu } from "@/lib/portal/hoa-don-phu-huynh-thuan";

export async function taoPdfPhieuThuChoPhuHuynh(
  childIds: readonly string[],
  paymentId: string,
): Promise<KetQuaPdfPhieuThu | null> {
  if (childIds.length === 0 || !paymentId) return null;
  const khoan = await db.payment.findFirst({
    where: {
      id: paymentId,
      ...KHOAN_DA_DONG,
      paymentType: "PAYMENT",
      enrollment: { studentId: { in: [...childIds] }, deletedAt: null },
      receipts: { some: { status: "ACTIVE", deletedAt: null } },
    },
    include: KHOAN_PHIEU_THU_INCLUDE,
  });
  if (!khoan || !khoan.order) return null;
  // Đơn thuộc nhóm HOÁ ĐƠN ⇒ phụ huynh nhận hoá đơn, không phải phiếu thu.
  if (huongChungTu(khoan.order) !== "PHIEU_THU") return null;

  const [nguoiThu, coSo, khoaTheoId] = await Promise.all([
    khoan.recordedById ? db.user.findUnique({ where: { id: khoan.recordedById }, select: { name: true } }) : Promise.resolve(null),
    khoan.order.centerId ? db.center.findUnique({ where: { id: khoan.order.centerId }, select: { code: true } }) : Promise.resolve(null),
    napKhoaTheoDong(db, dongDonTuKhoan(khoan)),
  ]);
  return taoPdfPhieuThu({ khoan, nguoiThu: nguoiThu?.name ?? null, centerCode: coSo?.code ?? null, khoaTheoId });
}
