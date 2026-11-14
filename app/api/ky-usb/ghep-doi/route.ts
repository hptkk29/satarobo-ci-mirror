import { NextResponse } from "next/server";
import { z } from "zod";
import { laKyUsbBat } from "@/lib/finance/hoa-don/feature";
import { doiMaGhepLayToken } from "@/lib/finance/hoa-don/ky-usb/may-ky";
import { rateLimit } from "@/lib/rate-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";

// POST /api/ky-usb/ghep-doi — ứng dụng ký đổi MÃ GHÉP (do kế toán sinh trên màn) lấy TOKEN MÁY. Hub/13 §5.
// Không có phiên đăng nhập (ứng dụng chưa có gì): bảo vệ bằng mã dùng MỘT lần 10 phút + chặn tần suất theo IP. Mọi thất bại trả CÙNG một phản hồi 400.
// ⚠️ Token chỉ nằm trong phản hồi THÀNH CÔNG này, đúng một lần; `Cache-Control: no-store`. Không log body.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KHONG_LUU = { "Cache-Control": "no-store" };
const body = z.object({ ma: z.string().min(1).max(32) });

export async function POST(req: Request): Promise<Response> {
  if (!(await laKyUsbBat())) return new NextResponse(null, { status: 404, headers: KHONG_LUU });
  const gioiHan = await rateLimit({ key: `ky-usb-ghep:${ipChoRateLimit(req.headers)}`, max: 10, windowMs: 10 * 60 * 1000 });
  if (!gioiHan.success) return new NextResponse(null, { status: 429, headers: KHONG_LUU });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return new NextResponse(null, { status: 400, headers: KHONG_LUU });
  const kq = await doiMaGhepLayToken({ ma: p.data.ma, now: new Date() });
  if (!kq.ok) return new NextResponse(null, { status: 400, headers: KHONG_LUU });
  return NextResponse.json({ token: kq.token, hetHan: kq.hetHan.toISOString() }, { headers: KHONG_LUU });
}
