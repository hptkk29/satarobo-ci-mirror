// lib/payments/allocation.ts — PHÂN BỔ WATERFALL (thuần, không chạm DB).
//
// Luật (chốt chủ dự án 03/08):
//  • Tiền về LUÔN được ghi nhận. Lệch số tiền KHÔNG BAO GIỜ là lý do từ chối.
//  • Rót từ phiếu thu đích, còn dư thì tràn sang phiếu CHƯA ĐÓNG ĐỦ kế tiếp
//    (sortOrder tăng dần) của cùng đơn; hết phiếu mà vẫn dư → tiền thừa.
//  • Rót không đủ → phiếu PARTIAL. Không hoàn, không đẩy sang xử lý tay.
//  • Dung sai làm tròn: thiếu ≤ ngưỡng → coi phiếu PAID, ghi phần chênh.
//
// Tách thuần khỏi DB có chủ đích: đây là chỗ dễ sai nhất của cả tính năng (tiền),
// nên nó phải test được bằng bảng số mà không cần dựng Postgres.

/** Trạng thái phiếu thu — TÍNH RA từ sổ, không phải cờ gán tay. */
export type RequestStatus = "PENDING" | "PARTIAL" | "PAID" | "VOID";

export type AllocTarget = {
  id: string;
  amountDue: number;
  /** Đã phân bổ từ trước (tổng PaymentAllocation hiện có của phiếu này). */
  allocated: number;
  sortOrder: number;
  status: RequestStatus;
};

export type AllocationLine = {
  paymentRequestId: string;
  amount: number;
  /** Phần thiếu được tha theo dung sai làm tròn (0 nếu không có). */
  roundingWaived: number;
};

export type AllocationPlan = {
  lines: AllocationLine[];
  /** Tiền còn dư sau khi rót hết mọi phiếu → CreditBalance. */
  credit: number;
};

/**
 * Còn thiếu của một phiếu. VOID coi như không cần thu.
 * KHÔNG âm — phiếu đã rót dư (do dung sai / ghi tay) trả 0.
 */
export function outstandingOf(t: AllocTarget): number {
  if (t.status === "VOID") return 0;
  return Math.max(0, t.amountDue - t.allocated);
}

/**
 * Dựng kế hoạch rót cho MỘT giao dịch.
 *
 * @param amount   số tiền giao dịch (đã là số nguyên VND)
 * @param targets  mọi phiếu thu của đơn (kể cả đã PAID — hàm tự bỏ qua)
 * @param startId  phiếu đích tra được từ matchKey/QR; không truyền hoặc không
 *                 thuộc `targets` thì bắt đầu từ phiếu chưa đóng đủ sớm nhất
 * @param tolerance ngưỡng dung sai làm tròn (VND), mặc định 0 = không tha
 */
export function planAllocation(
  amount: number,
  targets: AllocTarget[],
  startId?: string | null,
  tolerance = 0,
): AllocationPlan {
  const lines: AllocationLine[] = [];
  let remaining = Math.max(0, Math.round(amount));
  if (remaining === 0) return { lines, credit: 0 };

  // Thứ tự rót: phiếu đích trước (dù sortOrder lớn — sale xuất QR đợt nào thì
  // tiền phải vào đợt đó), rồi tới các phiếu còn lại theo sortOrder tăng dần.
  const rest = [...targets].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const start = startId ? rest.find((t) => t.id === startId) : undefined;
  const queue = start ? [start, ...rest.filter((t) => t.id !== start.id)] : rest;

  for (const t of queue) {
    if (remaining <= 0) break;
    const need = outstandingOf(t);
    if (need <= 0) continue;

    if (remaining >= need) {
      lines.push({ paymentRequestId: t.id, amount: need, roundingWaived: 0 });
      remaining -= need;
      continue;
    }

    // Không đủ: rót hết phần còn lại. Nếu phần thiếu nằm trong dung sai thì coi
    // phiếu đã đủ (ghi lại phần tha để kế toán thấy), ngược lại phiếu PARTIAL.
    const shortfall = need - remaining;
    lines.push({
      paymentRequestId: t.id,
      amount: remaining,
      roundingWaived: shortfall > 0 && shortfall <= tolerance ? shortfall : 0,
    });
    remaining = 0;
  }

  return { lines, credit: remaining };
}

/**
 * Trạng thái phiếu thu sau khi đã cộng dồn phân bổ. VOID giữ nguyên (huỷ tay).
 * `waived` = tổng phần thiếu đã tha theo dung sai.
 */
export function deriveStatus(
  amountDue: number,
  allocated: number,
  waived = 0,
  current: RequestStatus = "PENDING",
): RequestStatus {
  if (current === "VOID") return "VOID";
  if (allocated <= 0) return "PENDING";
  if (allocated + waived >= amountDue) return "PAID";
  return "PARTIAL";
}

/** Đơn đã đóng đủ chưa = MỌI phiếu chưa VOID đều PAID. Đơn 0 phiếu → chưa. */
export function isOrderSettled(statuses: RequestStatus[]): boolean {
  const active = statuses.filter((s) => s !== "VOID");
  return active.length > 0 && active.every((s) => s === "PAID");
}
