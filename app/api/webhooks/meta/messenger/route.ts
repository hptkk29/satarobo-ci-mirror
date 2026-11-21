import { NextResponse, type NextRequest } from "next/server";
import { handleMessengerWebhook } from "@/lib/crm/meta-webhook";
import { safeEqual } from "@/lib/security/safe-equal";
import { rateLimit } from "@/lib/rate-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// R1-02 — Webhook Messenger (SR.QD.217).
// GET  : verify subscription (hub.challenge) bằng WEBHOOK_FACEBOOK_VERIFY_TOKEN.
// POST : verify X-Hub-Signature-256 (META_APP_SECRET) → ingest tin nhắn (idempotent mid).
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
  // SEC-M04: rate-limit theo IP + cap body (chống flood tin nhắn giả). fail-soft.
  // IP qua luật dùng chung (28/09/2026) — bản cũ lấy phần tử ĐẦU của XFF, tức phần khách viết.
  const ip = ipChoRateLimit(req.headers);
  const rl = await rateLimit({ key: `webhook:messenger:${ip}`, max: 60, windowMs: 60_000 });
  if (!rl.success) {
    return NextResponse.json({ ok: false, error: "Quá nhiều request" }, { status: 429 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > 100_000) {
    return NextResponse.json({ ok: false, error: "Payload quá lớn" }, { status: 413 });
  }
  const rawBody = await req.text();
  const result = await handleMessengerWebhook({
    rawBody,
    signatureHeader: req.headers.get("x-hub-signature-256"),
    appSecret: process.env.META_APP_SECRET,
  });
  if (result.status === 401) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }
  // Luôn 200 cho payload hợp lệ (Meta không retry bão).
  return NextResponse.json({ ok: true, created: result.created }, { status: result.status });
}
