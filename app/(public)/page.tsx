import type { Metadata } from "next";
import { organizationJsonLd, websiteJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { getTestimonials } from "@/lib/testimonials";
import { MAX_DISCOUNT_OFFLINE, TRIAL_LABEL } from "@/lib/uu-dai";
import "@/app/(public)/pub-design/trang-chu.css";
import { operationalLocations } from "@/lib/locations";
import { LienHeForm } from "@/components/public/lien-he-form";
import { BuoiHocSection, CamKetSection } from "@/components/public/home/buoi-hoc-cam-ket";
import { FaqSection } from "@/components/public/home/faq";
import { Hero } from "@/components/public/home/hero";
import { layGiaTrangChu } from "@/components/public/home/home-loader";
import { chuoiGiaThe, dungCauHoi } from "@/components/public/home/home-thuan";
import { KhoaHocSection } from "@/components/public/home/khoa-hoc";
import { PhanHoiSection } from "@/components/public/home/phan-hoi";
import { RobotTuLap } from "@/components/public/home/robot-tu-lap";
import { DauTruongSection } from "@/components/public/home/sang-lap-dau-truong";

const BASE_URL = "https://satarobo.vn";

export const metadata: Metadata = {
  title: "Sata Robo — Học Viện Robotics & AI Đà Nẵng",
  description: `Sata Robo - 2 cơ sở Robotics tại Đà Nẵng. Robosim độc quyền - phần mềm bắt buộc Cuộc thi 2026. Lớp ≤12 HV. Tặng ${TRIAL_LABEL}. Ưu đãi khai giảng đến ${MAX_DISCOUNT_OFFLINE}%.`,
  openGraph: {
    title: "Sata Robo – Trung tâm đào tạo STEM – Lập trình Robotics & AI",
    description: `Robosim độc quyền · Tặng ${TRIAL_LABEL} · 2 cơ sở Đà Nẵng`,
    url: BASE_URL,
    siteName: "Sata Robo",
    images: [
      {
        url: `${BASE_URL}/images/og/homepage.jpg`,
        width: 1200,
        height: 630,
        alt: "Sata Robo – Trung tâm đào tạo STEM – Lập trình Robotics & AI",
      },
    ],
    locale: "vi_VN",
    type: "website",
  },
  alternates: { canonical: BASE_URL },
};

export const revalidate = 60;

const orgJsonLd = organizationJsonLd();
const siteJsonLd = websiteJsonLd();

export default async function Page() {
  // Giá khoá + phản hồi phụ huynh độc lập nhau ⇒ lấy song song. Lỗi DB không làm sập trang:
  // giá thiếu thì thẻ bỏ dòng giá, phản hồi rỗng thì ẩn cả khối [05].
  const [gia, phanHoi] = await Promise.all([layGiaTrangChu(), getTestimonials("home")]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(orgJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(siteJsonLd) }} />
      <Hero soCoSo={operationalLocations().length} />
      <KhoaHocSection gia={chuoiGiaThe(gia)} />
      <RobotTuLap />
      <BuoiHocSection />
      <CamKetSection />
      <DauTruongSection />
      <PhanHoiSection danhSach={phanHoi} />
      <FaqSection cauHoi={dungCauHoi(gia)} />
      <LienHeForm variant="home" />
    </>
  );
}
