import { NextResponse } from "next/server";
import { layViecKeTiep } from "@/lib/finance/hoa-don/ky-usb/viec-ky";
import { xacThucYeuCauMay } from "@/lib/finance/hoa-don/ky-usb/xac-thuc-may";

// GET /api/ky-usb/viec — ứng dụng ký lấy VIỆC KÝ kế tiếp của người đã ghép máy (lệnh USB đã DANG_KY do chính họ nhận ký). Hub/13 §5.
// Phiên 30 phút của VIN được mở LÚC NÀY (không phải lúc kế toán bấm «Ký»). `viec: null` = hết việc. Auth: Bearer token máy (xem xac-thuc-may.ts).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KHONG_LUU = { "Cache-Control": "no-store" };

export async function GET(req: Request): Promise<Response> {
  const now = new Date();
  const x = await xacThucYeuCauMay(req, now);
  if (!x.ok) return new NextResponse(null, { status: x.status, headers: KHONG_LUU });
  const kq = await layViecKeTiep({ actor: x.actor, now });
  if (!kq.ok) return NextResponse.json({ error: kq.error }, { status: 409, headers: KHONG_LUU });
  return NextResponse.json({ viec: kq.viec, conLai: kq.conLai, boQua: kq.boQua }, { headers: KHONG_LUU });
}
