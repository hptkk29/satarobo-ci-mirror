import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isDiscEnabled, isSucKhoeEnabled, isThuNhapThemEnabled, isTuSachEnabled } from "@/lib/flags";
import { getPortalContext } from "@/lib/portal/session";
import { quaTangDangMo } from "@/lib/portal/qua-tang";
import { docKhuyenMaiChoPhuHuynh, docMaCoSo } from "@/lib/portal/khuyen-mai-ph";
import { QuaTangPage } from "@/components/portal/qua-tang-page";

export const dynamic = "force-dynamic"; // cờ đọc từ env lúc CHẠY (xem lib/flags.ts) — trang tĩnh sẽ bake giá trị lúc dựng.
export const metadata = { title: "Quà tặng | Sata Robo", robots: { index: false } };

// «Quà tặng» — hộp quà các tính năng miễn phí (DISC · Sức khỏe · Tủ sách …). Mở cho phụ huynh CÓ hoặc CHƯA có bé; hộp tắt hẳn khi mọi cờ tắt (404).
export default async function QuaTangRoute() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARENT") notFound();

  const qua = quaTangDangMo({ disc: isDiscEnabled(), sucKhoe: isSucKhoeEnabled(), tuSach: isTuSachEnabled() });
  if (qua.length === 0) notFound();

  const ctx = await getPortalContext();
  const khuyenMai = await docKhuyenMaiChoPhuHuynh(await docMaCoSo(ctx?.activeStudent?.centerId)).catch(() => []);
  return <QuaTangPage qua={qua} soKhuyenMai={khuyenMai.length} coThuNhap={isThuNhapThemEnabled()} />;
}
