import { requireActiveStudent } from "@/lib/portal/session";
import { docHvBaiTap } from "@/lib/portal/hv-du-lieu";
import { HvBaiTapTrang } from "@/components/portal/hv-bai-tap";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bài tập & bài thi | Cổng học sinh Sata Robo", robots: { index: false } };

export default async function HvBaiTapRoute() {
  const { studentId } = await requireActiveStudent({ choHocSinh: true });
  const d = await docHvBaiTap(studentId);
  return <HvBaiTapTrang tenKhoa={d.tenKhoa} canLam={d.canLam} daNop={d.daNop} thi={d.thi} />;
}
