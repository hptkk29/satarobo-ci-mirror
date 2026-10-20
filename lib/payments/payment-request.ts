import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import {
  InstallmentMoneyBlocked,
  doiTienDotDaThu,
} from "@/lib/payments/plan-money-guard";
import {
  deriveStatus,
  isOrderSettled,
  outstandingOf,
  type RequestStatus,
} from "@/lib/payments/allocation";

// =============================================================================
// 03/08 — VÒNG ĐỜI PHIẾU THU (PaymentRequest). NƠI DUY NHẤT tạo/huỷ phiếu thu.
//
// Hai quyết định của chủ dự án mà file này hiện thực hoá:
//
//  QĐ-1 — Phiếu thu theo ĐỢT chỉ sinh ra khi QLCS BẤM DUYỆT kế hoạch trả góp.
//    Ràng buộc đó nằm ở ĐÚNG MỘT CHỖ: `materializeInstallmentRequests` (nó tự
//    đọc `Order.installmentApprovalStatus` trong cùng transaction và NÉM LỖI nếu
//    chưa APPROVED). Không rải `if` ở call-site: mỗi câu `if` rải rác là một
//    đường lách — sale bấm "Xuất QR đợt 1" trên đơn chưa duyệt là đã đi vòng qua
//    quy trình duyệt trả góp mà không ai thấy.
//    ⇒ HÀM KHÁC MUỐN TẠO PHIẾU THEO ĐỢT PHẢI GỌI QUA ĐÂY. Không `paymentRequest
//      .create({ installmentNo: n>0 })` ở bất kỳ chỗ nào khác.
//
//  QĐ-2 — Đợt 1 mặc định PENDING. Phiếu thu chỉ PAID khi tiền THẬT về (qua
//    PaymentAllocation) hoặc kế toán xác nhận tay. `OrderInstallment` đợt 1 vẫn
//    PAID như cũ (sổ CŨ — công nợ đang chạy trên đó, KHÔNG đụng vào). Hai sổ
//    chạy song song tới khi cutover; sổ mới (PaymentRequest) theo luật mới.
//
// Bất biến: `status` của phiếu thu là KẾT QUẢ TÍNH từ `PaymentAllocation`
// (`recomputeRequestStatuses`), KHÔNG set tay ở đâu khác. Ngoại lệ duy nhất là
// VOID — "huỷ phiếu, không cần thu nữa" — do chính file này đặt.
// =============================================================================

type TxClient = Prisma.TransactionClient;

/** Actor tối thiểu cho audit (id có thể null khi là system/cron). */
export type PaymentRequestActor = { id: string | null; name: string };

/** `installmentNo = 0` = phiếu "thu toàn đơn" (đơn không trả góp / chưa duyệt). */
export const FULL_ORDER_INSTALLMENT_NO = 0;

/**
 * Định danh đối khớp BỀN theo đời phiếu: `<mã đơn bỏ gạch>D<số đợt>`
 * (vd `ORD-260803-000012` đợt 1 → `ORD260803000012D1`; phiếu toàn đơn → `…D0`).
 *
 * Bền = sale tạo lại QR bao nhiêu lần cũng KHÔNG đổi, nên tiền về luôn rơi đúng
 * phiếu (bất biến #3 trong schema). Vì vậy nó chỉ được sinh lúc TẠO phiếu; nếu
 * phiếu đã có matchKey (vd cổng cấp VA tĩnh) thì tuyệt đối không ghi đè.
 */
export function paymentMatchKey(orderCode: string, installmentNo: number): string {
  return `${orderCode.replace(/[^A-Za-z0-9]/g, "")}D${installmentNo}`;
}

type OrderRef = {
  id: string;
  code: string;
  totalAmount: number;
  centerId?: string | null;
};

/**
 * Tổng đã phân bổ theo phiếu (0 nếu chưa có đồng nào), TÁCH RIÊNG phần tiền thật rót
 * vào và phần được THA theo dung sai làm tròn.
 *
 * ⚠️ 13/09/2026 (DS-01) — trước đây hàm này chỉ `_sum: { amount: true }`, bỏ qua
 * `roundingWaived`. `recomputeRequestStatuses` lại truyền thẳng hằng `0` vào `deriveStatus`
 * ⇒ một phiếu đã PAID nhờ dung sai bị TÍNH LẠI thành PARTIAL. Hai đường tính trạng thái
 * không đồng ý với nhau: `payos-ingest.ts:968-973` CÓ cộng `roundingWaived`, chỗ này KHÔNG.
 *
 * Hệ quả tiền: `outstandingOf` trả lại đúng khoản đã tha ⇒ hệ thống đòi tiếp tiền đã tha,
 * và `isOrderSettled` không bao giờ true ⇒ đơn KHÔNG CHỐT ĐƯỢC. Và vì
 * `recomputeRequestStatuses` chạy ngay trong `materializeInstallmentRequests`, lỗi nổ ở
 * đúng cú bấm "Lưu kế hoạch" / "Duyệt kế hoạch" kế tiếp.
 *
 * Chú thích ở `payos-ingest.ts:947-952` tuyên bố hành vi này ĐÃ được tránh — mã nguồn
 * nói ngược. Luật A1: mã nguồn thắng chú thích.
 */
async function allocatedByRequest(
  tx: TxClient,
  requestIds: string[],
): Promise<Map<string, { allocated: number; waived: number }>> {
  if (requestIds.length === 0) return new Map();
  const sums = await tx.paymentAllocation.groupBy({
    by: ["paymentRequestId"],
    where: { paymentRequestId: { in: requestIds } },
    _sum: { amount: true, roundingWaived: true },
  });
  return new Map(
    sums.map((s) => [
      s.paymentRequestId,
      { allocated: s._sum.amount ?? 0, waived: s._sum.roundingWaived ?? 0 },
    ]),
  );
}

/** Trính đọc gọn cho map trên — phiếu chưa có dòng nào thì cả hai số là 0. */
function soCuaPhieu(
  m: Map<string, { allocated: number; waived: number }>,
  id: string,
): { allocated: number; waived: number } {
  return m.get(id) ?? { allocated: 0, waived: 0 };
}

/**
 * Hết hạn mọi phiên QR ĐANG SỐNG của một phiếu thu.
 *
 * Vì sao cần: `QrSession.amountShown` là ẢNH CHỤP số tiền lúc xuất mã. Sửa kế hoạch
 * (đổi số tiền đợt / đổi hạn / huỷ phiếu) mà không đụng tới phiên cũ thì mã đang
 * dán ở quầy vẫn in số CŨ — khách quét, tiền về sai số, và phiếu thu không bao giờ
 * đủ. Hết hạn phiên để lượt "Xuất QR" kế tiếp dựng mã theo số mới.
 *
 * KHÔNG đụng `matchKey` của phiếu (bất biến #3): tiền của mã cũ nếu đã chuyển vẫn
 * rơi đúng đợt đó, chỉ là số tiền lệch và sẽ nằm ở PARTIAL — đúng cách xử lý.
 */
async function expireQrSessions(tx: TxClient, paymentRequestId: string): Promise<number> {
  const res = await tx.qrSession.updateMany({
    where: { paymentRequestId, status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });
  return res.count;
}

/**
 * Đảm bảo đơn có ĐÚNG MỘT phiếu "thu toàn đơn" (`installmentNo = 0`).
 * Gọi khi: tạo đơn, hoặc lập/sửa kế hoạch trả góp CHƯA duyệt — để sale vẫn xuất
 * được QR số tiền TỔNG ĐƠN trong lúc chờ duyệt.
 *
 * Idempotent. KHÔNG làm gì (trả null) khi:
 *  - đơn 0đ (không có gì để thu), hoặc
 *  - đơn ĐÃ có phiếu theo đợt còn sống → đơn đã chuyển sang thu theo đợt, hồi
 *    sinh phiếu toàn đơn ở đây là cộng đôi số phải thu.
 */
export async function ensureFullOrderRequest(
  tx: TxClient,
  order: OrderRef,
): Promise<string | null> {
  if (order.totalAmount <= 0) return null;

  const rows = await tx.paymentRequest.findMany({
    where: { orderId: order.id },
    select: {
      id: true,
      installmentNo: true,
      amountDue: true,
      status: true,
      matchKey: true,
      centerId: true,
    },
  });

  // Đã thu theo đợt (còn phiếu đợt chưa VOID) → phiếu toàn đơn phải nằm im (VOID).
  if (rows.some((r) => r.installmentNo > 0 && r.status !== "VOID")) return null;

  const full = rows.find((r) => r.installmentNo === FULL_ORDER_INSTALLMENT_NO);
  if (!full) {
    const created = await tx.paymentRequest.create({
      data: {
        orderId: order.id,
        centerId: order.centerId ?? null,
        installmentNo: FULL_ORDER_INSTALLMENT_NO,
        amountDue: order.totalAmount,
        sortOrder: FULL_ORDER_INSTALLMENT_NO,
        status: "PENDING",
        matchKey: paymentMatchKey(order.code, FULL_ORDER_INSTALLMENT_NO),
      },
      select: { id: true },
    });
    return created.id;
  }

  const patch: Prisma.PaymentRequestUncheckedUpdateInput = {};
  // Kế hoạch trả góp bị từ chối → phiếu toàn đơn sống lại.
  if (full.status === "VOID") patch.status = "PENDING";
  // Chỉ đồng bộ số tiền khi phiếu CHƯA có đồng nào rơi vào (PENDING/VOID);
  // PARTIAL/PAID nghĩa là tiền thật đã bám vào con số cũ — sửa là lệch sổ.
  if (
    (full.status === "VOID" || full.status === "PENDING") &&
    full.amountDue !== order.totalAmount
  ) {
    patch.amountDue = order.totalAmount;
  }
  if (full.matchKey == null) {
    patch.matchKey = paymentMatchKey(order.code, FULL_ORDER_INSTALLMENT_NO);
  }
  if (full.centerId == null && order.centerId) patch.centerId = order.centerId;

  if (Object.keys(patch).length > 0) {
    await tx.paymentRequest.update({ where: { id: full.id }, data: patch });
  }
  return full.id;
}

/**
 * QĐ-1 — SINH PHIẾU THU THEO ĐỢT. Gọi TỪ `approveInstallmentPlan` (cùng
 * transaction với việc set APPROVED) và KHÔNG gọi từ đâu khác.
 *
 * Đọc kế hoạch đã duyệt (`OrderInstallment`) → mỗi đợt 1 phiếu
 * (`installmentNo = soDot`, `amountDue = amount`, `sortOrder = soDot`,
 * `status = PENDING` theo QĐ-2 — kể cả khi `OrderInstallment` đợt 1 đang PAID),
 * đồng thời VOID phiếu "thu toàn đơn" (đơn chuyển sang thu theo đợt).
 *
 * Idempotent: gọi lại chỉ đồng bộ số tiền/hạn theo kế hoạch, không nhân đôi.
 *
 * @throws nếu kế hoạch chưa APPROVED — đây là cái CHỐT của quy trình duyệt.
 */
export async function materializeInstallmentRequests(
  tx: TxClient,
  orderId: string,
  actor: PaymentRequestActor,
): Promise<{ created: number; updated: number; voidedFullOrder: boolean }> {
  const noop = { created: 0, updated: 0, voidedFullOrder: false };

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      centerId: true,
      totalAmount: true,
      installmentApprovalStatus: true,
    },
  });
  if (!order) return noop;

  // ⚠️ 03/08/2026 — ĐẢO QĐ-1. Trước đây hàm này CHẶN khi kế hoạch chưa APPROVED
  // ("phiếu đợt chỉ ra đời lúc duyệt"). Chủ dự án chốt lại: bấm "Lưu kế hoạch thanh
  // toán" là phiếu thu + QR theo đợt phải có NGAY, không bắt khách đứng ở quầy chờ
  // quản lý duyệt mới quét được mã. Duyệt nay chỉ còn nghĩa "KHOÁ kế hoạch".
  //
  // An toàn tiền không đổi: phiếu sinh ra ở trạng thái PENDING (chỉ PAID khi tiền
  // thật về), và `confirmSettledOrder` vẫn từ chối tự chốt đơn khi giảm giá chưa
  // duyệt — quét QR không thành đường lách duyệt.

  const plan = await tx.orderInstallment.findMany({
    where: { orderId },
    orderBy: { soDot: "asc" },
    select: { soDot: true, amount: true, dueDate: true },
  });
  const dots = plan.filter((p) => p.soDot > 0);
  if (dots.length === 0) return noop;

  const existing = await tx.paymentRequest.findMany({
    where: { orderId },
    select: {
      id: true,
      installmentNo: true,
      amountDue: true,
      dueDate: true,
      status: true,
      matchKey: true,
      centerId: true,
      sortOrder: true,
    },
  });
  const byNo = new Map(existing.map((r) => [r.installmentNo, r]));
  const allocated = await allocatedByRequest(tx, existing.map((r) => r.id));

  let created = 0;
  let updated = 0;

  for (const dot of dots) {
    const cur = byNo.get(dot.soDot);
    if (!cur) {
      await tx.paymentRequest.create({
        data: {
          orderId,
          centerId: order.centerId,
          installmentNo: dot.soDot,
          amountDue: dot.amount,
          dueDate: dot.dueDate,
          sortOrder: dot.soDot,
          status: "PENDING", // QĐ-2 — chỉ PAID khi tiền thật về.
          matchKey: paymentMatchKey(order.code, dot.soDot),
        },
      });
      created += 1;
      continue;
    }

    const patch: Prisma.PaymentRequestUncheckedUpdateInput = {};
    if (cur.status === "VOID") patch.status = "PENDING"; // duyệt lại sau khi từ chối.

    // ── A6 — `amountDue` của phiếu ĐÃ CÓ TIỀN là BẤT BIẾN ──────────────────────
    // Luật + lý do + số đo ở `doiTienDotDaThu` (plan-money-guard.ts). Cắm Ở ĐÂY chứ
    // không ở `recordInstallmentPlan`: một cổng che CẢ BA đường gọi
    // (`installments.ts:332`, `:500`, `crm/backfill-order.ts:153`) — vá ở đường gọi là
    // vá một cửa rồi để hai cửa mở.
    const aSauA6 = doiTienDotDaThu({
      soDot: dot.soDot,
      tienHienTai: cur.amountDue,
      tienMuonDat: dot.amount,
      daRot: soCuaPhieu(allocated, cur.id).allocated,
    });
    if (aSauA6.chan) {
      throw new InstallmentMoneyBlocked(aSauA6.lyDo ?? "Không sửa được đợt đã thu", aSauA6.soTien ?? 0);
    }
    if (cur.amountDue !== dot.amount) patch.amountDue = dot.amount;
    if ((cur.dueDate?.getTime() ?? null) !== (dot.dueDate?.getTime() ?? null)) {
      patch.dueDate = dot.dueDate;
    }
    if (cur.sortOrder !== dot.soDot) patch.sortOrder = dot.soDot;
    if (cur.matchKey == null) patch.matchKey = paymentMatchKey(order.code, dot.soDot);
    if (cur.centerId == null && order.centerId) patch.centerId = order.centerId;
    if (Object.keys(patch).length > 0) {
      await tx.paymentRequest.update({ where: { id: cur.id }, data: patch });
      updated += 1;
      // Sửa số tiền/hạn của đợt ⇒ mã QR đang sống in số CŨ (số tiền được chụp lại
      // trong QrSession.amountShown). Không hết hạn nó thì sale đưa khách quét mã
      // cũ và tiền về sai số — đúng lỗi chủ dự án báo 03/08 ("sửa 2 đợt nhưng QR
      // không nhảy theo"). Hết hạn phiên cũ để lượt "Xuất QR" sau in số mới.
      if (patch.amountDue !== undefined || patch.dueDate !== undefined) {
        await expireQrSessions(tx, cur.id);
      }
    }
  }

  // Kế hoạch sửa lại còn ít đợt hơn → phiếu dư (chưa dính tiền) phải VOID.
  const planned = new Set(dots.map((d) => d.soDot));
  for (const r of existing) {
    if (r.installmentNo <= 0 || planned.has(r.installmentNo)) continue;
    // Tiền THẬT đã rót mới là lý do giữ phiếu; phần THA không phải tiền nhận được.
    if (r.status === "VOID" || soCuaPhieu(allocated, r.id).allocated > 0) continue;
    await tx.paymentRequest.update({ where: { id: r.id }, data: { status: "VOID" } });
    await expireQrSessions(tx, r.id); // phiếu đã huỷ thì mã của nó không được sống
    updated += 1;
  }

  // Đơn chuyển từ "thu toàn đơn" sang "thu theo đợt" → VOID phiếu toàn đơn.
  const full = byNo.get(FULL_ORDER_INSTALLMENT_NO);
  let voidedFullOrder = false;
  let fullOrderAllocated = 0;
  if (full && full.status !== "VOID") {
    fullOrderAllocated = soCuaPhieu(allocated, full.id).allocated;
    await tx.paymentRequest.update({ where: { id: full.id }, data: { status: "VOID" } });
    await expireQrSessions(tx, full.id); // QR "tổng đơn" không được sống cạnh QR theo đợt
    voidedFullOrder = true;
  }

  await recomputeRequestStatuses(tx, orderId);

  if (created > 0 || updated > 0 || voidedFullOrder) {
    await writeAudit({
      actor,
      module: "finance",
      entityType: "Order",
      entityId: orderId,
      action: "PAYMENT_REQUESTS_MATERIALIZED",
      newValues: {
        created,
        updated,
        voidedFullOrder,
        installments: dots.map((d) => ({ soDot: d.soDot, amount: d.amount })),
        // Cờ bất thường: tiền đã rơi vào phiếu toàn đơn TRƯỚC khi duyệt trả góp
        // (phiếu đó vừa bị VOID) → kế toán phải nhìn lại bằng tay.
        ...(fullOrderAllocated > 0 ? { fullOrderAllocatedBeforeVoid: fullOrderAllocated } : {}),
      },
      orgUnitId: order.centerId,
      tx,
    });
  }

  return { created, updated, voidedFullOrder };
}

/**
 * Kế hoạch trả góp bị TỪ CHỐI sau khi đã lỡ duyệt → VOID phiếu theo đợt và cho
 * phiếu "thu toàn đơn" sống lại.
 *
 * An toàn tiền: phiếu đợt ĐÃ có phân bổ (tiền thật về) KHÔNG bị VOID, và khi đó
 * cũng KHÔNG khôi phục phiếu toàn đơn (làm vậy là đòi khách trả lại từ đầu số
 * tiền họ vừa đóng). Trường hợp đó để kế toán xử lý tay.
 */
export async function revertInstallmentRequests(
  tx: TxClient,
  orderId: string,
  actor: PaymentRequestActor,
): Promise<{ voided: number; fullOrderRestored: boolean }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, code: true, centerId: true, totalAmount: true },
  });
  if (!order) return { voided: 0, fullOrderRestored: false };

  const rows = await tx.paymentRequest.findMany({
    where: { orderId, installmentNo: { gt: 0 } },
    select: { id: true, installmentNo: true, status: true },
  });
  if (rows.length === 0) return { voided: 0, fullOrderRestored: false };

  const allocated = await allocatedByRequest(tx, rows.map((r) => r.id));

  let voided = 0;
  let keptWithMoney = 0;
  for (const r of rows) {
    if (soCuaPhieu(allocated, r.id).allocated > 0) {
      keptWithMoney += 1;
      continue;
    }
    if (r.status === "VOID") continue;
    await tx.paymentRequest.update({ where: { id: r.id }, data: { status: "VOID" } });
    voided += 1;
  }

  const fullOrderRestored =
    keptWithMoney === 0 ? (await ensureFullOrderRequest(tx, order)) != null : false;

  await recomputeRequestStatuses(tx, orderId);

  if (voided > 0 || fullOrderRestored) {
    await writeAudit({
      actor,
      module: "finance",
      entityType: "Order",
      entityId: orderId,
      action: "PAYMENT_REQUESTS_REVERTED",
      newValues: { voided, fullOrderRestored, keptWithMoney },
      orgUnitId: order.centerId,
      tx,
    });
  }

  return { voided, fullOrderRestored };
}

/**
 * TÍNH LẠI `status` mọi phiếu thu của đơn từ sổ `PaymentAllocation` (`deriveStatus`),
 * rồi rollup lên Order khi mọi phiếu còn sống đều PAID (`isOrderSettled`).
 *
 * Đây là NƠI DUY NHẤT đặt PENDING/PARTIAL/PAID. Rollup chỉ đi MỘT CHIỀU
 * (chưa-đủ → đủ): sổ cũ (`OrderInstallment` + `recomputeOrder`) vẫn đang lái
 * trạng thái đơn, hạ cấp ngược ở đây sẽ hai sổ đánh nhau.
 */
export async function recomputeRequestStatuses(
  tx: TxClient,
  orderId: string,
): Promise<{ settled: boolean }> {
  const rows = await tx.paymentRequest.findMany({
    where: { orderId },
    select: { id: true, amountDue: true, status: true },
  });
  if (rows.length === 0) return { settled: false };

  const allocated = await allocatedByRequest(tx, rows.map((r) => r.id));

  const statuses: RequestStatus[] = [];
  for (const r of rows) {
    // DS-01 — truyền WAIVED THẬT, không phải hằng 0. Xem `allocatedByRequest`.
    const so = soCuaPhieu(allocated, r.id);
    const next = deriveStatus(r.amountDue, so.allocated, so.waived, r.status);
    statuses.push(next);
    if (next !== r.status) {
      await tx.paymentRequest.update({ where: { id: r.id }, data: { status: next } });
    }
  }

  const settled = isOrderSettled(statuses);
  if (!settled) return { settled: false };

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { status: true, paidAt: true },
  });
  if (!order) return { settled };

  const canConfirm = order.status === "PENDING_PAYMENT" || order.status === "DRAFT";
  const patch: Prisma.OrderUncheckedUpdateInput = {};
  if (canConfirm) patch.status = "CONFIRMED";
  if (order.paidAt == null && (canConfirm || order.status === "CONFIRMED")) {
    patch.paidAt = new Date();
  }
  if (Object.keys(patch).length > 0) {
    await tx.order.update({ where: { id: orderId }, data: patch });
  }
  return { settled };
}

export type PaymentRequestView = {
  id: string;
  /**
   * Phiếu này thu cho DÒNG nào. `null` = phiếu CẤP ĐƠN (luồng cũ / "thu toàn đơn").
   *
   * ⚠️ Thêm 24/09/2026 cho bảng "chia đợt theo con". Cần thật, không phải cho đủ bộ: bảng
   * đó chia học phí các con vào các đợt CẤP ĐƠN, nên nó phải LỌC ĐƯỢC đúng tập ấy. Suy
   * bằng "hôm nay đơn không thể có cả hai loại đợt" thì đúng — nhưng đúng vì một CỔNG
   * (`kiemTaoDot` vế ĐƠN), và một ngày nào đó cổng ấy đổi thì chỗ này sai im lặng.
   */
  orderItemId: string | null;
  installmentNo: number;
  amountDue: number;
  allocated: number;
  outstanding: number;
  dueDate: Date | null;
  matchKey: string | null;
  status: RequestStatus;
  sortOrder: number;
  centerId: string | null;
};

/**
 * Phiếu thu của đơn kèm tổng đã phân bổ + còn thiếu — dùng chung cho UI (bảng
 * "Xuất QR") và webhook (dựng `AllocTarget` cho `planAllocation`). Sắp theo
 * `sortOrder` = đúng thứ tự rót waterfall.
 */
export async function getOrderPaymentRequests(orderId: string): Promise<PaymentRequestView[]> {
  const rows = await db.paymentRequest.findMany({
    where: { orderId },
    orderBy: [{ sortOrder: "asc" }, { installmentNo: "asc" }],
    select: {
      id: true,
      orderItemId: true,
      installmentNo: true,
      amountDue: true,
      dueDate: true,
      matchKey: true,
      status: true,
      sortOrder: true,
      centerId: true,
    },
  });
  if (rows.length === 0) return [];

  const sums = await db.paymentAllocation.groupBy({
    by: ["paymentRequestId"],
    where: { paymentRequestId: { in: rows.map((r) => r.id) } },
    _sum: { amount: true, roundingWaived: true },
  });
  // DS-01 (đường ĐỌC) — phần đã THA phải trừ vào "còn thiếu", nếu không thì màn
  // phiếu thu hiện "còn thiếu 4.000đ" trên một phiếu đang PAID — mâu thuẫn ngay trên
  // cùng một dòng. Giữ `allocated` là tiền THẬT (để hiển thị đúng số đã thu), chỉ cộng
  // phần tha khi tính còn-thiếu.
  const allocated = new Map(
    sums.map((s) => [
      s.paymentRequestId,
      { allocated: s._sum.amount ?? 0, waived: s._sum.roundingWaived ?? 0 },
    ]),
  );

  return rows.map((r) => {
    const so = soCuaPhieu(allocated, r.id);
    const alloc = so.allocated;
    return {
      ...r,
      allocated: alloc,
      outstanding: outstandingOf({
        id: r.id,
        amountDue: r.amountDue,
        allocated: alloc + so.waived,
        sortOrder: r.sortOrder,
        status: r.status,
      }),
    };
  });
}
