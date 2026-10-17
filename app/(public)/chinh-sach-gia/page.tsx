import type { Metadata } from "next";
import { LegalPage } from "@/components/public/legal-page";

export const metadata: Metadata = {
  title: "Chính sách về giá",
  description:
    "Cách Sata Robo niêm yết, áp dụng và điều chỉnh giá sản phẩm, dịch vụ — công khai, minh bạch theo quy định pháp luật.",
  alternates: { canonical: "https://satarobo.vn/chinh-sach-gia" },
  openGraph: {
    title: "Chính sách về giá | Sata Robo",
    description: "Nguyên tắc niêm yết và áp dụng giá tại Sata Robo.",
    url: "https://satarobo.vn/chinh-sach-gia",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function ChinhSachGiaPage() {
  return (
    <LegalPage
      slug="chinh-sach-gia"
      title="Chính sách về giá"
      subtitle="Nguyên tắc niêm yết, áp dụng và điều chỉnh giá sản phẩm, dịch vụ trên satarobo.vn"
      breadcrumbLabel="Chính sách về giá"
    />
  );
}
