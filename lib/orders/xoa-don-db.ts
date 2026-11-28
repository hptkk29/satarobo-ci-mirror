// lib/orders/xoa-don-db.ts — phần CHẠM DB của việc xoá đơn đã huỷ.
//
// ⚠️ VÌ SAO Ở `lib/` CHỨ KHÔNG Ở TRONG SERVER ACTION [02/10/2026]. Hai lý do, và lý do
// thứ hai mới là lý do thật:
//
//  1. ESLint cấm `import { db } from "@/lib/db"` trần trong `app/(admin)/**` (cổng DB đã
//     đóng — CLAUDE.md luật #4).
//  2. **Phép ĐẾM ĐỂ CHẶN phải KHÔNG-SCOPE.** Nếu đếm qua `scopedDb` thì đúng dấu vết cần
//     thấy có thể bị lọc mất (một `Payment` mang `centerId` khác, hoặc trống), đếm ra 0,
//     và cổng đọc 0 thành "đơn sạch" ⇒ **mở toang đúng lúc phải đóng**. Đây là cùng bài
//     học đã ghi cho `lib/payments/method-lookup.ts` trong CLAUDE.md.
//     Phạm vi cơ sở KHÔNG mất: nơi gọi đã gác bằng `passesScope("Order", …)` trên chính
//     đơn trước khi gọi vào đây.
import { db } from "@/lib/db";
import { demDongBuTroToiDon } from "@/lib/hoc-bu/phu-thuoc";
import type { DauVetDon } from "./xoa-don-huy";

/**
 * Đếm mọi dấu vết tiền/chứng từ của một đơn.
 *
 * ⚠️ `payment.count` KHÔNG lọc `deletedAt` — cố ý. Một khoản thu đã xoá mềm vẫn là lịch
 * sử tiền; xoá cứng đơn là xoá luôn dòng ấy, nên nó phải CHẶN.
 */
export async function demDauVetDon(
  orderId: string,
  status: string,
): Promise<DauVetDon & { phieuIds: string[] }> {
  const phieuIds = (
    await db.paymentRequest.findMany({ where: { orderId }, select: { id: true } })
  ).map((p) => p.id);

  const [soKhoanThu, soPhanBo, soMaQrConSong, soPhieuGopConSong, soHoaDon, soXuatKho, soSoDuTinDung, soDongHocBu] =
    await Promise.all([
      db.payment.count({ where: { orderId } }),
      phieuIds.length
        ? db.paymentAllocation.count({ where: { paymentRequestId: { in: phieuIds } } })
        : Promise.resolve(0),
      phieuIds.length
        ? db.qrSession.count({ where: { paymentRequestId: { in: phieuIds }, status: "ACTIVE" } })
        : Promise.resolve(0),
      db.paymentBill.count({ where: { orderId, status: { not: "VOID" } } }),
      db.hoaDonDienTu.count({ where: { orderId } }),
      db.productMovement.count({ where: { orderId } }),
      db.creditBalance.count({ where: { orderId } }),
      demDongBuTroToiDon(orderId),
    ]);

  return {
    status,
    soKhoanThu,
    soPhanBo,
    soMaQrConSong,
    soPhieuGopConSong,
    soHoaDon,
    soXuatKho,
    soSoDuTinDung,
    soDongHocBu,
    phieuIds,
  };
}

/**
 * Xoá CỨNG đơn + các bảng con MÔ TẢ của nó.
 *
 * ⚠️ THỨ TỰ BẮT BUỘC, không phải cẩn thận thừa: 8/10 bảng trỏ vào `Order` khai
 * `onDelete: Restrict` (đo schema 02/10), nên xoá đơn khi còn con là Postgres NÉM. Lớp
 * ấy là lưới an toàn cuối cùng — nếu cổng ở `lyDoKhongXoaDuoc` có lỗ thì DB vẫn chặn,
 * chỉ là câu lỗi khó đọc hơn.
 *
 * ⚠️ CHỈ gọi sau khi `lyDoKhongXoaDuoc` trả `null`. Mọi bảng GIỮ TIỀN (`Payment`,
 * `PaymentAllocation`, `PaymentBill`, `HoaDonDienTu`, `ProductMovement`, `CreditBalance`)
 * đã được chứng minh RỖNG ở đó, nên hàm này cố ý KHÔNG xoá chúng: gặp dòng nào trong số
 * ấy thì phải để DB ném, đừng lặng lẽ dọn hộ.
 */
export async function xoaDonVaCon(orderId: string, phieuIds: string[]): Promise<void> {
  await db.$transaction(async (tx) => {
    if (phieuIds.length) {
      await tx.qrSession.deleteMany({ where: { paymentRequestId: { in: phieuIds } } });
    }
    await tx.paymentRequest.deleteMany({ where: { orderId } });
    await tx.orderInstallment.deleteMany({ where: { orderId } });
    await tx.orderStatusHistory.deleteMany({ where: { orderId } });
    await tx.voucherRedemption.deleteMany({ where: { orderId } });
    await tx.orderItem.deleteMany({ where: { orderId } });
    await tx.order.delete({ where: { id: orderId } });
  });
}
