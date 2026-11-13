import type { Metadata } from "next";
import { KhungChinhSach } from "@/components/public/phap-ly/khung-chinh-sach";
import { PrivacyCenter } from "./_components/privacy-center";

// PUB-05: server page giữ metadata (trang trước đây "use client" nên thiếu title/canonical/OG);
// phần tương tác consent nằm ở client component <PrivacyCenter/>. Khung trang (đường dẫn, tiêu đề, thanh
// bên chính sách) dùng chung với 11 văn bản pháp lý — `KhungChinhSach`.
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
  return (
    <KhungChinhSach
      slug="quyen-rieng-tu"
      title="Trung tâm quyền riêng tư"
      subtitle="Quản lý cách Sata Robo sử dụng cookie và dữ liệu cá nhân của anh/chị khi truy cập trang. Theo Nghị định 13/2023/NĐ-CP."
      breadcrumbLabel="Quyền riêng tư"
    >
      <PrivacyCenter />
    </KhungChinhSach>
  );
}
