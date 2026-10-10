// lib/payments/installment-plan.ts — MỘT chỗ trả lời "kế hoạch trả góp này còn hiệu lực không".
//
// VÌ SAO TÁCH RA: câu này phải trả lời ở HAI nơi, và trước bản vá 13/09/2026 hai nơi
// trả lời KHÁC NHAU:
//   • `lib/payments/due-now.ts` — quyết định QR in số tiền nào + ngưỡng đối khớp SePay
//   • `lib/orders/installments.ts` (`markInstallmentPaid`) — quyết định có ghi khoản
//     thu vào sổ cũ (Ledger-A `Payment`) không
// Hai bên tự viết điều kiện riêng thì lệch, mà kiểu lệch ở đây là TIỀN THẬT: bên này
// nhận tiền đợt 1, bên kia không ghi nhận ⇒ khách đã đóng mà công nợ không giảm.
//
// File THUẦN — không Prisma, không DB, không server-only. Kiểu tham số là `string | null`
// (không phải enum Prisma) để `due-now.ts` giữ được tính thuần của nó.

// TODO(PHA-2): GỠ HẲN FILE NÀY khi bỏ duyệt đơn QLCS.
//
// PHA 2 xoá cơ chế duyệt đơn ⇒ `Order.installmentApprovalStatus` biến mất ⇒ hàm dưới
// đây chỉ còn một nhánh và LUÔN TRẢ `true`. Lúc đó phải gỡ cả hàm, cả 2 chỗ gọi
// (`computeDueNow`, `markInstallmentPaid`), cả 2 file test — KHÔNG để lại.
//
// Vì sao ghi TODO thay vì để đó: một hàm luôn trả `true` là loại rác khó thấy nhất, vì
// nó TRÔNG NHƯ một cổng an toàn. Người đọc sau thấy `if (isInstallmentPlanActive(...))`
// sẽ tin là có kiểm tra, rồi xây thêm lên trên cái không kiểm gì. Đúng cái bẫy mà
// `isPaymentLedgerV2Enabled` (cờ 0 đường gọi, xem CLAUDE.md) đã mắc.

/**
 * Kế hoạch trả góp của đơn có còn hiệu lực để THU THEO ĐỢT không.
 *
 * ⚠️ ĐẢO LUẬT 13/09/2026 — trước đây chỉ `null` và `APPROVED` được coi là có hiệu lực;
 * `PENDING_APPROVAL` bị loại. Luật cũ đó là tàn dư của QĐ-1 bản ĐẦU ("phiếu thu theo
 * đợt chỉ ra đời khi QLCS bấm duyệt") — mà chính QĐ-1 **đã bị chủ dự án đảo ngày
 * 03/08/2026**: xem `lib/payments/payment-request.ts:184-192`, nơi
 * `materializeInstallmentRequests` gỡ hẳn cái chặn "chưa APPROVED thì ném lỗi", với lý
 * do "bấm Lưu kế hoạch là phiếu thu + QR theo đợt phải có NGAY, không bắt khách đứng ở
 * quầy chờ quản lý duyệt mới quét được mã. Duyệt nay chỉ còn nghĩa KHOÁ kế hoạch".
 *
 * Hai file gọi hàm này thì KHÔNG được đảo theo, nên hệ quả đo được trên prod là:
 * lưu kế hoạch xong, `PaymentRequest` đã có phiếu đợt 1 / đợt 2 đúng số tiền, nhưng
 * `computeDueNow` vẫn coi kế hoạch không tồn tại và in QR **cả học phí**. Khách phải
 * đóng 2.500.000đ thì mã QR hiện 5.000.000đ.
 *
 * `REJECTED` vẫn KHÔNG có hiệu lực — và đó không phải ngoại lệ tuỳ ý: khi QLCS bác kế
 * hoạch, `rejectInstallmentPlan` gọi `revertInstallmentRequests` (VOID phiếu theo đợt +
 * dựng lại phiếu "thu toàn đơn"). Sổ phiếu quay về thu cả đơn, nên số tiền cần thu ngay
 * cũng phải quay về cả đơn. Giữ `REJECTED` là loại chính là để hai sổ KHỚP nhau.
 *
 * Bất biến cần nhớ: hàm này phải trả lời GIỐNG cái mà `materializeInstallmentRequests`
 * đã thực sự ghi vào `PaymentRequest`. Sửa một bên mà không sửa bên kia là dựng lại
 * đúng con bug này.
 */
export function isInstallmentPlanActive(
  installmentApprovalStatus: string | null | undefined,
): boolean {
  return installmentApprovalStatus !== "REJECTED";
}
