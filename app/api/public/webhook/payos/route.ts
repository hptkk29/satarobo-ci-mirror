import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature, type PayosWebhookBody } from "@/lib/payments/payos";
import {
  ingestPayosWebhook,
  logPayos,
  type PayosWebhookData,
} from "@/lib/payments/payos-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// 03/08 — Webhook payOS: TIỀN VỀ → GHI SỔ → PHÂN BỔ theo phiếu thu.
//
// File này CỐ Ý chỉ là VỎ: verify chữ ký → gọi `ingestPayosWebhook`. Toàn bộ thân
// xử lý nằm ở `lib/payments/payos-ingest.ts` để test được ở tầng service (không
// phải dựng HTTP) — xem tests/e2e/r7/payos-webhook.spec.ts.
//
// CẤU HÌNH: PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY / PAYOS_LIVE.
// Thiếu checksum key → chế độ MÔ PHỎNG (chỉ nhận payload không chữ ký hoặc chữ ký
// `SIMULATED-…`), dùng cho nghiệm thu khi chưa có credential thật.
//
// Webhook SePay (app/api/public/webhook/sepay) GIỮ NGUYÊN làm đường dự phòng.
// =============================================================================

export async function POST(req: NextRequest) {
  let body: PayosWebhookBody;
  try {
    body = (await req.json()) as PayosWebhookBody;
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON" }, { status: 400 });
  }

  // Bước 1 — chữ ký sai thì DỪNG, và có ghi log (khác SePay: ở đây chữ ký nằm
  // trong body chứ không phải header nên payload đã là dữ liệu do cổng ký, log
  // được mà không sợ lộ secret).
  const verified = verifyWebhookSignature(body);
  if (!verified.ok) {
    await logPayos({
      action: "VERIFY_SIGNATURE",
      status: "FAILED",
      payload: { code: body?.code, desc: body?.desc, orderCode: body?.data?.orderCode },
      error: verified.reason,
    });
    return NextResponse.json({ success: false, message: verified.reason }, { status: 401 });
  }

  const result = await ingestPayosWebhook((body.data ?? {}) as PayosWebhookData);

  if (result.status === "ERROR") {
    // Lỗi hệ thống thật → 500 để payOS retry (retry an toàn: idempotent theo
    // providerTxnId, giao dịch đã ghi sẽ đi vào nhánh DUPLICATE).
    return NextResponse.json(
      { success: false, handled: false, reason: result.reason },
      { status: 500 },
    );
  }

  // Mọi trường hợp còn lại trả 200 — UNMATCHED không phải lỗi hệ thống mà là việc
  // của người đối soát; trả non-2xx chỉ khiến cổng retry vô ích.
  return NextResponse.json({
    success: true,
    handled: result.status === "MATCHED",
    status: result.status,
    ...(result.status === "MATCHED"
      ? {
          orderId: result.orderId,
          allocated: result.allocated,
          credit: result.credit,
          settled: result.settled,
        }
      : {}),
    ...("reason" in result ? { reason: result.reason } : {}),
  });
}
