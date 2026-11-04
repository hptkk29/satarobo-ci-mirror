import type { Metadata } from "next";
import { db } from "@/lib/db";
import { organizationJsonLd, websiteJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { HomePage, type MainCourseCard } from "@/components/home/home-page";
import { getTestimonials } from "@/lib/testimonials";
import { MAX_DISCOUNT_OFFLINE, TRIAL_LABEL } from "@/lib/uu-dai";

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
  // PUB-17: courses + testimonials độc lập → fetch song song.
  const [rows, testimonialRows] = await Promise.all([
    db.course
      .findMany({
        where: {
          isPublished: true,
          slug: { in: ["laptrinhrobot", "luyenthirobosim"] },
        },
        orderBy: { displayOrder: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          shortDescription: true,
          description: true,
          thumbnail: true,
        },
      })
      .catch(() => []),
    getTestimonials("home"),
  ]);

  const courses: MainCourseCard[] = rows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    shortDescription: c.shortDescription ?? c.description?.slice(0, 200) ?? "",
    thumbnail: c.thumbnail,
  }));

  // Cảm nhận từ DB (model Testimonial); rỗng → component dùng fallback inline.
  const testimonials = testimonialRows.length
    ? testimonialRows.map((r) => ({
        name: r.name,
        role: r.role,
        body: r.content,
        location: r.location,
      }))
    : undefined;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(orgJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(siteJsonLd) }}
      />
      <HomePage courses={courses} testimonials={testimonials} />
    </>
  );
}
