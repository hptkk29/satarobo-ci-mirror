import type { Metadata } from "next";
import { LegalPage } from "@/components/public/legal-page";

export const metadata: Metadata = {
  title: "Chính sách giao hàng",
  description:
    "Phạm vi giao hàng toàn quốc, đơn vị vận chuyển, phí và thời gian giao nhận của Sata Robo.",
  alternates: { canonical: "https://satarobo.vn/chinh-sach-giao-hang" },
  openGraph: {
    title: "Chính sách giao hàng | Sata Robo",
    description: "Phạm vi, chi phí và thời gian giao hàng của Sata Robo.",
    url: "https://satarobo.vn/chinh-sach-giao-hang",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function ChinhSachGiaoHangPage() {
  return (
    <LegalPage
      slug="chinh-sach-giao-hang"
      title="Chính sách giao hàng"
      subtitle="Phạm vi giao hàng, đơn vị vận chuyển, chi phí và thời gian giao nhận"
      breadcrumbLabel="Chính sách giao hàng"
    />
  );
}
