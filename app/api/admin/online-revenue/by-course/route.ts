import { chayBaoCaoDoanhThuOnline } from "@/lib/online-revenue/route-chung";

export const dynamic = "force-dynamic";

/** GET /api/admin/online-revenue/by-course?tu=…&den=…[&khoaId=<id>] — cùng số liệu tách theo KHOÁ (+ nhóm "Học cụ & phí giao"). Quyền `onl:report:view`. */
export async function GET(req: Request) {
  return chayBaoCaoDoanhThuOnline(req, "by-course");
}
