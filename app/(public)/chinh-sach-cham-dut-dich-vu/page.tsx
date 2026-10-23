import type { Metadata } from "next";
import { LegalPage } from "@/components/public/legal-page";

export const metadata: Metadata = {
  title: "Chính sách chấm dứt dịch vụ và hoàn tiền",
  description:
    "Các trường hợp chấm dứt khóa học, dịch vụ tại Sata Robo; mức hoàn trả học phí theo thời điểm rút học và quy trình xử lý.",
  alternates: { canonical: "https://satarobo.vn/chinh-sach-cham-dut-dich-vu" },
  openGraph: {
    title: "Chính sách chấm dứt dịch vụ và hoàn tiền | Sata Robo",
    description: "Điều kiện chấm dứt dịch vụ và mức hoàn trả học phí tại Sata Robo.",
    url: "https://satarobo.vn/chinh-sach-cham-dut-dich-vu",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function ChinhSachChamDutDichVuPage() {
  return (
    <LegalPage
      slug="chinh-sach-cham-dut-dich-vu"
      title="Chính sách chấm dứt dịch vụ và hoàn tiền"
      subtitle="Các trường hợp chấm dứt khóa học, mức hoàn trả học phí và quy trình xử lý"
      breadcrumbLabel="Chấm dứt dịch vụ & hoàn tiền"
    />
  );
}
