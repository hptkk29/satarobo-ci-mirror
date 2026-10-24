import type { Metadata } from "next";
import { PrivacyCenter } from "./_components/privacy-center";

// PUB-05: server page giữ metadata (trang trước đây "use client" nên thiếu title/canonical/OG);
// phần tương tác consent nằm ở client component <PrivacyCenter/>.
const TITLE = "Trung tâm quyền riêng tư | Sata Robo";
const DESCRIPTION =
  "Quản lý cookie và dữ liệu cá nhân của bạn tại Sata Robo — xem, sửa, rút lại consent. Theo Nghị định 13/2023/NĐ-CP.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://satarobo.vn/quyen-rieng-tu" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://satarobo.vn/quyen-rieng-tu",
    siteName: "Sata Robo",
    locale: "vi_VN",
    type: "website",
  },
};

export default function PrivacyCenterPage() {
  return <PrivacyCenter />;
}
