import type { Metadata } from "next";
import { aboutPageJsonLd, breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { VeChungToiNoiDung } from "./noi-dung";

const BASE_URL = "https://satarobo.vn";

export const metadata: Metadata = {
  title: "Câu chuyện thương hiệu Sata Robo | Tầm nhìn, Sứ mệnh, Giá trị cốt lõi",
  description:
    "Trung tâm đào tạo STEM – Lập trình Robotics & AI – Sata Robo. Khơi nguồn sáng tạo, chắp cánh tương lai.",
  alternates: { canonical: `${BASE_URL}/ve-chung-toi` },
  openGraph: {
    title: "Câu chuyện thương hiệu Sata Robo",
    description: "Khơi nguồn sáng tạo – Chắp cánh tương lai",
    url: `${BASE_URL}/ve-chung-toi`,
    siteName: "Sata Robo",
  },
};

// Giao diện chép từ About.dc.html (artifact "Sata Robo — Website mới"): xem ./noi-dung.tsx.
// Địa chỉ, giờ, pháp nhân đọc từ lib/locations (repo thắng artifact khi hai bên lệch).
export default function VeChungToiPage() {
  const breadcrumb = breadcrumbJsonLd([
    { name: "Trang chủ", url: "/" },
    { name: "Về chúng tôi", url: "/ve-chung-toi" },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(aboutPageJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />
      <VeChungToiNoiDung />
    </>
  );
}
