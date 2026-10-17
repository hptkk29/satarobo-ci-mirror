import type { Metadata } from "next";
import { LegalPage } from "@/components/public/legal-page";

export const metadata: Metadata = {
  title: "Chính sách thanh toán",
  description:
    "Các hình thức thanh toán được Sata Robo chấp nhận, biện pháp bảo mật thanh toán và cách xử lý sự cố giao dịch.",
  alternates: { canonical: "https://satarobo.vn/chinh-sach-thanh-toan" },
  openGraph: {
    title: "Chính sách thanh toán | Sata Robo",
    description: "Hình thức thanh toán và cam kết bảo mật giao dịch của Sata Robo.",
    url: "https://satarobo.vn/chinh-sach-thanh-toan",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function ChinhSachThanhToanPage() {
  return (
    <LegalPage
      slug="chinh-sach-thanh-toan"
      title="Chính sách thanh toán"
      subtitle="Các hình thức thanh toán, bảo mật thông tin thanh toán và xử lý sự cố giao dịch"
      breadcrumbLabel="Chính sách thanh toán"
    />
  );
}
