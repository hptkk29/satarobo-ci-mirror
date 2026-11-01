import { NextRequest, NextResponse } from "next/server";
import { processLeadWebhook } from "@/lib/lead/webhook";
import { safeEqual } from "@/lib/security/safe-equal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// Facebook Lead Ads webhook — Phase T1.4
// GET  : xác minh subscription (hub.challenge) khi đăng ký webhook trên Meta.
// POST : nhận leadgen payload → ingestLead.
//
// CẤU HÌNH (xem .env.example):
//   WEBHOOK_FACEBOOK_VERIFY_TOKEN — token tùy đặt, nhập vào Meta App Dashboard.
//   WEBHOOK_FACEBOOK_SECRET       — shared secret xác thực POST (header x-webhook-secret).
// Lấy ở: developers.facebook.com → App → Webhooks → Leadgen.
// =============================================================================

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WEBHOOK_FACEBOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token && safeEqual(token, expected) && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const { httpStatus, body } = await processLeadWebhook("facebook", req);
  return NextResponse.json(body, { status: httpStatus });
}
