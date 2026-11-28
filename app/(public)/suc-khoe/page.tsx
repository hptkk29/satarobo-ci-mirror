import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSucKhoeEnabled } from "@/lib/flags";
import { daMoKhoa } from "@/lib/cong-thong-tin/doc-the";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { SucKhoeTrang } from "@/components/public/suc-khoe/suc-khoe-trang";
// Thứ tự nạp theo quy ước pub-design: phần dùng chung trước, rồi phần riêng của trang.
import "@/app/(public)/pub-design/cong-thong-tin.css";
import "@/app/(public)/pub-design/suc-khoe.css";
import "@/app/(public)/pub-design/suc-khoe-in.css";

// ⚠️ Cờ đọc từ env lúc CHẠY, không bake vào bản dựng: trang PHẢI động (bài học sự cố /kich-hoat 08/11/2026), và còn đọc cookie thẻ mở khoá.
export const dynamic = "force-dynamic";

const BASE_URL = "https://satarobo.vn";

export const metadata: Metadata = {
  title: "Sức khỏe cả nhà — thăm dò miễn phí cho từng thành viên | Sata Robo",
  description:
    "Thăm dò sức khỏe cơ bản cho từng thành viên trong gia đình (ăn uống, vận động, giấc ngủ, tinh thần), nhận gợi ý chăm sóc bản thân có ghi nguồn. Câu trả lời ở lại trên máy anh chị. Thông tin tham khảo, không thay thế bác sĩ.",
  alternates: { canonical: `${BASE_URL}/suc-khoe` },
  openGraph: {
    title: "Sức khỏe cả nhà — Sata Robo",
    description: "Thăm dò sức khỏe cho cả nhà, nhận gợi ý chăm sóc có ghi nguồn. Miễn phí, dữ liệu ở lại trên máy anh chị.",
    url: `${BASE_URL}/suc-khoe`,
    siteName: "Sata Robo",
    type: "website",
  },
};

export default async function SucKhoePage() {
  if (!isSucKhoeEnabled()) notFound();
  const moKhoa = await daMoKhoa();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd([{ name: "Trang chủ", url: BASE_URL }, { name: "Sức khỏe cả nhà", url: `${BASE_URL}/suc-khoe` }])) }} />
      <SucKhoeTrang daMoKhoa={moKhoa} />
    </>
  );
}
