// app/(teacher)/teacher/phan-cong/thang/page.tsx — "Công tháng của tôi" ĐÃ GỠ khỏi menu (chủ dự án 09/11/2026). Tiết / trực / khoản trừ /
// buổi quản lý điều chỉnh nay ở "Bảng công" (khối Parttime). GIỮ route làm lối chuyển hướng cho liên kết đã gửi đi.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CongThangChuyenHuong({ searchParams }: { searchParams: Promise<{ thang?: string }> }) {
  const sp = await searchParams;
  redirect(sp.thang && /^\d{4}-\d{2}$/.test(sp.thang) ? `/teacher/bang-cong?thang=${sp.thang}` : "/teacher/bang-cong");
}
