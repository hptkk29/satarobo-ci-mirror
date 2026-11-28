import { chayBaoCaoDoanhThuOnline } from "@/lib/online-revenue/route-chung";

export const dynamic = "force-dynamic";

/** GET /api/admin/online-revenue/reconcile?tu=…&den=… — tự kiểm: các con số API khớp phép cộng độc lập trên sổ. Quyền `onl:report:view`. */
export async function GET(req: Request) {
  return chayBaoCaoDoanhThuOnline(req, "reconcile");
}
