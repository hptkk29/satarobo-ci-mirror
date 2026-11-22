import { requireActiveStudent } from "@/lib/portal/session";
import { docHvHomNay } from "@/lib/portal/hv-du-lieu";
import { HvHomNayTrang } from "@/components/portal/hv-hom-nay";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hôm nay | Cổng học sinh Sata Robo", robots: { index: false } };

export default async function HvHomNayRoute() {
  const { ctx, studentId } = await requireActiveStudent({ choHocSinh: true });
  const d = await docHvHomNay(studentId, ctx.activeStudent?.name ?? "bạn");
  return <HvHomNayTrang d={d} />;
}
