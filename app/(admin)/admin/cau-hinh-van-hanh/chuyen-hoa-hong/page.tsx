// app/(admin)/admin/cau-hinh-van-hanh/chuyen-hoa-hong/page.tsx — «Chuyển sang hoa hồng mới»: đặt / dời / gỡ mốc `hoaHong.kyCutover` có kiểm soát (hướng D+H, đợt UAT cutover).
//
// Vì sao ở DƯỚI Cấu hình vận hành chứ không trong tab của module hoa hồng: mọi tab hoa hồng 404 khi `hoaHong.engineBat` tắt, mà runbook (05 §7.5 bước 4) bắt đặt MỐC trước rồi mới
// bật engine — một nút đặt mốc trong tab hoa hồng là vòng tròn với cờ. Cấu hình vận hành không bị cờ nào gác.
//
// Quyền vào trang: `PAGE_GATES["/cau-hinh-van-hanh/chuyen-hoa-hong"]` (= `settings:view`). Quyền GHI vẽ nút «Đặt mốc» là `settings:edit` — ĐÚNG khoá mà `xacNhanCutoverAction` kiểm
// (luật 12); `datMocCutover` còn tự gác `isSuperAdmin`. Người chỉ có quyền xem thấy mọi con số và lý do chặn, không thấy nút ghi.
//
// ⚠️ Mốc hiện tại đọc THẲNG DB (`docMocHienTai`), không qua `getSetting` (cache 300 giây): một trang nói về cổng tiền không được hiện mốc cũ 5 phút.
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/admin/ui/page-header";
import { NoPermission } from "@/components/admin/ui/states";
import { auth } from "@/lib/auth";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { cuaSoMacDinh, docLichSuCutover, docMocHienTai } from "@/lib/hoa-hong/cutover-hanh-dong";
import { laEngineHoaHongBat } from "@/lib/hoa-hong/feature";
import { congThang } from "@/lib/hoa-hong/ky-hoa-hong";
import { thangVN } from "@/lib/hoa-hong/ky-man-hinh";
import { ngayVN } from "@/lib/hoa-hong/ngay-lam-viec";

import { ChuyenHoaHongMan } from "./_components/chuyen-hoa-hong-man";

export const metadata = { title: "Chuyển sang hoa hồng mới | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ChuyenHoaHongPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!(await checkAnyPermission(PAGE_GATES["/cau-hinh-van-hanh/chuyen-hoa-hong"]))) {
    return (
      <div className="max-w-5xl">
        <NoPermission permission="settings:view" what="trang chuyển sang hoa hồng mới" askWho="Quản trị tối cao" />
      </div>
    );
  }

  const now = new Date();
  const [moc, lichSu, suaDuoc, engineBat] = await Promise.all([
    docMocHienTai(),
    docLichSuCutover(20),
    // ĐÚNG khoá mà `xacNhanCutoverAction` kiểm — vẽ nút bằng khoá A rồi để action hỏi khoá B là lời hứa suông (luật 12).
    checkPermission("settings:edit"),
    // Cờ đọc hỏng ⇒ coi là TẮT (không nói «đang bật» khi không chắc).
    laEngineHoaHongBat().catch(() => false),
  ]);

  const nay = thangVN(now);
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Chuyển sang hoa hồng mới"
        subtitle="Đặt kỳ đầu tiên của sổ hoa hồng mới. Trước mốc, lịch sử cũ chỉ đọc; từ mốc, engine mới tính. Hệ thống không bao giờ tính lại kỳ cũ bằng engine mới."
      />
      <ChuyenHoaHongMan
        mocHienTai={moc}
        engineBat={engineBat}
        suaDuoc={suaDuoc}
        cuaSoMacDinh={cuaSoMacDinh(now)}
        homNay={ngayVN(now)}
        thangGoiY={congThang(nay, 1)}
        thangToiThieu={congThang(nay, 1)}
        lichSu={lichSu}
      />
    </div>
  );
}
