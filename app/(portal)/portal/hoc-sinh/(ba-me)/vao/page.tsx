import { requireActiveStudent } from "@/lib/portal/session";
import { docHvVao } from "@/lib/portal/hv-du-lieu";
import { HvVaoTrang } from "@/components/portal/hv-vao";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cho con vào Cổng học sinh | Sata Robo", robots: { index: false } };

export default async function HvVaoRoute() {
  const { ctx, studentId } = await requireActiveStudent();
  const d = await docHvVao(ctx.parentUserId, ctx.children.map((c) => ({ id: c.id, name: c.name })));
  return <HvVaoTrang con={d.con} macDinhId={studentId} coMa={d.coMa} namSinhCon={d.namSinhCon} namNay={d.namNay} />;
}
