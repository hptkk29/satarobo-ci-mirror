import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronRight,
  Briefcase,
  Heart,
  TrendingUp,
  Users,
  MapPin,
  Clock,
  DollarSign,
  ArrowRight,
  Mail,
  Phone,
} from "lucide-react";
import { db } from "@/lib/db";
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { SectionBase } from "@/components/design-system/sections/section-base";
import { CTAPrimary } from "@/components/design-system/ctas/cta-primary";
import { GlowOrb } from "@/components/design-system/effects/glow-orb";
import { getPageImage, pageImages } from "@/lib/page-images";
import { tokens } from "@/lib/design-tokens";
import { SATA_ROBO_CONTACT, SATA_ROBO_PHONE } from "@/lib/locations";
import { AutoCarousel } from "@/components/public/auto-carousel";

export const revalidate = 60;

const BASE_URL = "https://satarobo.vn";
const HR_EMAIL = SATA_ROBO_CONTACT.emails.recruitment;

export const metadata: Metadata = {
  title: "Tuyển dụng — Cơ hội nghề nghiệp tại Sata Robo",
  description:
    "Sata Robo tuyển dụng giáo viên Robotics, Tư vấn tuyển sinh, Kế toán, Marketing, Telesales tại Đà Nẵng. Lương cạnh tranh, đào tạo bài bản.",
  alternates: { canonical: `${BASE_URL}/tuyen-dung` },
  openGraph: {
    title: "Tuyển dụng — Sata Robo",
    description: "Gia nhập đội ngũ Sata Robo — nơi đam mê giáo dục và công nghệ gặp nhau.",
    url: `${BASE_URL}/tuyen-dung`,
    siteName: "Sata Robo",
    images: [{ url: pageImages.careers.src, width: 1600, height: 900 }],
  },
};

const PERKS = [
  { icon: Heart, title: "Văn hoá tích cực", desc: "Team trẻ, năng động, học hỏi liên tục" },
  { icon: TrendingUp, title: "Lương cạnh tranh", desc: "Lương + thưởng KPI + thưởng tháng 13" },
  { icon: Users, title: "Đào tạo bài bản", desc: "Mentor 1-1 + budget học liệu" },
  { icon: Briefcase, title: "Lộ trình thăng tiến", desc: "Performance review rõ ràng" },
];

export default async function TuyenDungPage() {
  // PUB-17: hero image + danh sách job độc lập → fetch song song.
  const [heroImage, jobs] = await Promise.all([
    getPageImage("tuyen-dung", pageImages.careers),
    db.jobPosting
      .findMany({
        where: { status: "OPEN" },
        orderBy: [{ updatedAt: "desc" }],
        select: {
          id: true,
          slug: true,
          title: true,
          department: true,
          location: true,
          type: true,
          salary: true,
          salaryMin: true,
          salaryMax: true,
          salaryNote: true,
          description: true,
        },
      })
      .catch(() => []),
  ]);

  const formatSalary = (j: {
    salary: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryNote: string | null;
  }): string | null => {
    if (j.salary) return j.salary;
    if (j.salaryMin && j.salaryMax) {
      return `${j.salaryMin.toLocaleString("vi-VN")} – ${j.salaryMax.toLocaleString("vi-VN")} VND`;
    }
    return j.salaryNote ?? null;
  };

  const summarize = (text: string, max = 160): string => {
    const stripped = text.replace(/\s+/g, " ").trim();
    return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
  };

  const breadcrumb = breadcrumbJsonLd([
    { name: "Trang chủ", url: "/" },
    { name: "Tuyển dụng", url: "/tuyen-dung" },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <div className="bg-white border-b border-neutral-200 py-3">
        <div className={tokens.spacing.container}>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-neutral-500">
            <Link href="/" className="hover:text-orange-600 transition-colors">
              Trang chủ
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-neutral-800 font-medium">Tuyển dụng</span>
          </nav>
        </div>
      </div>

      <section className={`relative overflow-hidden ${tokens.vibrantBg.softWarm} py-16`}>
        <GlowOrb color="orange" position="top-right" size="lg" />
        <div className="container max-w-6xl mx-auto px-4 grid md:grid-cols-2 gap-12 items-center relative z-10">
          <div>
            <p className={`${tokens.typography.eyebrow} mb-3`}>TUYỂN DỤNG</p>
            <h1 className={`${tokens.typography.display.h2} mb-4`}>Gia nhập Sata Robo</h1>
            <p className={`${tokens.typography.body.lg} text-neutral-600 mb-6`}>
              Cùng xây dựng tương lai giáo dục Robotics tại Việt Nam — nơi đam mê công nghệ và giáo dục gặp nhau
            </p>
            <CTAPrimary href={`mailto:${HR_EMAIL}`} magnetic>
              Liên hệ tuyển dụng
            </CTAPrimary>
          </div>
          <div className="relative aspect-video rounded-2xl overflow-hidden shadow-xl">
            <Image
              src={heroImage.src}
              alt={heroImage.alt}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority
            />
          </div>
        </div>
      </section>

      <SectionBase theme="white" eyebrow={`VỊ TRÍ MỞ (${jobs.length})`} title="Cơ hội nghề nghiệp">
        {jobs.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-neutral-500 mb-4">
              Hiện không có vị trí phù hợp. Gửi CV để được lưu hồ sơ cho cơ hội tương lai.
            </p>
            <CTAPrimary href={`mailto:${HR_EMAIL}`}>Gửi CV chủ động</CTAPrimary>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {jobs.map((j) => {
              const salaryLabel = formatSalary(j);
              return (
                <Link
                  key={j.id}
                  href={`/tuyen-dung/${j.slug}`}
                  className="group block bg-white rounded-2xl border border-neutral-200 p-6 hover:border-orange-300 hover:shadow-xl hover:-translate-y-1 transition-all"
                >
                  {j.department && (
                    <div className="text-xs font-bold uppercase tracking-wider text-purple-600 mb-2">
                      {j.department}
                    </div>
                  )}
                  <h3 className="text-lg font-bold text-neutral-900 mb-2 group-hover:text-orange-600 transition-colors line-clamp-2">
                    {j.title}
                  </h3>
                  <p className="text-sm text-neutral-600 mb-4 line-clamp-2">
                    {summarize(j.description)}
                  </p>
                  <div className="space-y-1.5 text-xs text-neutral-600 mb-4">
                    {j.location && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                        <span className="line-clamp-1">{j.location}</span>
                      </div>
                    )}
                    {j.type && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-purple-500" />
                        <span>{j.type}</span>
                      </div>
                    )}
                    {salaryLabel && (
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="h-3.5 w-3.5 shrink-0 text-green-600" />
                        <span className="line-clamp-1">{salaryLabel}</span>
                      </div>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600 group-hover:gap-2.5 transition-all">
                    Xem chi tiết
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </SectionBase>

      <SectionBase
        theme="soft-cool"
        eyebrow="LÝ DO CHỌN SATA ROBO"
        title="Vì sao gia nhập đội ngũ?"
        glowOrb={{ color: "purple", position: "bottom-left" }}
      >
        {/* Mobile + tablet: auto-rotating carousel */}
        <div className="lg:hidden">
          <AutoCarousel
            loop={false}
            align="center"
            slideClassName="flex-[0_0_100%]"
            showArrows={false}
            dotActiveClassName="bg-purple-600"
          >
            {PERKS.map((p) => (
              <div
                key={p.title}
                className="h-full bg-white p-6 rounded-2xl border border-neutral-200"
              >
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-purple-100 text-purple-700 mb-4">
                  <p.icon className="w-6 h-6" />
                </div>
                <h3 className={`${tokens.typography.heading.h5} mb-2`}>{p.title}</h3>
                <p className="text-sm text-neutral-600 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </AutoCarousel>
        </div>

        {/* Desktop: 4-col grid */}
        <div className="hidden lg:grid lg:grid-cols-4 gap-6">
          {PERKS.map((p) => (
            <div key={p.title} className="bg-white p-6 rounded-2xl border border-neutral-200">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-purple-100 text-purple-700 mb-4">
                <p.icon className="w-6 h-6" />
              </div>
              <h3 className={`${tokens.typography.heading.h5} mb-2`}>{p.title}</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </SectionBase>

      <SectionBase theme="white" eyebrow="LIÊN HỆ" title="HR Sata Robo" variant="narrow">
        <div className="flex flex-col items-center gap-3 max-w-xl mx-auto">
          <a
            href={`mailto:${HR_EMAIL}`}
            className="inline-flex items-center gap-2 text-neutral-700 hover:text-orange-600 transition-colors"
          >
            <Mail className="h-4 w-4 text-orange-500" />
            {HR_EMAIL}
          </a>
          <a
            href={`tel:${SATA_ROBO_PHONE.tho}`}
            className="inline-flex items-center gap-2 text-neutral-700 hover:text-orange-600 transition-colors"
          >
            <Phone className="h-4 w-4 text-orange-500" />
            {SATA_ROBO_PHONE.hien}
          </a>
        </div>
      </SectionBase>
    </>
  );
}
