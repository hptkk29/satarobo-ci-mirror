import { NextResponse } from "next/server";

import { chayDaDangNhap } from "@/lib/mobile-api/cong";
import { phieuThuPdf } from "@/lib/mobile-api/dich-vu/hoa-don";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/v1/parent/receipts/:paymentId/pdf — phiếu thu PDF của khoản ĐÃ ĐÓNG cho con mình (application/pdf, no-store). Của người khác / không tồn tại / sai nhóm chứng từ ⇒ 404; chế độ học sinh ⇒ 403. */
export async function GET(req: Request, ctx: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await ctx.params;
  return chayDaDangNhap(req, async (nguoi) => {
    const kq = await phieuThuPdf(nguoi, paymentId);
    return new NextResponse(new Uint8Array(kq.pdf), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${kq.tenTep.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "Cache-Control": "private, no-store" },
    });
  });
}
