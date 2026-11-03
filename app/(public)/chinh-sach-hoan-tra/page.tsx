import type { Metadata } from "next";
import { LegalPage } from "@/components/public/legal-page";

// Slug GIỮ NGUYÊN `chinh-sach-hoan-tra` (URL đã nằm trong sitemap, có thể đã được lập chỉ mục).
// Chỉ TÊN HIỂN THỊ đổi thành "Chính sách đổi trả hàng và hoàn tiền" — đó là tên bắt buộc trong
// danh sách 10 chính sách của hồ sơ BCT, và hồ sơ đối chiếu tên hiển thị chứ không đối chiếu slug.
// Phần khoá học/học phí đã tách sang /chinh-sach-cham-dut-dich-vu (chính sách #9).
export const metadata: Metadata = {
  title: "Chính sách đổi trả hàng và hoàn tiền",
  description:
    "Điều kiện đổi trả hàng hóa, các trường hợp không áp dụng, chi phí hoàn trả và quy trình xử lý yêu cầu tại Sata Robo.",
  alternates: { canonical: "https://satarobo.vn/chinh-sach-hoan-tra" },
  openGraph: {
    title: "Chính sách đổi trả hàng và hoàn tiền | Sata Robo",
    description: "Điều kiện, chi phí và quy trình đổi trả hàng hóa tại Sata Robo.",
    url: "https://satarobo.vn/chinh-sach-hoan-tra",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function ChinhSachHoanTraPage() {
  return (
    <LegalPage
      slug="chinh-sach-hoan-tra"
      title="Chính sách đổi trả hàng và hoàn tiền"
      subtitle="Điều kiện đổi trả hàng hóa, chi phí hoàn trả và quy trình xử lý yêu cầu"
      breadcrumbLabel="Đổi trả hàng & hoàn tiền"
    />
  );
}
