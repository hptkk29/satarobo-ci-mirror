import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isThuNhapThemEnabled } from "@/lib/flags";
import { NHAN_TRANG_THAI_LEAD_PH, docThuNhapThem } from "@/lib/nguon/thu-nhap-them";
import { ThuNhapThemPage } from "@/components/portal/thu-nhap-them-page";
import type { LeadStatus } from "@prisma/client";

export const dynamic = "force-dynamic"; // cờ đọc từ env lúc CHẠY.
export const metadata = { title: "Thu nhập thêm | Sata Robo", robots: { index: false } };

// «Thu nhập thêm» (ẩn sau cờ THU_NHAP_THEM_ENABLED, mặc định TẮT). Tìm/lọc đọc ở SERVER từ query — số điện thoại đầy đủ chỉ được dùng để
// khớp ở máy chủ và KHÔNG bao giờ gửi xuống trình duyệt (chỉ dạng che).
export default async function ThuNhapThemRoute({ searchParams }: { searchParams: Promise<{ q?: string; tt?: string }> }) {
  if (!isThuNhapThemEnabled()) notFound();
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "PARENT") notFound();

  const sp = await searchParams;
  const tt = sp.tt && sp.tt in NHAN_TRANG_THAI_LEAD_PH ? (sp.tt as LeadStatus) : null;
  const q = (sp.q ?? "").slice(0, 60);
  const d = await docThuNhapThem({ userId: session.user.id, q, trangThai: tt });
  if (!d) notFound();
  return <ThuNhapThemPage d={d} q={q} tt={tt} />;
}
