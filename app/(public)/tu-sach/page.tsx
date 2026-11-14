import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isTuSachEnabled } from "@/lib/flags";
import { daMoKhoa } from "@/lib/cong-thong-tin/doc-the";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { TuSachTrang } from "@/components/public/tu-sach/tu-sach-trang";
// Thứ tự nạp theo quy ước pub-design: phần dùng chung trước, rồi phần riêng của trang.
import "@/app/(public)/pub-design/cong-thong-tin.css";
import "@/app/(public)/pub-design/tu-sach.css";

// ⚠️ Cờ đọc từ env lúc CHẠY, không bake vào bản dựng: trang PHẢI động (bài học sự cố /kich-hoat 08/11/2026), và còn đọc cookie thẻ mở khoá.
export const dynamic = "force-dynamic";

const BASE_URL = "https://satarobo.vn";

export const metadata: Metadata = {
  title: "Tủ sách gia đình — 20 ebook miễn phí và sách giáo khoa lớp 1–12 | Sata Robo",
  description:
    "20 ebook do Ban Đào tạo Sata Robo biên soạn cho phụ huynh (tư duy, kỹ năng sống, gia đình, học tập, STEM) cùng sách giáo khoa lớp 1–12. Đọc trực tuyến miễn phí; muốn tải về thì để lại thông tin một lần.",
  alternates: { canonical: `${BASE_URL}/tu-sach` },
  openGraph: {
    title: "Tủ sách gia đình — Sata Robo",
    description: "20 ebook miễn phí cho ba mẹ và sách giáo khoa lớp 1–12. Đọc ngay trên điện thoại hay máy tính.",
    url: `${BASE_URL}/tu-sach`,
    siteName: "Sata Robo",
    type: "website",
  },
};

export default async function TuSachPage() {
  if (!isTuSachEnabled()) notFound();
  const moKhoa = await daMoKhoa();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd([{ name: "Trang chủ", url: BASE_URL }, { name: "Tủ sách gia đình", url: `${BASE_URL}/tu-sach` }])) }} />
      <TuSachTrang daMoKhoa={moKhoa} />
    </>
  );
}
