import { chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { lienKetPhieuThuSchema, lienKetTaiPhieuThu } from "@/lib/mobile-api/dich-vu/hoa-don";
import { gocCongKhai } from "@/lib/mobile-api/goc-cong-khai";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/receipts/:paymentId/download-link {} — URL tự ký 300 giây để mở phiếu thu bằng trình duyệt hệ thống (audit TRƯỚC khi ký). Của người khác / không có / đơn thuộc nhóm hoá đơn ⇒ 404; chế độ học sinh ⇒ 403. */
export async function POST(req: Request, ctx: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await ctx.params;
  // SEC-10: gốc URL KHÔNG suy từ header `Host` của yêu cầu ở production (xem `goc-cong-khai.ts`); tính SAU cổng xác thực.
  return chayDaDangNhapCoThan(req, lienKetPhieuThuSchema, async (nguoi, _ctx) => traThanhCong(await lienKetTaiPhieuThu(nguoi, paymentId, gocCongKhai(req))));
}
