// app/(portal)/portal/gioi-thieu/page.tsx — «Giới thiệu bạn bè» (AFF-P3 H3): đối tác Affiliate xem link / lượt bấm / khách giới thiệu / hoa hồng CỦA CHÍNH MÌNH. Chỉ đọc.
//
// Ai thấy được trang này: tài khoản PARENT đã đăng nhập, cờ Affiliate BẬT, và (đã là đối tác — bảng nối `AffiliatePartyUser` ACTIVE, `partyIdsVaoDuoc` — HOẶC chương trình giới thiệu cho phụ huynh
// đang mở). Chưa là đối tác ⇒ trang hiện quy định + «Tôi đã đọc và đồng ý» (tự tham gia, không duyệt — chủ dự án chốt 25/11/2026, `lib/affiliate/doi-tac-phu-huynh.ts`). Cờ tắt, hoặc chưa là đối tác
// mà chương trình phụ huynh chưa mở ⇒ `notFound()` (menu cũng không có mục — cùng phép `coMucGioiThieu`). Sự cô lập dữ liệu nằm TRONG hàm đọc (`docGioiThieuCuaToi`: mọi truy vấn neo vào tập `Affiliate` của người đăng nhập),
// không ở giao diện; `userId` lấy từ PHIÊN, không từ tham số URL / form.
//
// ⚠️ Giới hạn đã biết (docs/source-commission/12 §9): layout portal chỉ cho PARENT *đã liên kết ít nhất một học viên* đi qua tới đây. Một đối tác KHÔNG phải phụ huynh (người ngoài, trường học, KOL)
// chưa có đường đăng nhập vào cổng này — đó là quyết định kinh doanh (cấp tài khoản / vai / xác thực), chưa làm.
import { notFound, redirect } from "next/navigation";

import { GioiThieuBiChan, GioiThieuPageV2, GioiThieuThamGia } from "@/components/portal/gioi-thieu-page";
import { docTrangGioiThieuPhuHuynh } from "@/lib/affiliate/doi-tac-phu-huynh";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Giới thiệu | Sata Robo",
  robots: { index: false },
};

export default async function GioiThieuPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "PARENT") redirect("/login");

  const trang = await docTrangGioiThieuPhuHuynh(session.user.id, new Date());
  if (trang.loai === "KHONG_CO") notFound();
  if (trang.loai === "CHUA_THAM_GIA") return <GioiThieuThamGia quyDinh={trang.quyDinh} />;
  if (trang.loai === "BI_CHAN") return <GioiThieuBiChan lyDo={trang.lyDo} />;
  return <GioiThieuPageV2 data={trang.data} />;
}
