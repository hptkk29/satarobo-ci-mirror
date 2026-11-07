import { requireActiveStudent } from "@/lib/portal/session";
import { docHvThongBao } from "@/lib/portal/hv-du-lieu";
import { HvThongBaoTrang } from "@/components/portal/hv-thong-bao";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tin mới cho em | Cổng học sinh Sata Robo", robots: { index: false } };

export default async function HvThongBaoRoute() {
  const { studentId } = await requireActiveStudent({ choHocSinh: true });
  const d = await docHvThongBao(studentId);
  return <HvThongBaoTrang tin={d.tin} moc={d.moc} bayGio={Date.now()} boLoc={d.boLoc} />;
}
