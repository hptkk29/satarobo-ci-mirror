// app/(public)/r/[token]/route.ts — LINK NGẮN CỦA LINK / QR GIỚI THIỆU: `<gốc công khai>/r/<TOKEN>` (AFF-P1, docs/source-commission/12 §2.3).
//
// Route MỎNG: đọc header/cookie → `xuLyBamLink` (lõi ở `lib/affiliate/theo-doi-cong-khai.ts`, nơi giữ MỌI luật) → dựng Response 302. Điểm đến CHỈ lấy từ kết quả của lõi (dữ liệu DB) — không
// từ query, Referer, Host hay header nào của request (chống open-redirect).
//
//  · Cờ `affiliate.enabled` ∧ `nguon.enabled` TẮT ⇒ KHÔNG theo dõi (không ghi lượt bấm, không cookie) nhưng KHÔNG 404: chuyển tới trang đích sạch / trang chủ để khách đang bấm QR đã in không bị mất (R5).
//  · `Cache-Control: no-store`: một 302 kèm `Set-Cookie` mà bị CDN/trình duyệt cache sẽ phát cookie của người này cho người khác và làm lượt bấm không được đếm.
//  · Cookie giới thiệu `sr_aff`: first-party, HttpOnly, SameSite=Lax, Secure ở production, Path=/, Max-Age = `cookieWindowDays` CỦA CAMPAIGN (lõi tính). Cookie mã phiên ẩn danh `sr_aff_s` cùng thuộc tính.
//  · `proxy.ts` / `decideRoute()` để `/r/*` đi qua trên host công khai không cần đăng nhập (ghim ở `route.test.ts`).
import { NextResponse, type NextRequest } from "next/server";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { COOKIE_GIOI_THIEU, COOKIE_PHIEN, docCoTheoDoi, phuThuocThat, xuLyBamLink, xuLyBamLinkKhiTat, type CookieDat } from "@/lib/affiliate/theo-doi-cong-khai";

export const dynamic = "force-dynamic";

const KHONG_LUU = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" } as const;

function datCookie(res: NextResponse, ten: string, c: CookieDat): void {
  res.cookies.set(ten, c.giaTri, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: c.maxAgeGiay,
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await ctx.params;

  // Cờ TẮT: không theo dõi gì, nhưng KHÔNG làm mất khách đang bấm một QR/link đã in — chuyển tới trang đích sạch (hoặc trang chủ). Không ghi lượt bấm, không cookie.
  if (!(await docCoTheoDoi())) {
    const tat = await xuLyBamLinkKhiTat({ tokenTho: token, ip: ipChoRateLimit(req.headers) }, phuThuocThat());
    const r = tat.diemDen.startsWith("/") ? new NextResponse(null, { status: 302, headers: { Location: tat.diemDen } }) : NextResponse.redirect(tat.diemDen, 302);
    for (const [k, v] of Object.entries(KHONG_LUU)) r.headers.set(k, v);
    return r;
  }

  const query: Record<string, string> = {};
  for (const [k, v] of req.nextUrl.searchParams) if (!(k in query)) query[k] = v;

  const kq = await xuLyBamLink(
    {
      tokenTho: token,
      ip: ipChoRateLimit(req.headers),
      query,
      cookiePhien: req.cookies.get(COOKIE_PHIEN)?.value ?? null,
      referer: req.headers.get("referer"),
    },
    phuThuocThat(),
  );

  // Điểm đến thường là URL tuyệt đối (website của link, hoặc trang chủ theo gốc đã cấu hình). Chưa cấu hình gốc ⇒ trang chủ dự phòng là `/` TƯƠNG ĐỐI: `NextResponse.redirect` đòi URL tuyệt đối
  // nên dựng 302 thủ công với `Location: /` (hợp lệ theo RFC 9110) — không ghép tên miền nào từ Host của request.
  const res = kq.diemDen.startsWith("/") ? new NextResponse(null, { status: 302, headers: { Location: kq.diemDen } }) : NextResponse.redirect(kq.diemDen, 302);
  for (const [k, v] of Object.entries(KHONG_LUU)) res.headers.set(k, v);
  if (kq.cookieGioiThieu) datCookie(res, COOKIE_GIOI_THIEU, kq.cookieGioiThieu);
  if (kq.cookiePhien) datCookie(res, COOKIE_PHIEN, kq.cookiePhien);
  return res;
}
