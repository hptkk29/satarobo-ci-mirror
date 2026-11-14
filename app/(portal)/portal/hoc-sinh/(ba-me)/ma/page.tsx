import { requireActiveStudent } from "@/lib/portal/session";
import { docCoMatKhau, docHvMa } from "@/lib/portal/hv-du-lieu";
import { HvMaTrang } from "@/components/portal/hv-ma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mã thoát Cổng học sinh | Sata Robo", robots: { index: false } };

export default async function HvMaRoute({ searchParams }: { searchParams: Promise<{ quen?: string }> }) {
  const { ctx } = await requireActiveStudent();
  const sp = await searchParams;
  const coMatKhau = await docCoMatKhau(ctx.parentUserId);
  const d = await docHvMa(ctx.parentUserId, ctx.children.map((c) => ({ id: c.id, name: c.name })), coMatKhau);
  return <HvMaTrang coMa={d.coMa} coMatKhau={d.coMatKhau} namSinhCon={d.namSinhCon} namNay={d.namNay} nhatKy={d.nhatKy} batDauQuen={sp.quen === "1"} />;
}
