// app/(teacher)/teacher/phan-cong/cong-o/page.tsx — "Ô công cần xem" nay là một khối của "Bảng công" (chủ dự án 09/11/2026, thiết kế
// Bảng công giáo viên parttime): lưới ô công, ô cần xem + phản ánh, phản ánh của tôi. GIỮ route làm lối chuyển hướng.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OCongChuyenHuong({ searchParams }: { searchParams: Promise<{ thang?: string }> }) {
  const sp = await searchParams;
  redirect(sp.thang && /^\d{4}-\d{2}$/.test(sp.thang) ? `/teacher/bang-cong?thang=${sp.thang}#o-can-xem` : "/teacher/bang-cong#o-can-xem");
}
