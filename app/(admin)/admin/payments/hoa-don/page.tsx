// Hoá đơn điện tử — tab "Hoá đơn" của kế toán (docs/ke-toan-hoa-don/PLAN.md §4 + §10; khung tab: S5b Invoice Hub).
//
// Trang chỉ GÁC CỔNG rồi giao thân cho `TrangBanChungTu` (dùng chung với tab "Cảnh báo & sai sót"). Layout
// (`./layout.tsx`) lo <h1>, thanh tab, thanh phạm vi — nhưng KHÔNG thay được cổng của trang: cờ → đăng nhập →
// PAGE_GATES → redirect vẫn nằm ở đây (CLAUDE.md luật 5; `page-gates.test.ts` đọc đúng khối này).
// URL cũ `?ngan=lech|don-huy|can-dieu-chinh` được `TrangBanChungTu` chuyển sang /payments/hoa-don/canh-bao.
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { TrangBanChungTu, type ThamSoTrang } from "./_components/trang-ban-chung-tu";

export const metadata = { title: "Hoá đơn điện tử | Admin" };
export const dynamic = "force-dynamic";

export default async function HoaDonPage({ searchParams }: { searchParams: Promise<ThamSoTrang> }) {
  // Cờ TẮT = màn không tồn tại. Đặt TRƯỚC `auth()` để không dò được địa chỉ có thật.
  if (!(await laHoaDonBat())) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fpayments%2Fhoa-don");
  if (!(await checkAnyPermission(PAGE_GATES["/payments/hoa-don"]))) {
    redirect("/dashboard?error=unauthorized");
  }

  return <TrangBanChungTu khuVuc="hoa-don" userId={session.user.id} sp={await searchParams} />;
}
