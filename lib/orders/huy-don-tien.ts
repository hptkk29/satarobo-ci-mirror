// lib/orders/huy-don-tien.ts — PHẦN TIỀN của lượt HUỶ ĐƠN. CHẠM TIỀN (trạng thái phiếu thu + phiếu gộp).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH RA — rà đối kháng vòng 5 (30/09/2026)
//
// Huỷ đơn (`changeOrderStatusAction` → CANCELLED) là đường VOID đợt THỨ SÁU, và là đường duy nhất
// từng không đi qua soát phiếu gộp lẫn khoá đơn:
//   · không soát ⇒ phiếu gộp ở lại OPEN trên các đợt vừa VOID, trang đơn đã huỷ vẫn in QR mời trả
//     (luật 12), không ai được nhắc "báo phụ huynh bỏ QR cũ";
//   · không khoá ⇒ lượt thu đang giữ khoá (`thuTheoPhieuGop` đã qua cổng đợt VOID bằng ảnh chụp)
//     rót tiền vào đợt vừa VOID, ghi `Payment` trên đơn đã huỷ — cùng một sự kiện hai kết cục tuỳ
//     thứ tự (ca `[V5-01]`).
// Tài liệu vòng 3/4 từng nói nhánh đó "không còn đường sinh" — sai, nút Huỷ đơn sinh nó hằng ngày.
//
// ⚠️ Người gọi PHẢI đang giữ `khoaDonTrongTx(tx, orderId)` làm câu ĐẦU TIÊN của transaction
// (lưới `[KDK-W4]`). Hàm nằm ở tệp riêng để ca DB gọi đúng phép ghi mà action dùng.
// ─────────────────────────────────────────────────────────────────────────────
import type { Prisma } from "@prisma/client";
import { soatPhieuGopMoTrongTx, type PhieuDaSoat } from "@/lib/finance/soat-phieu-gop-db";

type Tx = Prisma.TransactionClient;

/**
 * VOID mọi phiếu thu CHƯA PAID (kể cả PARTIAL), hết hạn QR đời cũ của chúng, rồi soát phiếu gộp
 * đang mở trên các đợt vừa VOID (chưa nhận đồng nào ⇒ HUỶ, đã nhận ⇒ ĐÓNG). Trả các phiếu gộp đã
 * soát để action NÓI RA trên toast.
 *
 * Phiếu `PAID` KHÔNG đụng — bằng chứng một lần thu đã hoàn tất; tiền của đơn huỷ là việc hoàn của
 * kế toán. VOID không xoá đồng nào: `PaymentAllocation` còn nguyên.
 */
export async function voidTienKhiHuyDonTrongTx(tx: Tx, orderId: string): Promise<PhieuDaSoat[]> {
  await tx.paymentRequest.updateMany({
    where: { orderId, status: { in: ["PENDING", "PARTIAL"] } },
    data: { status: "VOID" },
  });
  // Mã QR đang sống của các phiếu đó cũng phải chết theo — không thì màn hình vẫn hiện một mã bấm
  // được, và affordance đó nói dối (luật 12).
  await tx.qrSession.updateMany({
    where: { paymentRequest: { orderId }, status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });
  return soatPhieuGopMoTrongTx(tx, orderId);
}
