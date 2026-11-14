// CỔNG "Chính sách hoạt động của website" cho `/portal/hoc-phi` — hồ sơ BCT mục 4.
//
// VÌ SAO Ở LAYOUT CỦA SEGMENT, không ở `portal/layout.tsx`, và không chắn riêng một khối:
//
//  1. Chắn riêng khối "hướng dẫn thanh toán" là chắn MÃ CHẾT. `hoc-phi/page.tsx` return
//     sớm khi `isPortalV2Enabled()`, mà Vercel Production đặt `PORTAL_V2_ENABLED="true"`
//     ⇒ khối đó phụ huynh thật không bao giờ thấy; khối thật nằm ở
//     `components/portal/hoc-phi-page.tsx`. Layout bọc `page.tsx` nên chặn được CẢ HAI
//     nhánh v1/v2 bằng một file — không phải nhớ sửa hai chỗ.
//  2. Đặt ở `portal/layout.tsx` sẽ ĐỤNG ĐỘ cổng chat (`/portal/tin-nhan/layout.tsx`):
//     phụ huynh vào tin nhắn sẽ bị tích hai lần liên tiếp, hai màn chính sách khác nhau.
//     Và nó chắn luôn học bạ, lịch học, thông báo — những thứ không liên quan gì.
//  3. Chặn ở layout nghĩa là `children` KHÔNG vào cây React ⇒ page RSC không chạy ⇒ không
//     một con số công nợ nào rời DB. Chắn ở mức khối thì số tiền đã nằm trong payload RSC,
//     mở DevTools là đọc được.
//
// Cổng chỉ đóng MỘT trang. Học bạ, điểm danh, lịch học, tin nhắn, thông báo mở nguyên —
// đó là lý do không cần nút "Để sau" (một đồng ý bấm-bỏ-qua-được không phải bằng chứng).
//
// Khuôn lấy từ `app/(portal)/portal/tin-nhan/layout.tsx` — cách chặn này đang chạy prod.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAcceptedSitePolicy } from "@/lib/legal/site-policy";
import { SitePolicyGate } from "./_components/site-policy-gate";

export const dynamic = "force-dynamic";

export default async function HocPhiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Giữ nguyên hành vi của `page.tsx`: chỉ phụ huynh vào được trang học phí. Kiểm ở đây
  // để nhân viên KHÔNG bao giờ thấy màn chính sách dành cho phụ huynh.
  if (session.user.role !== "PARENT") redirect("/login");

  if (await hasAcceptedSitePolicy(session.user.id)) return <>{children}</>;
  return <SitePolicyGate />;
}
