import type { Metadata } from "next";
import { LegalPage } from "@/components/public/legal-page";

export const metadata: Metadata = {
  title: "Điều khoản Sử dụng",
  description:
    "Điều khoản sử dụng website satarobo.vn — quyền và nghĩa vụ của người dùng khi truy cập dịch vụ Sata Robo.",
  alternates: { canonical: "https://satarobo.vn/dieu-khoan-su-dung" },
  openGraph: {
    title: "Điều khoản Sử dụng | Sata Robo",
    description: "Quyền và nghĩa vụ khi sử dụng website và dịch vụ Sata Robo.",
    url: "https://satarobo.vn/dieu-khoan-su-dung",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function DieuKhoanSuDungPage() {
  return (
    <LegalPage
      slug="dieu-khoan-su-dung"
      title="Điều khoản Sử dụng"
      subtitle="Quyền và nghĩa vụ khi sử dụng dịch vụ Sata Robo"
      breadcrumbLabel="Điều khoản Sử dụng"
    />
  );
}
