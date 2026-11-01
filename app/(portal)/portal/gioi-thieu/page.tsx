// app/(portal)/portal/gioi-thieu/page.tsx — «Giới thiệu bạn bè» (AFF-P3 H3): đối tác Affiliate xem link / lượt bấm / khách giới thiệu / hoa hồng CỦA CHÍNH MÌNH. Chỉ đọc.
//
// Ai thấy được trang này: tài khoản PARENT đã đăng nhập, vào được ít nhất một đối tác Affiliate (bảng nối `AffiliatePartyUser` đang ACTIVE — `partyIdsVaoDuoc`, lib/affiliate/tai-khoan-truy-cap.ts), và cờ Affiliate BẬT. Thiếu một trong hai vế sau ⇒ `notFound()`
// (404 — không phân biệt «cờ tắt» với «chưa là đối tác»; menu cũng không có mục). Sự cô lập dữ liệu nằm TRONG hàm đọc (`docGioiThieuCuaToi`: mọi truy vấn neo vào tập `Affiliate` của người đăng nhập),
// không ở giao diện; `userId` lấy từ PHIÊN, không từ tham số URL / form.
//
// ⚠️ Giới hạn đã biết (docs/source-commission/12 §9): layout portal chỉ cho PARENT *đã liên kết ít nhất một học viên* đi qua tới đây. Một đối tác KHÔNG phải phụ huynh (người ngoài, trường học, KOL)
// chưa có đường đăng nhập vào cổng này — đó là quyết định kinh doanh (cấp tài khoản / vai / xác thực), chưa làm.
import { notFound, redirect } from "next/navigation";

import { GioiThieuPageV2 } from "@/components/portal/gioi-thieu-page";
import { docGioiThieuCuaToi } from "@/lib/affiliate/doc-cua-toi";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Giới thiệu | Sata Robo",
  robots: { index: false },
};

export default async function GioiThieuPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "PARENT") redirect("/login");

  const data = await docGioiThieuCuaToi(session.user.id, new Date());
  if (data === null) notFound();
  return <GioiThieuPageV2 data={data} />;
}
