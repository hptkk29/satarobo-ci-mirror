import type { Metadata } from "next";
import { PhapLyTrang } from "@/components/public/phap-ly/phap-ly-trang";

export const metadata: Metadata = {
  title: "Phương thức cung cấp dịch vụ",
  description:
    "Cách Sata Robo cung cấp dịch vụ: thiết bị, thời hạn sử dụng, tính năng chính và việc điều chỉnh dịch vụ đã đặt.",
  alternates: { canonical: "https://satarobo.vn/phuong-thuc-cung-cap-dich-vu" },
  openGraph: {
    title: "Phương thức cung cấp dịch vụ | Sata Robo",
    description: "Cách thức Sata Robo cung cấp và hỗ trợ dịch vụ.",
    url: "https://satarobo.vn/phuong-thuc-cung-cap-dich-vu",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function PhuongThucCungCapDichVuPage() {
  return (
    <PhapLyTrang
      slug="phuong-thuc-cung-cap-dich-vu"
      title="Phương thức cung cấp dịch vụ"
      subtitle="Cách thức sử dụng dịch vụ, tính năng chính và điều chỉnh dịch vụ đã đặt"
      breadcrumbLabel="Phương thức cung cấp dịch vụ"
    />
  );
}
