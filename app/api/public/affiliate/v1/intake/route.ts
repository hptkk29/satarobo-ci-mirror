// app/api/public/affiliate/v1/intake/route.ts — NHẬN BIỂU MẪU GIỚI THIỆU từ website đối tác (AFF-P1, docs/source-commission/12 §2.4–§2.6; đặc tả §22–§30).
//
// Body JSON `{ token, idempotencyKey, phone, parentName?, email?, children?, centerCode?, note?, consentMarketing?, clickId?, utm?, hp? }` — KHÔNG có id đối tác/nguồn/tỉ lệ (lược đồ `.strict()` từ chối).
//
//  · Gửi bằng `fetch(url, { method: "POST", body: JSON.stringify(x), headers: { "Content-Type": "text/plain" } })` — một «yêu cầu đơn giản» KHÔNG cần preflight. Preflight (OPTIONS) không có thân nên
//    không biết link thuộc website nào ⇒ không thể xác định origin nào được phép; lõi đọc thân bất kể Content-Type. Cùng quy ước với `/v1/click`.
//  · Phản hồi chỉ khác nhau ở HEADER: `Access-Control-Allow-Origin` phản chiếu CHỈ khi origin nằm trong `allowedDomains` của website của link (không bao giờ `*`), kèm `Vary: Origin`.
//    Thân luôn cùng một câu cho mọi nhánh referral (không lộ token đúng/sai).
//  · Cờ tắt ⇒ KHÔNG 404: vẫn lưu khách như lead thường (không referral/attribution/hoa hồng) — chốt R5 13/10/2026. Lõi + luật: `lib/affiliate/intake-cong-khai.ts`.
import { NextResponse, type NextRequest } from "next/server";
import { docCoTheoDoi } from "@/lib/affiliate/theo-doi-cong-khai";
import { phuThuocIntakeThat, xuLyIntakeGioiThieu, xuLyIntakeKhiTatTheoDoi } from "@/lib/affiliate/intake-cong-khai";
import { ipChoRateLimit } from "@/lib/security/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CO_BAN = { "Cache-Control": "no-store, max-age=0", Vary: "Origin" } as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Cờ TẮT ⇒ KHÔNG 404 (R5): khách điền biểu mẫu trên website đối tác vẫn được lưu như lead thường — không referral, không attribution, không hoa hồng.
  const dangTheoDoi = await docCoTheoDoi();

  const than = await req.text().catch(() => "");
  const xuLy = dangTheoDoi ? xuLyIntakeGioiThieu : xuLyIntakeKhiTatTheoDoi;
  const kq = await xuLy(
    { thanTho: than, origin: req.headers.get("origin"), ip: ipChoRateLimit(req.headers), userAgent: req.headers.get("user-agent") },
    phuThuocIntakeThat(),
  );
  const res = NextResponse.json(kq.body, { status: kq.status, headers: CO_BAN });
  if (kq.acao) res.headers.set("Access-Control-Allow-Origin", kq.acao);
  return res;
}

/** Preflight: 204 KHÔNG kèm `Access-Control-Allow-Origin` — client dùng `application/json` bị trình duyệt chặn (an toàn); `text/plain` không đi qua preflight. */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CO_BAN });
}
