import type { Metadata } from "next";
import { LegalPage } from "@/components/public/legal-page";

// Nội dung thật của trang nằm ở `content/legal/chinh-sach-bao-mat.md` —
// `LegalPage` đọc file đó theo `slug`. File này chỉ giữ metadata + tiêu đề, vì
// Next bắt buộc `export const metadata` phải nằm tại route.
//
// 06/09/2026 (S8 / việc 9.10): căn cứ pháp lý đổi từ NĐ 13/2023/NĐ-CP sang Luật
// Bảo vệ dữ liệu cá nhân số 91/2025/QH15 + Nghị định số 356/2025/NĐ-CP. Sửa ở
// ĐÂY phải sửa cùng lúc phần thân trong file .md — hai chỗ nói hai câu khác nhau
// là kiểu sai không ai phát hiện cho tới lúc bị hỏi.
export const metadata: Metadata = {
  title: "Chính sách Bảo mật",
  description:
    "Chính sách bảo mật thông tin của Sata Robo — cách chúng tôi thu thập, sử dụng và bảo vệ dữ liệu cá nhân theo Luật Bảo vệ dữ liệu cá nhân 91/2025 và Nghị định 356/2025/NĐ-CP.",
  alternates: { canonical: "https://satarobo.vn/chinh-sach-bao-mat" },
  openGraph: {
    title: "Chính sách Bảo mật | Sata Robo",
    description: "Cách Sata Robo thu thập, sử dụng và bảo vệ dữ liệu cá nhân của bạn.",
    url: "https://satarobo.vn/chinh-sach-bao-mat",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

export default function ChinhSachBaoMatPage() {
  return (
    <LegalPage
      slug="chinh-sach-bao-mat"
      title="Chính sách Bảo mật"
      subtitle="Theo Luật Bảo vệ dữ liệu cá nhân 91/2025 và Nghị định 356/2025/NĐ-CP"
      breadcrumbLabel="Chính sách Bảo mật"
    />
  );
}
