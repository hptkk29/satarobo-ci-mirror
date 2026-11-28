import { chayBaoCaoDoanhThuOnline } from "@/lib/online-revenue/route-chung";

export const dynamic = "force-dynamic";

/** GET /api/admin/online-revenue/summary?tu=YYYY-MM-DD&den=YYYY-MM-DD[&nhom=day|week|month&khoaId=<id>] — tiền (thu/hoàn/điều chỉnh/ròng), đơn, quyền học, giảm giá, hoàn, theo kỳ/pháp nhân. Quyền `onl:report:view`. */
export async function GET(req: Request) {
  return chayBaoCaoDoanhThuOnline(req, "summary");
}
