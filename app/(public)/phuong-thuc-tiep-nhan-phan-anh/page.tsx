import type { Metadata } from "next";
import { LegalPage } from "@/components/public/legal-page";

export const metadata: Metadata = {
  title: "Phương thức tiếp nhận và giải quyết phản ánh, yêu cầu, khiếu nại",
  description:
    "Cách gửi phản ánh, yêu cầu, khiếu nại tới Sata Robo; trình tự xác minh và thời hạn giải quyết theo quy định.",
  alternates: { canonical: "https://satarobo.vn/phuong-thuc-tiep-nhan-phan-anh" },
  openGraph: {
    title: "Phương thức tiếp nhận và giải quyết phản ánh, yêu cầu, khiếu nại | Sata Robo",
    description: "Kênh tiếp nhận và quy trình giải quyết khiếu nại của Sata Robo.",
    url: "https://satarobo.vn/phuong-thuc-tiep-nhan-phan-anh",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function PhuongThucTiepNhanPhanAnhPage() {
  return (
    <LegalPage
      slug="phuong-thuc-tiep-nhan-phan-anh"
      title="Phương thức tiếp nhận và giải quyết phản ánh, yêu cầu, khiếu nại"
      subtitle="Kênh tiếp nhận, trình tự xử lý và thời hạn giải quyết phản ánh, yêu cầu, khiếu nại của khách hàng"
      breadcrumbLabel="Tiếp nhận & giải quyết khiếu nại"
    />
  );
}
