import { NextRequest, NextResponse } from "next/server";
import { processLeadWebhook } from "@/lib/lead/webhook";
import { ingestIntakeLead } from "@/lib/lead/intake/ingest";
import {
  mapQuatang,
  quatangClientMeta,
  quatangExternalId,
} from "@/lib/lead/intake/map-quatang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// Webhook quatang.edu.vn — P3.
//
// Chuỗi thật: trang quatang → POST JSON vào Apps Script web-app (`doPost`) →
// script ghi 1 dòng Google Sheet → GỌI TIẾP sang đây.
//
// Bắt ở cuối chuỗi (sau khi sheet đã ghi) là cố ý: sheet vẫn là bản ghi gốc, ta
// chết thì KHÔNG mất lead nào. Xem `docs/lead-intake/PLAN-keo-lead-quatang-sale.md` §3-P3.
//
// Xác thực: header `x-webhook-secret` khớp env `WEBHOOK_QUATANG_SECRET`
// (`SECRET_ENV` trong lib/lead/webhook.ts). Thiếu secret trên production ⇒ 503,
// sai secret ⇒ 401 — đã fail-closed sẵn trong `processLeadWebhook`.
// =============================================================================

export async function POST(req: NextRequest) {
  const { httpStatus, body } = await processLeadWebhook("quatang", req, {
    externalId: quatangExternalId,
    handle: async (payload) => {
      const mapped = mapQuatang(payload);
      if (!mapped.ok) return { ok: false, error: mapped.error };

      // ⚠️ IP/User-Agent phải lấy TỪ PAYLOAD. Request này đến từ máy chủ Google
      // (Apps Script), nên `x-forwarded-for` là IP của Google — dùng nó thì mọi
      // lead quatang đều mang chung một IP và trường này thành vô nghĩa.
      const meta = quatangClientMeta(payload);

      return ingestIntakeLead(mapped.lead, {
        source: "quatang",
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        landingPage: "https://quatang.edu.vn",
        actorName: "Hệ thống (quatang.edu.vn)",
      });
    },
  });

  return NextResponse.json(body, { status: httpStatus });
}
