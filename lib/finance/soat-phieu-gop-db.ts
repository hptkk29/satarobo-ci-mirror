// lib/finance/soat-phieu-gop-db.ts — tầng DB của `soat-phieu-gop.ts`. CHẠM TIỀN.
//
// ⚠️ KHÔNG import gì của `lib/payments/payment-request.ts`: tệp này được
// `recomputeRequestStatuses` (trong chính tệp đó) gọi — import ngược lại là vòng.
//
// Ghi bằng `updateMany` CÓ ĐIỀU KIỆN `status: "OPEN"` ⇒ lượt khác vừa đổi phiếu thì phép ghi đổi 0
// dòng, không ghi đè. ⚠️ Điều kiện đó CHỈ chống ghi đè trạng thái phiếu — nó KHÔNG làm quyết định
// VOID/CLOSED đúng: `daNhan` đọc phân bổ ĐÃ commit, nên người gọi PHẢI giữ khoá đơn
// (`khoaDonTrongTx`) để lượt thu đang chạy (`thuTheoPhieuGop`) không rót tiền giữa lúc soát. Rà vòng
// 4 (30/09/2026): lưu/duyệt/từ chối kế hoạch từng gọi soát KHÔNG khoá ⇒ phiếu đã nhận đủ bị ghi
// VOID "chưa nhận đồng nào", tiền rót vào đợt VOID (ca `[V3-06]`).
import type { Prisma } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { quyetPhieuDoiSo, quyetPhieuMo, type DichPhieuMo } from "./soat-phieu-gop";

type Tx = Prisma.TransactionClient;

/** Người ghi nhật ký (người bấm nằm ở nhật ký của lượt VOID đợt gây ra việc này). */
const HE_THONG: AuditActor = { id: null, name: "Hệ thống — soát phiếu gộp" };

export type PhieuDaSoat = { billId: string; ma: string | null; dich: DichPhieuMo };

/**
 * Huỷ / đóng mọi phiếu gộp OPEN của đơn có dòng trỏ đợt ĐÃ VOID (`quyetPhieuMo`). Gọi SAU phép
 * VOID đợt. Chạy nhanh khi đơn không có phiếu mở (một câu tra theo chỉ mục `orderId`).
 */
export async function soatPhieuGopMoTrongTx(tx: Tx, orderId: string): Promise<PhieuDaSoat[]> {
  return soat(tx, orderId, []);
}

/**
 * Huỷ / đóng mọi phiếu gộp OPEN của đơn có dòng trỏ một đợt VỪA ĐỔI SỐ TIỀN (`dotDoiSo`) — rà vòng 5,
 * ca `[V5-41]`. Gọi SAU phép sửa `amountDue` (`materializeInstallmentRequests`), dưới khoá đơn. Không
 * suy được "đổi số" từ dữ liệu (dòng phiếu chụp phần CÒN THIẾU lúc phát, không chụp `amountDue`) nên
 * người ghi phải NÓI đợt nào vừa đổi — bằng đúng hàm thuần mà màn nói-trước dùng.
 */
export async function soatPhieuGopDoiSoTrongTx(
  tx: Tx,
  orderId: string,
  dotDoiSo: readonly string[],
): Promise<PhieuDaSoat[]> {
  if (dotDoiSo.length === 0) return [];
  return soat(tx, orderId, dotDoiSo);
}

async function soat(tx: Tx, orderId: string, dotDoiSo: readonly string[]): Promise<PhieuDaSoat[]> {
  const mo = await tx.paymentBill.findMany({
    where:
      dotDoiSo.length === 0
        ? { orderId, status: "OPEN", lines: { some: { paymentRequest: { status: "VOID" } } } }
        : { orderId, status: "OPEN", lines: { some: { paymentRequestId: { in: [...dotDoiSo] } } } },
    select: {
      id: true,
      matchKey: true,
      centerId: true,
      lines: {
        select: {
          paymentRequestId: true,
          paymentRequest: { select: { status: true, allocations: { select: { amount: true } } } },
        },
      },
    },
  });

  const ketQua: PhieuDaSoat[] = [];
  for (const p of mo) {
    const daNhan = p.lines.reduce((s, l) => s + l.paymentRequest.allocations.reduce((t, a) => t + a.amount, 0), 0);
    const q =
      quyetPhieuMo({ daNhan, coDotDaHuy: p.lines.some((l) => l.paymentRequest.status === "VOID") }) ??
      (dotDoiSo.length > 0 && p.lines.some((l) => dotDoiSo.includes(l.paymentRequestId)) ? quyetPhieuDoiSo({ daNhan }) : null);
    if (!q) continue;

    const upd = await tx.paymentBill.updateMany({ where: { id: p.id, status: "OPEN" }, data: { status: q.dich } });
    if (upd.count === 0) continue;
    ketQua.push({ billId: p.id, ma: p.matchKey, dich: q.dich });

    await writeAudit({
      tx,
      actor: HE_THONG,
      module: "finance",
      entityType: "Order",
      entityId: orderId,
      action: q.dich === "VOID" ? "PHIEU_GOP_VOID" : "PHIEU_GOP_CLOSED",
      oldValues: { billId: p.id, ma: p.matchKey, status: "OPEN" },
      newValues: { billId: p.id, status: q.dich },
      reason: q.lyDo,
      orgUnitId: p.centerId,
    });
  }
  return ketQua;
}
