// app/(portal)/portal/suc-khoe/page.tsx — «Sức khỏe cả nhà» của cổng phụ huynh (08/11/2026).
//
// Gói MIỄN PHÍ, mở được cả khi tài khoản chưa có học viên (layout cho đoạn `suc-khoe` vào khi cờ bật ∧ PARENT).
// Giao diện theo artifact «Cổng Phụ Huynh — Thiết kế lại» (bảng số đo cả nhà + khảo sát thói quen). Chủ dự án chốt: dữ liệu ở lại TRÊN MÁY người dùng
// (localStorage), khuyến nghị DÙNG CHUNG khuôn với trang công khai. Không có cổng «để lại thông tin».
import { SucKhoeCong } from "@/components/portal/suc-khoe/suc-khoe-cong";
import { isSucKhoeEnabled } from "@/lib/flags";
import { yeuCauPhienMienPhi } from "@/lib/portal/phien-mien-phi";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sức khỏe cả nhà | Sata Robo",
  robots: { index: false },
};

export default async function SucKhoePortalPage() {
  await yeuCauPhienMienPhi(isSucKhoeEnabled());
  return <SucKhoeCong />;
}
