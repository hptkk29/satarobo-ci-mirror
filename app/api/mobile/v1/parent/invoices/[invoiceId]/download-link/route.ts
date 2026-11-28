import { chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { lienKetTaiHoaDon, lienKetTaiSchema } from "@/lib/mobile-api/dich-vu/hoa-don";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/invoices/:invoiceId/download-link { loai: "pdf"|"xml", cachMo?: "xem"|"tai" } — cấp URL ký 300 giây từ bucket RIÊNG; ghi AuditLog TRƯỚC khi ký. Hoá đơn của người khác / không tồn tại ⇒ 404; kho chưa sẵn sàng ⇒ 503. */
export async function POST(req: Request, ctx: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await ctx.params;
  return chayDaDangNhapCoThan(req, lienKetTaiSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await lienKetTaiHoaDon(nguoi, invoiceId, thanDl)));
}
