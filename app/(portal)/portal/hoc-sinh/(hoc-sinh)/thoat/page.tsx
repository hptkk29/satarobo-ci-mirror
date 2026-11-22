import { requireActiveStudent } from "@/lib/portal/session";
import { docHvThoat } from "@/lib/portal/hv-du-lieu";
import { HvThoatTrang } from "@/components/portal/hv-thoat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Về chế độ ba mẹ | Cổng học sinh Sata Robo", robots: { index: false } };

export default async function HvThoatRoute() {
  const { ctx } = await requireActiveStudent({ choHocSinh: true });
  const d = await docHvThoat(ctx.parentUserId);
  return <HvThoatTrang giayKhoaDau={d.giayKhoa} coMatKhau={d.coMatKhau} />;
}
