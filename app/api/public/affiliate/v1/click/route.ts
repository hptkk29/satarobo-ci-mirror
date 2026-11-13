// app/api/public/affiliate/v1/click/route.ts — BEACON cho link TRỰC TIẾP đặt trên site đối tác (AFF-P1, docs/source-commission/12 §2.6; đặc tả §20).
//
// Trang đối tác mở bằng `?aff=<TOKEN>&cmp=<CODE>` gửi một beacon về đây để SATAROBO ghi lượt bấm. Body `{ v: 1, token, landingUrl, utm? }`.
//
//  · Gửi bằng `navigator.sendBeacon(url, JSON.stringify(body))` — Content-Type mặc định là `text/plain`, một «yêu cầu đơn giản» KHÔNG cần preflight. Vì preflight (OPTIONS) không có thân, nó không
//    biết link thuộc website nào nên không thể xác định origin nào được phép; lõi đọc thân bất kể Content-Type. Client phải gửi `text/plain` (hoặc sendBeacon), không `application/json` có preflight.
//  · LUÔN `204` không thân — không lộ token có tồn tại không, link còn hiệu lực không, URL có được phép không. Chỉ khác nhau ở HEADER: `Access-Control-Allow-Origin` được phản chiếu
//    CHỈ khi origin của request nằm trong `allowedDomains` của website của link (không bao giờ `*`), kèm `Vary: Origin`. Origin chỉ là tín hiệu PHỤ — không xác thực gì.
//  · Cờ tắt ⇒ 404 trống. `landingUrl` chỉ được ghi khi `kiemUrlDuocPhep` đạt trên website của chính link (xem lõi).
import { NextResponse, type NextRequest } from "next/server";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { COOKIE_PHIEN, docCoTheoDoi, phuThuocThat, xuLyBeacon } from "@/lib/affiliate/theo-doi-cong-khai";

export const dynamic = "force-dynamic";

const CO_BAN = { "Cache-Control": "no-store, max-age=0", Vary: "Origin" } as const;

function tra204(acao: string | null): NextResponse {
  const res = new NextResponse(null, { status: 204, headers: CO_BAN });
  if (acao) res.headers.set("Access-Control-Allow-Origin", acao);
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await docCoTheoDoi())) return new NextResponse(null, { status: 404, headers: CO_BAN });
  let than: string;
  try {
    than = await req.text();
  } catch {
    than = "";
  }
  const kq = await xuLyBeacon(
    { thanTho: than, origin: req.headers.get("origin"), ip: ipChoRateLimit(req.headers), cookiePhien: req.cookies.get(COOKIE_PHIEN)?.value ?? null },
    phuThuocThat(),
  );
  return tra204(kq.acao);
}

/** Preflight: 204 KHÔNG kèm `Access-Control-Allow-Origin` — client dùng `application/json` sẽ bị trình duyệt chặn (an toàn); `text/plain` / sendBeacon không đi qua preflight. */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CO_BAN });
}
