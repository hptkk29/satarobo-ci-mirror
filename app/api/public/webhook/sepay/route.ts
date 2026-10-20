import { NextRequest, NextResponse } from "next/server";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureOrderPaymentRecorded } from "@/lib/finance/payment";
import { ensureParentAccountForOrder } from "@/lib/parents/provision";
import { sendEmailForTrigger } from "@/lib/email/trigger";
import { computeDueNow } from "@/lib/payments/due-now";
import { ingestPayosWebhook, type IngestOutcome } from "@/lib/payments/payos-ingest";
import { markInstallmentPaid } from "@/lib/orders/installments";
import { notifyOrderByZnsIfNoEmail } from "@/lib/notify/order";
import {
  checkSepayAuth,
  decideSepayAction,
  docTienVao,
  extractOrderCode,
  type SepayWebhookPayload,
} from "@/lib/payments/sepay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// BGĐ 31/07 — Webhook SePay: TIỀN VỀ → TỰ XÁC NHẬN ĐƠN.
//
// Luồng: khách quét QR (nội dung CK đã nhúng MÃ ĐƠN) → SePay đọc biến động số dư
// → POST về đây → khớp đơn theo mã → chuyển PENDING_PAYMENT sang CONFIRMED + ghi
// sổ Payment (cùng đường ensureOrderPaymentRecorded như xác nhận tay, giữ invariant
// marker [auto:order-confirm] — KHÔNG double-count với kế hoạch trả góp).
//
// CẤU HÌNH: env `SEPAY_WEBHOOK_API_KEY` (SePay gửi `Authorization: Apikey <key>`).
// Thiếu env → từ chối tất cả (không mở cửa khi chưa cấu hình).
//
// Không khớp / trả thiếu / giảm giá chưa duyệt → KHÔNG tự xác nhận, ghi
// IntegrationLog(provider "SEPAY") để kế toán đối soát tay.
// =============================================================================

const SYSTEM_ACTOR = { id: null, name: "SePay webhook" };

/**
 * Tóm tắt payload để ghi kèm log TỪ CHỐI. Request chưa xác thực nên nội dung là
 * của người lạ: cắt ngắn từng trường và chỉ giữ đúng mấy trường SePay thật sự
 * gửi — không nuốt nguyên body vào DB.
 */
function peekSepayPayload(raw: string): Record<string, unknown> | null {
  try {
    const obj: unknown = JSON.parse(raw.slice(0, 8_000));
    if (!obj || typeof obj !== "object") return null;
    const src = obj as Record<string, unknown>;
    const str = (k: string, max: number) =>
      typeof src[k] === "string" ? (src[k] as string).slice(0, max) : null;
    const num = (k: string) =>
      typeof src[k] === "number" ? (src[k] as number) : typeof src[k] === "string" ? str(k, 32) : null;
    return {
      id: num("id"),
      gateway: str("gateway", 64),
      transactionDate: str("transactionDate", 32),
      accountNumber: str("accountNumber", 32),
      transferType: str("transferType", 16),
      transferAmount: num("transferAmount"),
      referenceCode: str("referenceCode", 64),
      content: str("content", 400),
    };
  } catch {
    return null;
  }
}

/** Chống ngập log từ máy quét dạo: body không phải payload SePay thì 10 phút mới ghi 1 dòng. */
let lastJunkAuthLogAt = 0;
const JUNK_AUTH_LOG_INTERVAL_MS = 10 * 60_000;

async function logIntegration(params: {
  action: string;
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  payload: unknown;
  error?: string;
}) {
  await db.integrationLog
    .create({
      data: {
        provider: "SEPAY",
        direction: "PULL",
        action: params.action,
        status: params.status,
        requestPayload: (params.payload ?? {}) as Prisma.InputJsonValue,
        errorMessage: params.error ?? null,
      },
    })
    .catch(() => {});
}

export async function POST(req: NextRequest) {
  const auth = checkSepayAuth(req.headers);
  if (!auth.ok) {
    // 12/08 — TRƯỚC ĐÂY nhánh này im lặng tuyệt đối ("không ghi log khi chưa xác
    // thực"). Hậu quả: 19 lần SePay bị chặn, 4 giao dịch thật rơi mất, và không
    // có một dòng nào ở đâu để biết là hỏng — mãi tới khi kế toán tự đối chiếu.
    // Nay vẫn KHÔNG nuốt body của người lạ vào DB, nhưng LUÔN để lại vết đủ để
    // chẩn đoán: hỏng vì thiếu env, vì không có header, hay vì lệch key.
    const raw = await req.text().catch(() => "");
    const peek = peekSepayPayload(raw);
    const looksLikeSepay = peek != null && peek.transferAmount != null;
    const now = Date.now();
    if (looksLikeSepay || now - lastJunkAuthLogAt > JUNK_AUTH_LOG_INTERVAL_MS) {
      if (!looksLikeSepay) lastJunkAuthLogAt = now;
      await logIntegration({
        action: "AUTH_FAILED",
        status: "FAILED",
        payload: peek ?? { note: "body không phải JSON hợp lệ", bytes: raw.length },
        error: `[${auth.code}] ${auth.detail}`,
      });
    }
    // `reason` hiện thẳng ở cột "Response Body" trong nhật ký webhook của SePay —
    // người cấu hình đọc được nguyên nhân mà không cần vào DB. Chỉ trả MÃ, không
    // trả độ dài/so khớp (đó là thông tin cho admin, không cho người lạ).
    return NextResponse.json(
      { success: false, message: "Unauthorized", reason: auth.code },
      { status: 401 },
    );
  }

  let payload: SepayWebhookPayload;
  try {
    payload = (await req.json()) as SepayWebhookPayload;
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON" }, { status: 400 });
  }

  const orderCode = extractOrderCode(payload.content ?? payload.description);
  const order = orderCode
    ? await db.order.findUnique({
        where: { code: orderCode },
        select: {
          id: true,
          code: true,
          status: true,
          totalAmount: true,
          centerId: true,
          leadId: true,
          gatewayTxnId: true,
          discountApprovalStatus: true,
          installmentApprovalStatus: true,
          installments: { select: { soDot: true, amount: true, status: true } },
        },
      })
    : null;

  // Số phải thu NGAY: khách chọn 2 đợt thì là đợt 1, không phải tổng đơn — dùng
  // đúng con số mà QR đã in ra (lib/payments/due-now.ts) để đối khớp.
  const paidAgg = order
    ? await db.payment.aggregate({
        where: { orderId: order.id, ...KHOAN_DA_GHI_NHAN },
        _sum: { amount: true },
      })
    : null;
  const dueNow = order
    ? computeDueNow({
        totalAmount: order.totalAmount,
        paidAmount: paidAgg?._sum.amount ?? 0,
        installments: order.installments,
        installmentApprovalStatus: order.installmentApprovalStatus,
      })
    : null;

  const decision = decideSepayAction({ payload, order, dueNow: dueNow ?? undefined });
  const txnId = payload.id != null ? String(payload.id) : null;

  if (decision.action !== "CONFIRM") {
    // 12/08 — Tiền VÀO mà không tra ra đơn nào thì vẫn phải nằm trong SỔ giao
    // dịch (`BankTransaction` trạng thái UNMATCHED). Đó chính là hàng chờ xử lý
    // tay mà /admin/bien-dong-so-du được dựng ra để hiển thị và đếm ở tab "Cần
    // xử lý". Trước bản vá, nhánh này chỉ ghi IntegrationLog ⇒ tiền chỉ hiện ở
    // mục "nhật ký kỹ thuật" cuối trang, bảng chính vẫn trống trơn.
    // Cả 4 giao dịch thật của phụ huynh 06→08/08 đều rơi vào đúng nhánh này
    // (nội dung CK do khách tự gõ, không có mã đơn).
    // ⚠️ ĐIỀU KIỆN ĐÃ ĐỔI [23/09/2026] — trước là `decision.action === "MANUAL" && !order`.
    //
    // Vế `!order` viết 12/08, khi memo KHÔNG mang mã đơn nên nó gần như luôn đúng; lập luận
    // "ca có đơn đã rõ ràng và do người quyết định" đứng vững lúc ấy. Ngày 14/09 memo đổi sang
    // mang `matchKey` (`ORD…D1`) mà `extractOrderCode` khớp đúng chuỗi đó ⇒ vế `!order` hoá SAI
    // THƯỜNG XUYÊN. Không ai sửa dòng này, nhưng ý nghĩa của nó đã đổi — và ba lớp ca rơi ra
    // ngoài sổ (trả thiếu/cọc · đợt 2 của đơn đã CONFIRMED · đợt theo CON, xem `sepay.ts`).
    //
    // Câu hỏi đúng cho CỬA GHI SỔ là câu về THỰC TẾ, không về phân loại của ta: **có tiền thật
    // vào tài khoản không**. Có thì phải để lại dấu, bất kể quyết định là gì.
    //
    // ⛔ MỘT CỬA, KHÔNG THÊM CỬA THỨ HAI. Hai chỗ quyết định "giao dịch này có vào sổ không"
    // chính là hình dạng đã đẻ ra lỗ này: dòng cũ nói "giữ nguyên ca có đơn" và không ai đọc
    // lại nó khi memo đổi. Sửa ĐIỀU KIỆN tại chỗ để lần đảo luật sau chỉ phải sửa một nơi.
    //
    // ⛔ VÀ KHÔNG NỚI `decideSepayAction` CHO TRẢ THIẾU THÀNH `CONFIRM`: `CONFIRM` ở route này
    // kéo theo `order.updateMany({ status: "CONFIRMED" })` (:~285) chạy bất kể đợt mấy, rồi gửi
    // biên nhận + cấp tài khoản PH. Việc cần làm là GHI TIỀN VÀO SỔ, không phải chốt đơn —
    // `ingestPayosWebhook` tách sẵn hai việc đó.
    if (docTienVao(payload).ok) {
      // 20/08 — TRƯỚC BẢN VÁ NÀY kết quả `ingestPayosWebhook` bị VỨT ĐI, rồi
      // nhánh dưới LUÔN ghi MANUAL_REVIEW/FAILED kèm câu "không khớp mã đơn".
      // Từ 20/08 nội dung CK không còn nhúng mã đơn ⇒ `extractOrderCode` luôn
      // null ⇒ MỌI giao dịch thật rơi vào đây ⇒ nhật ký đỏ 100% ngay cả khi sổ
      // mới đã khớp đúng phiếu thu, phân bổ xong, đơn đã CONFIRMED và biên nhận
      // đã gửi. Hai hậu quả: (a) tín hiệu vận hành bão hoà nên lần hỏng THẬT
      // không ai nhận ra — đúng cơ chế đã giấu sự cố 26,8tr suốt 6 ngày; (b) kế
      // toán thấy "cần xử lý tay" có thể ghi Payment tay LẦN HAI cho giao dịch
      // đã tự ghi sổ ⇒ cộng đôi tiền.
      // Nay PHÂN NHÁNH THEO KẾT QUẢ ingest, và lý do ghi log lấy từ chính nó.
      const ingested: IngestOutcome = await ingestPayosWebhook(
        {
          orderCode: payload.referenceCode ?? undefined,
          reference: payload.referenceCode ?? undefined,
          description: payload.content ?? payload.description ?? undefined,
          amount: Number(payload.transferAmount ?? 0),
          transactionDateTime: payload.transactionDate ?? undefined,
          accountNumber: payload.accountNumber ?? undefined,
          virtualAccountNumber: undefined,
          paymentLinkId: txnId ?? undefined,
        },
        "SEPAY",
      ).catch((err: unknown) => {
        console.error("[sepay] ghi sổ giao dịch chưa khớp lỗi:", err);
        // Ingest NÉM lỗi → vẫn là FAILED, nhưng phải mang thông điệp lỗi THẬT
        // xuống nhật ký, đừng thay bằng câu mô tả sai nguyên nhân.
        return {
          status: "ERROR" as const,
          reason: err instanceof Error ? err.message : "Lỗi không rõ khi ghi sổ giao dịch",
        };
      });

      if (ingested.status === "MATCHED" || ingested.status === "DUPLICATE") {
        // Sổ mới tra ra phiếu thu bằng SĐT / tài khoản ảo / số tiền — KHÔNG cần
        // mã đơn trong nội dung CK. Tiền đã vào đúng chỗ ⇒ đây là THÀNH CÔNG.
        // DUPLICATE = SePay retry một giao dịch đã ghi nhận, cũng không phải lỗi.
        await logIntegration({ action: "MATCH_TXN", status: "SUCCESS", payload });
        return NextResponse.json({
          success: true,
          handled: true,
          ledger: "v2",
          match: ingested.status,
        });
      }

      // UNMATCHED / IGNORED / ERROR → vẫn là hàng chờ xử lý tay, nhưng ghi LÝ DO
      // THẬT (`unmatchedNote` do ingest dựng: tra theo gì, vướng ở đâu) thay vì
      // "không khớp mã đơn trong nội dung chuyển khoản" — câu đó nay luôn đúng về
      // chữ nhưng vô nghĩa về nghiệp vụ, không chỉ được cho kế toán làm gì tiếp.
      await logIntegration({
        action: "MANUAL_REVIEW",
        status: "FAILED",
        payload,
        error: ingested.reason,
      });
      // Luôn trả 200 (xem ghi chú bên dưới): SePay coi non-2xx là lỗi và retry mãi.
      return NextResponse.json({ success: true, handled: false, reason: ingested.reason });
    }

    // Tới đây CHỈ còn ca KHÔNG PHẢI TIỀN VÀO (chuyển ra, hoặc số tiền không hợp lệ) — cửa
    // trên đã nuốt mọi ca có tiền thật. Không có gì để ghi sổ, và cũng không có việc gì cho
    // người đối soát ⇒ `SKIPPED`, không phải `FAILED`.
    //
    // ⚠️ Trước bản vá 23/09, nhánh này còn nhận cả ca MANUAL-có-đơn và ghi `MANUAL_REVIEW /
    // FAILED` cho chúng. Đó là nơi tiền thật đi vào rồi biến mất khỏi ba sổ, chỉ để lại một
    // dòng nhật ký kỹ thuật. Nhánh tam phân cũ (`SKIP ? … : "MANUAL_REVIEW"`) nay không còn
    // ca nào rơi vào vế MANUAL, nên giữ nó lại là giữ một nhánh chết trông như đang canh.
    await logIntegration({
      action: "SKIP_TXN",
      status: "SKIPPED",
      payload,
      error: decision.reason,
    });
    // Luôn trả 200: SePay coi non-2xx là lỗi và retry mãi; các case này không
    // phải lỗi hệ thống mà là việc của người đối soát.
    return NextResponse.json({ success: true, handled: false, reason: decision.reason });
  }

  // ── SỔ MỚI trước ────────────────────────────────────────────────────────────
  // payOS còn chờ xác thực doanh nghiệp (TGĐ ký), nên SePay là cổng ĐANG CHẠY
  // THẬT — nó phải nuôi được sổ thu theo đợt, nếu không thì cả cơ chế phiếu thu
  // chỉ là code chết. Dùng CHUNG `ingestPayosWebhook` (đã tham số hoá provider):
  // ghi BankTransaction, phân bổ waterfall, ghi song song sổ cũ, side-effect sau
  // commit — một đường duy nhất cho cả hai cổng.
  //
  // Không khớp được phiếu thu nào (đơn cũ chưa backfill) → LÙI về đường ghi sổ cũ
  // bên dưới, giữ nguyên hành vi đang chạy. Đây là cầu chuyển tiếp, không phải
  // nhánh chết: sau khi chạy backfill thì mọi đơn đều có phiếu thu.
  const viaLedger = await ingestPayosWebhook(
    {
      orderCode: payload.referenceCode ?? undefined,
      reference: payload.referenceCode ?? undefined,
      description: payload.content ?? payload.description ?? undefined,
      amount: decision.amount,
      transactionDateTime: payload.transactionDate ?? undefined,
      accountNumber: payload.accountNumber ?? undefined,
      virtualAccountNumber: undefined,
      paymentLinkId: txnId ?? undefined,
    },
    "SEPAY",
  ).catch((err) => {
    console.error("[sepay] ingest sổ mới lỗi, lùi về sổ cũ:", err);
    return null;
  });

  if (viaLedger && (viaLedger.status === "MATCHED" || viaLedger.status === "DUPLICATE")) {
    await logIntegration({ action: "CONFIRM_ORDER", status: "SUCCESS", payload });
    return NextResponse.json({ success: true, handled: true, orderCode, ledger: "v2" });
  }

  try {
    await db.$transaction(async (tx) => {
      // Chốt chặn race: chỉ cập nhật khi đơn CÒN ở PENDING_PAYMENT (2 webhook
      // song song → chỉ 1 cái đổi được trạng thái).
      const upd = await tx.order.updateMany({
        where: { id: decision.orderId, status: "PENDING_PAYMENT" },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          paidAt: new Date(),
          bankReference: payload.referenceCode ?? null,
          gatewayTxnId: txnId,
        },
      });
      if (upd.count === 0) throw new Error("ORDER_ALREADY_HANDLED");

      await tx.orderStatusHistory.create({
        data: {
          orderId: decision.orderId,
          fromStatus: "PENDING_PAYMENT",
          toStatus: "CONFIRMED",
          changedByUserId: null,
          changedByName: "SePay webhook",
          reason: `Tự động xác nhận: tiền về ${decision.amount.toLocaleString("vi-VN")}đ${
            payload.referenceCode ? ` (ref ${payload.referenceCode})` : ""
          }`,
        },
      });

      // Ghi sổ kế toán y như đường xác nhận tay (idempotent theo marker).
      // ⚠️ Khách đóng theo ĐỢT: khoản phải ghi đúng số đợt vừa thu với marker
      // [auto:order-installment:dotN] — ghi bằng tổng đơn qua đường
      // [auto:order-confirm] là phá bất biến "2 nguồn auto-Payment loại trừ nhau"
      // (đợt 2 sau đó sẽ cộng chồng lên). Đợt do markInstallmentPaid lo, ngoài tx.
      if (decision.soDot == null) {
        const recorded = await tx.payment.aggregate({
          where: { orderId: decision.orderId, ...KHOAN_DA_GHI_NHAN },
          _count: { _all: true },
        });
        if (recorded._count._all === 0) {
          await ensureOrderPaymentRecorded(tx, {
            orderId: decision.orderId,
            amount: decision.amount,
            leadId: order!.leadId,
            centerId: order!.centerId,
            actor: SYSTEM_ACTOR,
          });
        }
      }
    });

    // Đóng theo đợt → đánh dấu đợt vừa thu là PAID (hàm này tự ghi Payment với
    // marker theo soDot + tôn trọng trạng thái duyệt kế hoạch). Ngoài transaction
    // trên vì nó tự mở transaction riêng.
    if (decision.soDot != null) {
      const inst = order!.installments.find((i) => i.soDot === decision.soDot);
      const instRow = inst
        ? await db.orderInstallment.findFirst({
            where: { orderId: decision.orderId, soDot: decision.soDot },
            select: { id: true },
          })
        : null;
      if (instRow) {
        const res = await markInstallmentPaid(instRow.id, null, decision.orderId);
        if (!res.ok) console.error("[sepay] markInstallmentPaid:", res.error);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    const alreadyHandled = message === "ORDER_ALREADY_HANDLED";
    await logIntegration({
      action: alreadyHandled ? "SKIP_TXN" : "CONFIRM_ORDER",
      status: alreadyHandled ? "SKIPPED" : "FAILED",
      payload,
      error: alreadyHandled ? "Đơn đã được xử lý bởi luồng khác" : message,
    });
    // Lỗi thật → 500 để SePay retry; đã xử lý rồi → 200.
    return NextResponse.json(
      { success: alreadyHandled, handled: false, reason: message },
      { status: alreadyHandled ? 200 : 500 },
    );
  }

  // BGĐ 31/07 — tiền về + đơn xác nhận → cấp tài khoản phụ huynh theo SĐT + ZNS.
  // Await (không fire-and-forget) vì serverless có thể kết thúc process sau response.
  await ensureParentAccountForOrder(decision.orderId).catch((err) =>
    console.error("[sepay] provision parent:", err),
  );

  // BIÊN NHẬN — mirror đúng đường xác nhận TAY (`changeOrderStatusAction`): email
  // PAYMENT_RECEIPT cho khách có email, ZNS học phí cho khách chỉ có SĐT.
  // Trước bản vá này webhook chỉ cấp tài khoản rồi im — khách chuyển khoản tự động
  // không nhận được bất kỳ xác nhận nào, trong khi khách thu tay thì có.
  // Await từng bước: trên serverless, promise chưa xong lúc trả response có thể bị
  // cắt giữa chừng (đúng lý do dòng provision ở trên cũng await).
  await sendOrderReceipt(decision.orderId);

  await logIntegration({ action: "CONFIRM_ORDER", status: "SUCCESS", payload });
  return NextResponse.json({ success: true, handled: true, orderCode });
}

/**
 * Gửi biên nhận cho đơn vừa xác nhận. Best-effort: mọi lỗi chỉ log — tiền đã ghi
 * sổ xong, không được để khâu thông báo làm webhook trả 500 rồi SePay retry và
 * đẩy đơn qua nhánh ORDER_ALREADY_HANDLED.
 */
async function sendOrderReceipt(orderId: string): Promise<void> {
  const order = await db.order
    .findUnique({
      where: { id: orderId },
      select: {
        id: true,
        code: true,
        customerEmail: true,
        customerName: true,
        totalAmount: true,
        paidAt: true,
        paymentMethod: { select: { name: true } },
      },
    })
    .catch(() => null);
  if (!order) return;

  if (order.customerEmail?.trim()) {
    await sendEmailForTrigger({
      trigger: "PAYMENT_RECEIPT",
      recipient: { email: order.customerEmail, name: order.customerName },
      vars: {
        customer_name: order.customerName,
        order_code: order.code,
        total_amount: order.totalAmount,
        payment_method: order.paymentMethod?.name ?? "Chuyển khoản (SePay)",
        paid_at: order.paidAt ?? new Date(),
      },
      context: { type: "Order", id: order.id },
      triggerType: "SYSTEM",
      actor: { userId: null, name: SYSTEM_ACTOR.name },
    }).catch((err) => console.error("[sepay] PAYMENT_RECEIPT email:", err));
  }

  // Khách không có email → ZNS mẫu học phí (helper tự bỏ qua khi có email, nên
  // gọi vô điều kiện vẫn không gửi trùng — nhưng gọi trong nhánh cho rõ ý).
  await notifyOrderByZnsIfNoEmail(order.id).catch((err) =>
    console.error("[sepay] ZNS receipt:", err),
  );
}
