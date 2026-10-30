import "server-only";
// lib/payments/sau-da-chia.ts — VIỆC SAU KHI TIỀN PHIẾU GỘP CHIA XONG (handler `phieu-gop.da-chia`).
// [GĐ1 POS · 06/10/2026 — thiết kế docs/pos-gd1-thiet-ke.md §5.3]
//
// Lỗ hổng GĐ0 tìm ra: đường phiếu gộp (QR mã mới + thẻ POS) chia tiền xong trả `settled:false` và
// KHÔNG làm ba việc mà `allocateToOrder` làm khi tiền vào — đẩy lead lên "Đã đăng ký", chốt đơn thu
// đủ + cấp tài khoản phụ huynh + biên nhận — và không báo sale. `thuTheoPhieuGop` phát sự kiện TRONG
// transaction rót tiền (outbox); handler này chạy SAU commit, CÙNG luật `allocateToOrder`:
//
//   (1) TIỀN CÒN ĐÓ KHÔNG — đọc sau commit. Kế toán gỡ gắn trước lúc handler chạy ⇒ không báo,
//       không chốt, không đẩy lead (`[POS1-EV-03]`).
//   (2) LEAD → "Đã đăng ký": CÙNG hàm + CÙNG actor `id:null "Tiền về qua X"` với `allocateToOrder`;
//       idempotent (guard `CHO_QUYET_DINH`). Transaction riêng (T6) — lỗi phễu không bao giờ chặn
//       được việc ghi tiền (tiền đã commit trước đó).
//   (3) BÁO SALE phụ trách (lead → người lập đơn → QLCS — `nguoiNhanPhiaSale`, dùng chung hoá đơn).
//       Dedupe theo (giao dịch, phiếu). KHÔNG in số tiền (PRD T5: panel chuông mở giữa chỗ đông người).
//   (4) ĐƠN THU ĐỦ ⇒ `sauKhiDonThuDu` — CHÍNH hàm `allocateToOrder` dùng: chốt có điều kiện ⇒ chỉ
//       lượt chốt mới ghi lịch sử + cấp tài khoản + gửi biên nhận (T5). Thu một đợt lẻ: KHÔNG biên
//       nhận — mẫu `PAYMENT_RECEIPT` nói "đơn … đã thanh toán thành công" (`[POS1-EV-05]`).
//       ⚠️ F6: tới đây đơn thường ĐÃ CONFIRMED NGẦM — `recomputeRequestStatuses` (gọi trong giao dịch
//       rót tiền của `thuTheoPhieuGop`) tự rollup đơn thu đủ lên CONFIRMED + `paidAt`, không lịch sử,
//       không `confirmedAt`, không biên nhận. Nên handler xin `nhanDonChotNgam: true`: nhận lượt
//       sau-chốt bằng phép ghi có điều kiện `confirmedAt IS NULL` (đúng một lần — `[POS1-EV-04]`).
//
// Idempotent cả khối: chạy lại (dispatcher thử lại / hai sự kiện cùng đơn) không gửi trùng
// (`[POS1-EV-04]`). Rollback riêng phần này: gỡ dòng `registerPhieuGopDaChiaHandlers()` ở
// `lib/events/register.ts` — sự kiện vẫn ghi, dispatcher đóng DONE; tiền không đổi.
import { z } from "zod";
import { db } from "@/lib/db";
import { on } from "@/lib/events/registry";
import { maybeAdvanceLeadToRegistered } from "@/lib/leads/tien-vao-day-pheu";
import { notifyStaff } from "@/lib/notifications/notify";
import { nguoiNhanPhiaSale } from "@/lib/notifications/nguoi-nhan-phia-sale";
import { isOrderSettled, type RequestStatus } from "@/lib/payments/allocation";
import { sauKhiDonThuDu } from "@/lib/payments/don-thu-du";
import { PROVIDER_THE_POS } from "@/lib/payments/pos/kieu";
import { gioVN } from "@/lib/format/thoi-gian-vn";

/** Nhãn phương thức trên biên nhận phụ huynh cho khoản thu bằng thẻ qua máy POS. */
export const NHAN_THE_POS = "Thẻ (máy POS)";

/** Payload do `thuTheoPhieuGop` phát (`lib/finance/phieu-gop.ts`). Zod: handler không tin JSON cũ. */
const payloadSchema = z.object({
  bankTransactionId: z.string().min(1),
  billId: z.string().min(1),
  ma: z.string().nullable(),
  orderId: z.string().min(1),
  provider: z.string().min(1),
  providerTxnId: z.string().min(1),
  tong: z.number().int(),
  ngayThu: z.string(),
});
export type PayloadDaChia = z.infer<typeof payloadSchema>;

/** Đọc payload sự kiện — hỏng thì NÉM (dispatcher ghi lỗi + thử lại / FAILED, không im lặng). */
export function docPayloadDaChia(raw: unknown): PayloadDaChia {
  return payloadSchema.parse(raw);
}

export async function xuLyPhieuGopDaChia(p: PayloadDaChia): Promise<void> {
  // (1) TIỀN CÒN ĐÓ KHÔNG — phân bổ của giao dịch vào dòng của CHÍNH phiếu gộp này.
  const bt = await db.bankTransaction.findUnique({
    where: { id: p.bankTransactionId },
    select: {
      status: true,
      allocations: {
        where: { paymentRequest: { billLines: { some: { billId: p.billId } } } },
        select: { amount: true },
      },
    },
  });
  if (!bt || bt.status !== "MATCHED" || bt.allocations.length === 0) return;

  const don = await db.order.findUnique({
    where: { id: p.orderId },
    select: {
      id: true,
      code: true,
      centerId: true,
      leadId: true,
      createdById: true,
      lead: { select: { assignedToId: true } },
    },
  });
  if (!don) return;

  // (2) LEAD → "Đã đăng ký" — cùng điều kiện + actor với `allocateToOrder` (payos-ingest.ts).
  const leadId = don.leadId;
  if (leadId) {
    await db.$transaction((tx) =>
      maybeAdvanceLeadToRegistered(tx, {
        leadId,
        actor: { id: null, name: `Tiền về qua ${p.provider}`, centerId: don.centerId },
      }),
    );
  }

  // (3) BÁO SALE phụ trách.
  if (don.centerId) {
    const ai = await nguoiNhanPhiaSale({
      centerId: don.centerId,
      order: { createdById: don.createdById, lead: don.lead },
    });
    if (ai.length > 0) {
      const luc = new Date(p.ngayThu);
      const gio = Number.isNaN(luc.getTime()) ? "" : ` · lúc ${gioVN(luc).slice(11, 16)}`;
      await notifyStaff({
        userIds: ai,
        dedupeKey: `phieu-gop.da-chia:${p.bankTransactionId}:${p.billId}`,
        title: `Đã nhận tiền — đơn ${don.code}`,
        body:
          `${p.provider === PROVIDER_THE_POS ? "Thẻ POS" : "Chuyển khoản"} · mã ${p.ma ?? "—"}${gio}. ` +
          "Chờ kế toán xác nhận — mở đơn để Chuyển đổi.",
        href: `/orders/${don.id}`,
        entityId: don.id,
      });
    }
  }

  // (4) ĐƠN THU ĐỦ ⇒ CÙNG hàm `allocateToOrder` (T5).
  const dot = await db.paymentRequest.findMany({ where: { orderId: don.id }, select: { status: true } });
  if (isOrderSettled(dot.map((d) => d.status as RequestStatus))) {
    await sauKhiDonThuDu({
      orderId: don.id,
      soTien: p.tong,
      providerTxnId: p.providerTxnId,
      nguoiChot: `Tiền về qua ${p.provider} (phiếu gộp ${p.ma ?? p.billId})`,
      // F6: đường phiếu gộp đã bị recompute đặt CONFIRMED NGẦM trong giao dịch rót tiền.
      nhanDonChotNgam: true,
      // Biên nhận in ĐÚNG đường tiền: thẻ ⇒ "Thẻ (máy POS)"; khác ⇒ hành vi cũ (rà đối kháng 06/10/2026).
      nhanPhuongThuc: p.provider === PROVIDER_THE_POS ? NHAN_THE_POS : null,
    });
  }
}

export function registerPhieuGopDaChiaHandlers(): void {
  on("phieu-gop.da-chia", async (e) => {
    await xuLyPhieuGopDaChia(docPayloadDaChia(e.payload));
  });
}
