import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isDiscEnabled, isSucKhoeEnabled, isTuSachEnabled } from "@/lib/flags";
import { getPortalContext } from "@/lib/portal/session";
import { coQuaTangNao } from "@/lib/portal/qua-tang";
import { docKhuyenMaiChoPhuHuynh, docMaCoSo } from "@/lib/portal/khuyen-mai-ph";
import { KhuyenMaiPage } from "@/components/portal/khuyen-mai-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Khuyến mãi | Sata Robo", robots: { index: false } };

// «Khuyến mãi» — chương trình đang áp dụng (lib/khuyen-mai/hieu-luc.ts). Chỉ-xem, không lộ mã giảm giá.
export default async function KhuyenMaiRoute() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARENT") notFound();

  const ctx = await getPortalContext();
  const ds = await docKhuyenMaiChoPhuHuynh(await docMaCoSo(ctx?.activeStudent?.centerId));
  const coHopQua = coQuaTangNao({ disc: isDiscEnabled(), sucKhoe: isSucKhoeEnabled(), tuSach: isTuSachEnabled() });
  return <KhuyenMaiPage ds={ds} coHopQua={coHopQua} />;
}
