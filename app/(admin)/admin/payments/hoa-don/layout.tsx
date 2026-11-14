// Khung CHUNG của khu Hoá đơn điện tử (S5b Invoice Hub, 01/11/2026; audit 05 §4.1–4.2).
//
//   <h1> Hoá đơn điện tử  →  thanh tab cấp 1 (Hoá đơn · Cảnh báo & sai sót · Cấu hình)  →  thanh phạm vi (cơ sở · tháng ·
//   pháp nhân đang thao tác)  →  trang.
//
// Vì sao ở layout: trước đây ba trang tự dựng đầu trang + tự dựng ô chọn cơ sở (hai kiểu khác nhau), và đi sang trang
// anh em là MẤT cơ sở + tháng. Một khung duy nhất ⇒ một thanh phạm vi, link giữa các tab mang phạm vi.
//
// ⚠️ LAYOUT KHÔNG NHẬN `searchParams` và KHÔNG render lại khi đổi giữa các trang con — nên chỉ giữ thứ KHÔNG đổi theo
// query (quyền, danh sách cơ sở của người xem, pháp nhân của từng cơ sở). Cái gì phụ thuộc cơ sở/tháng/ngăn đang chọn
// (số đếm, danh sách) ở trang; thanh tab + thanh phạm vi là client, đọc URL (audit 05 K5).
// ⚠️ Layout CHỈ vẽ khung. Cổng quyền của từng trang giữ nguyên ở trang (CLAUDE.md luật 5): chưa đăng nhập / không có quyền
// nào ⇒ trả nguyên children để trang tự redirect, KHÔNG nạp gì về cơ sở hay pháp nhân.
// ⚠️ Cờ TẮT ⇒ notFound() TRƯỚC auth() (như các trang): không dò được địa chỉ có thật.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { PageHeader } from "@/components/admin/ui/page-header";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { napCoSoLocHoaDon } from "@/lib/finance/hoa-don/hang-cho";
import { docCauHinhDangBat } from "@/lib/finance/hoa-don/cau-hinh-co-so-db";
import { thangVN } from "@/lib/finance/hoa-don/loc-hang-cho";
import { cauHinhHoaDonChoMoiTruong } from "@/lib/finance/hoa-don/phap-nhan-theo-moi-truong";
import { HoaDonNav } from "./_components/hoa-don-nav";
import { HoaDonScopeBar } from "./_components/hoa-don-scope-bar";
import { khuVucHienThi } from "./_components/dieu-huong-hoa-don";
import { ngayVN, tomTatPhapNhanTheoCoSo } from "./_components/phap-nhan-hien-thi";

export default async function HoaDonLayout({ children }: { children: React.ReactNode }) {
  if (!(await laHoaDonBat())) notFound();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return <>{children}</>;

  const [coHoaDon, coCauHinh, actor] = await Promise.all([
    checkAnyPermission(PAGE_GATES["/payments/hoa-don"]),
    checkAnyPermission(PAGE_GATES["/payments/hoa-don/cau-hinh"]),
    resolveActor(userId),
  ]);
  const hien = khuVucHienThi({ "/payments/hoa-don": coHoaDon, "/payments/hoa-don/cau-hinh": coCauHinh });
  if (hien.length === 0) return <>{children}</>;

  // Cơ sở CHỈ trong phạm vi kế toán của người xem (cùng hàm với các trang) — thanh phạm vi không bao giờ bày cơ sở ngoài phạm vi.
  const now = new Date();
  const cacCoSo = await napCoSoLocHoaDon(actor);
  const cauHinh = await docCauHinhDangBat(
    actor,
    cacCoSo.map((c) => c.id),
  );
  const phapNhan = tomTatPhapNhanTheoCoSo({
    cacCoSo,
    cauHinh,
    ngay: ngayVN(now),
    danhSachPhapNhan: cauHinhHoaDonChoMoiTruong().phapNhan,
  });

  return (
    // `@container/hd` + trần ~1920px: ở 4K/8K nội dung không bị kéo giãn; thanh phạm vi đổi bố cục theo bề rộng
    // VÙNG NỘI DUNG (sidebar ăn mất 256px nên viewport breakpoint nói dối), không theo cửa sổ. Không đổi AdminShell.
    <div className="@container/hd mx-auto w-full max-w-[120rem]">
      <PageHeader
        title="Hoá đơn điện tử"
        subtitle="Hoá đơn của từng lần thu tiền, theo cơ sở và pháp nhân phát hành."
      />
      <Suspense fallback={<div aria-hidden className="mb-4 h-10 border-b border-border" />}>
        <HoaDonNav hien={hien.map((k) => k.key)} />
      </Suspense>
      <Suspense fallback={<div aria-hidden className="mb-4 h-[4.5rem] rounded-xl border border-border bg-card" />}>
        <HoaDonScopeBar userId={userId} cacCoSo={cacCoSo} phapNhan={phapNhan} thangHienTai={thangVN(now)} />
      </Suspense>
      {children}
    </div>
  );
}
