import type { Metadata } from "next";
import { LegalPage } from "@/components/public/legal-page";

export const metadata: Metadata = {
  title: "Các điều kiện và hạn chế trong việc giao hàng và cung cấp dịch vụ",
  description:
    "Các điều kiện và hạn chế khi Sata Robo cung cấp hàng hóa, dịch vụ: thời gian, phạm vi địa lý, số lượng và tính khả dụng.",
  alternates: { canonical: "https://satarobo.vn/cac-dieu-kien-va-han-che" },
  openGraph: {
    title: "Các điều kiện và hạn chế trong việc giao hàng và cung cấp dịch vụ | Sata Robo",
    description: "Điều kiện và hạn chế khi cung cấp hàng hóa, dịch vụ tại Sata Robo.",
    url: "https://satarobo.vn/cac-dieu-kien-va-han-che",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function CacDieuKienVaHanChePage() {
  return (
    <LegalPage
      slug="cac-dieu-kien-va-han-che"
      title="Các điều kiện và hạn chế trong việc giao hàng và cung cấp dịch vụ"
      subtitle="Giới hạn về thời gian, phạm vi địa lý, đối tượng và tính khả dụng của hàng hóa, dịch vụ"
      breadcrumbLabel="Điều kiện & hạn chế cung cấp"
    />
  );
}
