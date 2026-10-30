import { NextRequest, NextResponse } from "next/server";
import { processLeadWebhook } from "@/lib/lead/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// Zalo OA webhook — Phase T1.4
// POST : nhận form/lead từ Zalo OA → ingestLead.
//
// CẤU HÌNH (xem .env.example):
//   WEBHOOK_ZALO_SECRET — shared secret xác thực POST (header x-webhook-secret
//   hoặc query ?secret=). Cấu hình endpoint ở Zalo OA → Webhook.
// =============================================================================

export async function POST(req: NextRequest) {
  const { httpStatus, body } = await processLeadWebhook("zalo", req);
  return NextResponse.json(body, { status: httpStatus });
}
