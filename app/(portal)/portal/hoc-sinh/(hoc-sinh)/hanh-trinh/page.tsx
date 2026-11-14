import { requireActiveStudent } from "@/lib/portal/session";
import { docHvHanhTrinh } from "@/lib/portal/hv-du-lieu";
import { tenGoi } from "@/lib/portal/hv-dieu-huong";
import { HvHanhTrinhTrang } from "@/components/portal/hv-hanh-trinh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hành trình & huy hiệu | Cổng học sinh Sata Robo", robots: { index: false } };

export default async function HvHanhTrinhRoute() {
  const { ctx, studentId } = await requireActiveStudent({ choHocSinh: true });
  const d = await docHvHanhTrinh(studentId, tenGoi(ctx.activeStudent?.name ?? "bạn"));
  return <HvHanhTrinhTrang d={d} />;
}
