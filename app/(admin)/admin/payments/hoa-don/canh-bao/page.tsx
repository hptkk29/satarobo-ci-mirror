// Hoá đơn điện tử — tab "Cảnh báo & sai sót" (S5b Invoice Hub, audit 05 §4.1).
//
// Ba ngăn trước đây nằm chung hàng với việc thường ngày được dời về đây, KHÔNG xoá tính năng nào:
// Lệch số · Đơn đã huỷ · Cần điều chỉnh. Cùng loader, cùng bàn chứng từ — chỉ khác ngăn nào hiện (`NGAN_THEO_KHU_VUC`).
// Quyền: cùng cổng với tab Hoá đơn (`PAGE_GATES["/payments/hoa-don"]`) — đây là cùng một dữ liệu, không phải
// một quyền mới. Trang tự gác cổng (layout chưa đủ — CLAUDE.md luật 5).
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { KhuNgoaiLe, KhuNgoaiLeKhung, type ThamSoNgoaiLe } from "../_components/khu-ngoai-le";
import { TrangBanChungTu, type ThamSoTrang } from "../_components/trang-ban-chung-tu";

export const metadata = { title: "Cảnh báo & sai sót | Hoá đơn điện tử | Admin" };
export const dynamic = "force-dynamic";

export default async function CanhBaoHoaDonPage({ searchParams }: { searchParams: Promise<ThamSoTrang & ThamSoNgoaiLe> }) {
  // Cờ TẮT = màn không tồn tại. Đặt TRƯỚC `auth()` để không dò được địa chỉ có thật.
  if (!(await laHoaDonBat())) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fpayments%2Fhoa-don%2Fcanh-bao");
  if (!(await checkAnyPermission(PAGE_GATES["/payments/hoa-don"]))) {
    redirect("/dashboard?error=unauthorized");
  }

  const sp = await searchParams;
  return (
    <>
      {/* Invoice Hub S12: ngoại lệ do scanner phát hiện, trên cùng tab. Cờ `hoaDon.hubQuet` TẮT ⇒ khu tự không hiện. Tải riêng (Suspense) để các ngăn bên dưới không phải chờ. */}
      <Suspense fallback={<KhuNgoaiLeKhung />}>
        <KhuNgoaiLe userId={session.user.id} sp={sp} />
      </Suspense>
      <TrangBanChungTu khuVuc="canh-bao" userId={session.user.id} sp={sp} />
    </>
  );
}
