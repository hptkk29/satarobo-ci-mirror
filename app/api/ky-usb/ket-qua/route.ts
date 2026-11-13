import { NextResponse } from "next/server";
import { z } from "zod";
import { nhanKetQuaViec } from "@/lib/finance/hoa-don/ky-usb/viec-ky";
import { xacThucYeuCauMay } from "@/lib/finance/hoa-don/ky-usb/xac-thuc-may";

// POST /api/ky-usb/ket-qua — ứng dụng ký báo KẾT QUẢ một việc: XML đã ký, hoặc mã lỗi. Hub/13 §5.
// Chỉ ĐÚNG người đã nhận ký lệnh (cổng ở `hoanTatKyUsb` / `ghiLoiKy`) — lệnh của người khác ⇒ từ chối. Phản hồi không chứa XML hay thông điệp của nhà cung cấp.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KHONG_LUU = { "Cache-Control": "no-store" };
// XML hoá đơn ~10–50 KB; chặn ở 1 MB để một yêu cầu rác không ăn bộ nhớ.
const body = z.union([
  z.object({ lenhId: z.string().min(1).max(64), xmlDaKyBase64: z.string().min(1).max(1_000_000) }),
  z.object({ lenhId: z.string().min(1).max(64), loi: z.string().min(1).max(40) }),
]);

export async function POST(req: Request): Promise<Response> {
  const now = new Date();
  const x = await xacThucYeuCauMay(req, now);
  if (!x.ok) return new NextResponse(null, { status: x.status, headers: KHONG_LUU });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return new NextResponse(null, { status: 400, headers: KHONG_LUU });
  const ten = "Ứng dụng ký (máy đã ghép)";
  const kq = "xmlDaKyBase64" in p.data
    ? await nhanKetQuaViec({ actor: x.actor, ten, lenhId: p.data.lenhId, xmlDaKyBase64: p.data.xmlDaKyBase64, now })
    : await nhanKetQuaViec({ actor: x.actor, ten, lenhId: p.data.lenhId, loi: p.data.loi, now });
  if (!kq.ok) return NextResponse.json({ ok: false, ma: kq.ma, error: kq.error }, { status: 409, headers: KHONG_LUU });
  return NextResponse.json({ ok: true }, { headers: KHONG_LUU });
}
