import { NextRequest, NextResponse } from "next/server";
import { processLeadWebhook } from "@/lib/lead/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =============================================================================
// Google Form webhook — Phase T1.4
// POST : nhận submit từ Google Form (qua Apps Script onFormSubmit → UrlFetchApp
//        .fetch POST JSON) → ingestLead.
//
// CẤU HÌNH (xem .env.example):
//   WEBHOOK_GOOGLE_FORM_SECRET — shared secret; Apps Script gửi kèm header
//   x-webhook-secret hoặc query ?secret=.
//
// Apps Script mẫu (Extensions → Apps Script, trigger onFormSubmit):
//   const SECRET = '...';
//   function onFormSubmit(e) {
//     const r = e.namedValues;
//     UrlFetchApp.fetch('https://satarobo.vn/api/public/webhook/google-form?secret=' + SECRET, {
//       method: 'post', contentType: 'application/json',
//       payload: JSON.stringify({
//         parentName: r['Họ tên'][0], phone: r['Số điện thoại'][0],
//         email: (r['Email']||[''])[0], childName: (r['Tên con']||[''])[0],
//         note: (r['Ghi chú']||[''])[0], eventId: e.response ? e.response.getId() : undefined,
//       }),
//     });
//   }
// =============================================================================

export async function POST(req: NextRequest) {
  const { httpStatus, body } = await processLeadWebhook("google-form", req);
  return NextResponse.json(body, { status: httpStatus });
}
