import "server-only";
// lib/finance/chi-hoan-tien.ts — bước "ĐÃ CHI" của một yêu cầu hoàn tiền: đưa tiền hoàn VÀO SỔ `Payment`.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao có (chủ dự án bảo làm 29/09/2026): trước bản này `/admin/hoan-tien` chỉ Duyệt / Từ chối,
// `RefundRequest` dừng ở APPROVED và KHÔNG đường nào ghi PAID ⇒ tiền hoàn đã duyệt không vào sổ, nên
// công nợ, số ròng của khoản (hoá đơn điện tử) và thực thu hoa hồng không thấy nó.
//
// Hàm này KHÔNG tính lại số tiền: số chi = `approvedAmount` mà người duyệt đã chốt. Việc của nó là
// ghi số đó vào sổ, đúng khoản nguồn, một lần.
//
// ── Khoản NGUỒN ──────────────────────────────────────────────────────────────
//   · Chỉ khoản kế toán ĐÃ XÁC NHẬN (`laKhoanDaXacNhan`), số DƯƠNG, không phải bút toán trỏ vào
//     khoản khác (`adjustmentOfId IS NULL`).
//     ⚠️ Cố ý KHÔNG dùng `KHOAN_DA_GHI_NHAN` (trục B — gồm cả khoản CHỜ kế toán): dòng hoàn mang
//     `REFUNDED` và được `WHERE_THUC_THU` cộng vào thực thu, còn khoản nguồn CHỜ thì không ⇒ hoàn từ
//     khoản chưa xác nhận là đẩy thực thu / doanh thu / hoa hồng xuống ÂM. Số `paidConfirmed` chụp
//     trên chính yêu cầu hoàn cũng là Σ khoản CONFIRMED — cùng một tập.
//   · Còn hoàn được của mỗi khoản = `amount` + Σ dòng còn sống trỏ `adjustmentOfId` vào nó (hoàn
//     trước, điều chỉnh). Dòng trỏ vào mang số ÂM thì LUÔN trừ (kể cả bị kế toán từ chối — nghiêng
//     về phía hoàn ít hơn); số dương chỉ cộng khi nó là tiền thật (`laKhoanDaDong`).
//   · Rót LIFO: khoản MỚI NHẤT trước.
//   · TRẦN THỨ HAI — ròng của cả phạm vi. Chuyển tiền giữa hai bé (`chuyenTienGiuaConTrongTx`) ghi
//     dòng âm KHÔNG trỏ `adjustmentOfId` ⇒ tiền đã chuyển đi vẫn trông "còn hoàn được" nếu chỉ đo
//     theo từng khoản. Nên tổng chi còn phải ≤ Σ thực thu RÒNG của phạm vi (`laKhoanDaDong`).
//
// ── Phạm vi (khoản của AI) ────────────────────────────────────────────────────
//   · Yêu cầu có `orderItemId` ⇒ khoản của dòng đơn đó, cộng khoản CHƯA gắn dòng nào mà gắn đúng
//     ghi danh của yêu cầu (tiền về trước lúc có dòng đơn).
//   · Chỉ có `enrollmentId` ⇒ khoản của ghi danh đó.
//   · Luôn trong MỘT đơn. Ghi danh được trả bởi nhiều đơn ⇒ TỪ CHỐI (không đoán đơn nào) — xem
//     `timDonCuaYeuCauHoan`.
//
// ── Transaction ──────────────────────────────────────────────────────────────
// Khoá đơn (`khoaDonTrongTx`, CÙNG khoá với mọi đường ghi tiền của đơn) TRƯỚC khi đọc; mọi cổng đứng
// TRƯỚC phép ghi đầu tiên; từ chối = `throw` (luật rollback). Phép ghi đầu tiên là chuyển trạng thái
// CÓ ĐIỀU KIỆN `APPROVED → PAID` — 0 dòng ⇒ `throw`, nên bấm hai lần không chi hai lần.
// ─────────────────────────────────────────────────────────────────────────────
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { laKhoanDaDong, laKhoanDaXacNhan } from "@/lib/finance/debt";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { RefundError } from "@/lib/finance/refund";
import { publishEvent } from "@/lib/events/publish";

type Tx = Prisma.TransactionClient;
type DocDon = Pick<Tx, "orderItem" | "payment">;

function vnd(n: number): string {
  return `${n.toLocaleString("vi-VN")} đ`;
}

/**
 * Đơn mà một yêu cầu hoàn thuộc về. Ném `RefundError` khi không xác định được MỘT đơn.
 *
 * Dùng ở HAI chỗ — action (để kiểm phạm vi cơ sở trên đơn TRƯỚC khi gọi) và `chiHoanTien` (hỏi lại
 * trong transaction). Một hàm, để hai bên không bao giờ chỉ vào hai đơn khác nhau.
 */
export async function timDonCuaYeuCauHoan(
  client: DocDon,
  rr: { orderItemId: string | null; enrollmentId: string | null },
): Promise<string> {
  if (rr.orderItemId) {
    const dong = await client.orderItem.findUnique({
      where: { id: rr.orderItemId },
      select: { orderId: true },
    });
    if (!dong) throw new RefundError("NO_ORDER", "Không tìm thấy dòng đơn của yêu cầu hoàn");
    return dong.orderId;
  }
  if (!rr.enrollmentId) {
    throw new RefundError("NO_ORDER", "Yêu cầu hoàn không gắn ghi danh hay dòng đơn nào");
  }
  const [khoan, dong] = await Promise.all([
    client.payment.findMany({
      where: { enrollmentId: rr.enrollmentId, deletedAt: null },
      select: { orderId: true },
      distinct: ["orderId"],
    }),
    client.orderItem.findMany({
      where: { enrollmentId: rr.enrollmentId },
      select: { orderId: true },
      distinct: ["orderId"],
    }),
  ]);
  const don = [...new Set([...khoan, ...dong].map((x) => x.orderId))];
  if (don.length === 0) {
    throw new RefundError("NO_ORDER", "Ghi danh này chưa có đơn / khoản thu nào — không có gì để hoàn vào sổ");
  }
  if (don.length > 1) {
    throw new RefundError(
      "MANY_ORDERS",
      `Ghi danh này được trả qua ${don.length} đơn — hệ thống chưa tự chia tiền hoàn giữa các đơn. Liên hệ quản trị để ghi tay.`,
    );
  }
  return don[0]!;
}

/** Đọc yêu cầu + đơn của nó — cho action kiểm quyền/phạm vi trước khi ghi. `null` = không có. */
export async function docYeuCauHoanDeChi(
  id: string,
): Promise<{ id: string; status: string; orderId: string } | null> {
  const rr = await db.refundRequest.findUnique({
    where: { id },
    select: { id: true, status: true, orderItemId: true, enrollmentId: true },
  });
  if (!rr) return null;
  const orderId = await timDonCuaYeuCauHoan(db, rr);
  return { id: rr.id, status: rr.status, orderId };
}

export type PhanRot = { paymentId: string; soTien: number };

/**
 * THUẦN — rót `soTien` vào các khoản theo LIFO. Trả `null` khi không đủ.
 * `khoan` phải đã sắp MỚI NHẤT trước; `conHoan` ≤ 0 bị bỏ qua.
 */
export function rotLifo(
  khoan: readonly { id: string; conHoan: number }[],
  soTien: number,
): PhanRot[] | null {
  const ra: PhanRot[] = [];
  let con = soTien;
  for (const k of khoan) {
    if (con <= 0) break;
    if (k.conHoan <= 0) continue;
    const lay = Math.min(k.conHoan, con);
    ra.push({ paymentId: k.id, soTien: lay });
    con -= lay;
  }
  return con > 0 ? null : ra;
}

export async function chiHoanTien(input: {
  refundRequestId: string;
  actorId: string;
  actorName: string;
  /** Mã phương thức (`PaymentMethod.code`) — action đã kiểm cơ sở. */
  method: string;
  paidDate: Date;
  note: string | null;
}): Promise<{ orderId: string; paymentIds: string[]; soTien: number }> {
  const actor: AuditActor = { id: input.actorId, name: input.actorName };
  const ghiChu = input.note?.trim() || null;

  return db.$transaction(async (tx) => {
    const rr0 = await tx.refundRequest.findUnique({
      where: { id: input.refundRequestId },
      select: { orderItemId: true, enrollmentId: true },
    });
    if (!rr0) throw new RefundError("NOT_FOUND", "Không tìm thấy yêu cầu hoàn tiền");
    const orderId = await timDonCuaYeuCauHoan(tx, rr0);

    // Khoá đơn TRƯỚC mọi phép đọc số tiền.
    await khoaDonTrongTx(tx, orderId);

    const rr = await tx.refundRequest.findUniqueOrThrow({
      where: { id: input.refundRequestId },
      select: {
        id: true,
        status: true,
        approvedAmount: true,
        orderItemId: true,
        enrollmentId: true,
        centerId: true,
        reason: true,
      },
    });
    if (rr.status !== "APPROVED") {
      throw new RefundError(
        "INVALID_STATE",
        rr.status === "PAID"
          ? "Yêu cầu này đã được đánh dấu ĐÃ CHI rồi"
          : `Yêu cầu đang ${rr.status} — chỉ chi được yêu cầu ĐÃ DUYỆT`,
      );
    }
    const soTien = rr.approvedAmount ?? 0;
    if (soTien <= 0) throw new RefundError("VALIDATION", "Số tiền hoàn đã duyệt phải lớn hơn 0");

    // Phạm vi khoản — xem đầu tệp.
    const phamVi: Prisma.PaymentWhereInput = rr.orderItemId
      ? {
          orderId,
          OR: [
            { orderItemId: rr.orderItemId },
            ...(rr.enrollmentId ? [{ orderItemId: null, enrollmentId: rr.enrollmentId }] : []),
          ],
        }
      : { orderId, enrollmentId: rr.enrollmentId };

    const dongPhamVi = await tx.payment.findMany({
      where: { ...phamVi, deletedAt: null },
      select: {
        id: true,
        amount: true,
        accountantStatus: true,
        deletedAt: true,
        adjustmentOfId: true,
        paidDate: true,
        createdAt: true,
        orderItemId: true,
        enrollmentId: true,
        centerId: true,
        saleStatus: true,
      },
    });
    const nguon = dongPhamVi
      .filter(
        (p) =>
          laKhoanDaXacNhan(p) &&
          p.amount > 0 &&
          p.adjustmentOfId == null,
      )
      .sort(
        (a, b) =>
          b.paidDate.getTime() - a.paidDate.getTime() ||
          b.createdAt.getTime() - a.createdAt.getTime() ||
          (a.id < b.id ? 1 : -1),
      );

    const troVao =
      nguon.length === 0
        ? []
        : await tx.payment.findMany({
            where: { adjustmentOfId: { in: nguon.map((n) => n.id) }, deletedAt: null },
            select: { adjustmentOfId: true, amount: true, accountantStatus: true, deletedAt: true },
          });
    const conHoan = new Map(nguon.map((n) => [n.id, n.amount]));
    for (const d of troVao) {
      if (d.amount >= 0 && !laKhoanDaDong(d)) continue;
      const id = d.adjustmentOfId as string;
      conHoan.set(id, (conHoan.get(id) ?? 0) + d.amount);
    }
    const tongTheoKhoan = [...conHoan.values()].reduce((s, v) => s + Math.max(0, v), 0);
    const rongPhamVi = dongPhamVi.filter((p) => laKhoanDaDong(p)).reduce((s, p) => s + p.amount, 0);
    const conHoanDuoc = Math.max(0, Math.min(tongTheoKhoan, rongPhamVi));

    const phan =
      soTien <= conHoanDuoc
        ? rotLifo(
            nguon.map((n) => ({ id: n.id, conHoan: conHoan.get(n.id) ?? 0 })),
            soTien,
          )
        : null;
    if (!phan) {
      throw new RefundError(
        "INSUFFICIENT",
        `Chỉ còn ${vnd(conHoanDuoc)} đã thu (kế toán đã xác nhận) có thể hoàn — yêu cầu duyệt ${vnd(soTien)}`,
      );
    }

    // ── Hết cổng. Phép ghi đầu tiên: chuyển trạng thái CÓ ĐIỀU KIỆN. ──
    const lat = await tx.refundRequest.updateMany({
      where: { id: rr.id, status: "APPROVED" },
      data: {
        status: "PAID",
        paidAt: input.paidDate,
        paidById: input.actorId,
        paidMethod: input.method,
      },
    });
    if (lat.count === 0) throw new RefundError("INVALID_STATE", "Yêu cầu vừa được người khác xử lý — tải lại trang");

    const now = new Date();
    const theoId = new Map(nguon.map((n) => [n.id, n]));
    const paymentIds: string[] = [];
    for (const p of phan) {
      const goc = theoId.get(p.paymentId)!;
      const dong = await tx.payment.create({
        select: { id: true },
        data: {
          orderId,
          enrollmentId: goc.enrollmentId,
          orderItemId: goc.orderItemId,
          amount: -p.soTien,
          method: input.method,
          paidDate: input.paidDate,
          // ⚠️ KHÔNG chép `note` của khoản gốc: nó mang marker ngân hàng, và `nguonGiaoDich` sẽ đọc
          // dòng hoàn thành một giao dịch ngân hàng.
          note: `Chi hoàn tiền (yêu cầu ${rr.id})${ghiChu ? ` — ${ghiChu}` : ""}`,
          saleStatus: goc.saleStatus,
          accountantStatus: "REFUNDED",
          recordedById: input.actorId,
          confirmedById: input.actorId,
          confirmedAt: now,
          adjustmentOfId: goc.id,
          centerId: goc.centerId,
          refundRequestId: rr.id,
        },
      });
      paymentIds.push(dong.id);
      await writeAudit({
        tx,
        actor,
        module: "finance",
        entityType: "Payment",
        entityId: dong.id,
        action: "CREATE",
        newValues: {
          accountantStatus: "REFUNDED",
          adjustmentOfId: goc.id,
          amount: -p.soTien,
          refundRequestId: rr.id,
          method: input.method,
        },
        reason: ghiChu ?? rr.reason,
        orgUnitId: goc.centerId,
      });
    }

    await writeAudit({
      tx,
      actor,
      module: "finance",
      entityType: "RefundRequest",
      entityId: rr.id,
      action: "STATUS_CHANGE",
      oldValues: { status: "APPROVED" },
      newValues: {
        status: "PAID",
        paidAt: input.paidDate.toISOString(),
        paidMethod: input.method,
        soTien,
        paymentIds,
      },
      changedFields: ["status", "paidAt", "paidById", "paidMethod"],
      reason: ghiChu ?? rr.reason,
      orgUnitId: rr.centerId,
    });

    // T14 (học bù): xem ghi chú ở `refundPayment` — chi hoàn tiền cũng KHÔNG đổi trạng thái đơn. MỘT sự kiện cho cả lượt chi (có thể rót nhiều khoản gốc).
    if (paymentIds[0]) {
      await publishEvent("payment.refunded", { orderId, paymentId: paymentIds[0], paymentIds }, { tx, dedupeKey: `payment.refunded:${paymentIds[0]}` });
    }
    return { orderId, paymentIds, soTien };
  });
}
