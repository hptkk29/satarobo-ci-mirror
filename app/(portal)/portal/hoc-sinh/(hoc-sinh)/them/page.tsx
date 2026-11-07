import { requireActiveStudent } from "@/lib/portal/session";
import { docHvThem } from "@/lib/portal/hv-du-lieu";
import { tenGoi } from "@/lib/portal/hv-dieu-huong";
import { HvThemTrang } from "@/components/portal/hv-them";

export const dynamic = "force-dynamic";
export const metadata = { title: "Thêm | Cổng học sinh Sata Robo", robots: { index: false } };

export default async function HvThemRoute() {
  const { ctx, studentId } = await requireActiveStudent({ choHocSinh: true });
  const ten = ctx.activeStudent?.name ?? "bạn";
  const d = await docHvThem(studentId);
  return <HvThemTrang ten={tenGoi(ten)} khoa={d.khoa} coin={d.vo.coin} danhGia={d.vo.danhGia} tinMoi={d.vo.tinMoi} />;
}
