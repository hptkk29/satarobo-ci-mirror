import { NextResponse } from "next/server";

import { pdfTheoLienKet } from "@/lib/mobile-api/dich-vu/hoa-don";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/dl/phieu-thu/:token — đổi LIÊN KẾT KÝ (do `POST /parent/receipts/:id/download-link` cấp, ≤ 300 giây) lấy PDF phiếu thu. Không có tiêu đề Authorization (mở bằng trình duyệt hệ thống):
 * chữ ký HMAC + hạn + KIỂM LẠI sở hữu lúc tải. Sai chữ ký / hết hạn / không còn quyền ⇒ cùng 404 (không phân biệt). no-store, không index.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const kq = await pdfTheoLienKet(token);
  if (!kq) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  return new NextResponse(new Uint8Array(kq.pdf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${kq.tenTep.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}
