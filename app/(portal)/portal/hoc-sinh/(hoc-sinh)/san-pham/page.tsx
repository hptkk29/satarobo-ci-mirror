import { requireActiveStudent } from "@/lib/portal/session";
import { docHvSanPham } from "@/lib/portal/hv-du-lieu";
import { tenGoi } from "@/lib/portal/hv-dieu-huong";
import { HvSanPhamTrang } from "@/components/portal/hv-san-pham";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sản phẩm & tính cách | Cổng học sinh Sata Robo", robots: { index: false } };

export default async function HvSanPhamRoute() {
  const { ctx, studentId } = await requireActiveStudent({ choHocSinh: true });
  const ten = ctx.activeStudent?.name ?? "bạn";
  const d = await docHvSanPham(studentId, ctx.parentUserId, ten);
  return <HvSanPhamTrang tenHoa={tenGoi(ten)} dongY={d.dongY} sp={d.sp} tong={d.tong} robot={d.robot} />;
}
