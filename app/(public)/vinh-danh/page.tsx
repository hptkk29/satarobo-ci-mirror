import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { HonorHero } from "@/components/honors/hero";
import { HonorCEOQuote } from "@/components/honors/ceo-quote";
import { HonorSpotlight } from "@/components/honors/spotlight";
import { HonorStatsCounter } from "@/components/honors/stats-counter";
import { HonorCategoryGrid } from "@/components/honors/category-grid";
import { HonorTimeline } from "@/components/honors/timeline";

export const metadata: Metadata = {
  title: "Vinh danh nhân sự xuất sắc | Sata Robo",
  description:
    "Trang vinh danh những con người làm nên Sata Robo. Tri ân chính thức từ Ban Giám đốc dành cho các nhân sự đạt giải thưởng danh giá: Spark, Growth, Impact, Grand Champion.",
  alternates: { canonical: "https://satarobo.vn/vinh-danh" },
  openGraph: {
    title: "Vinh danh nhân sự xuất sắc | Sata Robo",
    description: "Tri ân từ Ban Giám đốc Sata Robo dành cho các nhân sự xuất sắc.",
    url: "https://satarobo.vn/vinh-danh",
    siteName: "Sata Robo",
  },
};

export const revalidate = 60;

const breadcrumb = breadcrumbJsonLd([
  { name: "Trang chủ", url: "/" },
  { name: "Vinh danh nhân sự", url: "/vinh-danh" },
]);

const EMPLOYEE_INCLUDE = {
  employee: {
    select: {
      id: true,
      fullName: true,
      jobTitle: true,
      avatarUrl: true,
      joinedAt: true,
    },
  },
} as const;

async function getHonorsPageData() {
  const [
    settings,
    ceoEmployee,
    featuredHonor,
    categoryCount,
    totalCount,
    allHonors,
    timeline,
  ] = await Promise.all([
    db.sitePageContent.findMany({ where: { pageKey: "honors" } }),
    db.employee.findFirst({
      where: { isCEO: true, isActive: true },
      select: { fullName: true, jobTitle: true, avatarUrl: true, bio: true },
    }),
    db.honor.findFirst({
      where: { isFeatured: true, isPublished: true },
      orderBy: { awardedAt: "desc" },
      include: EMPLOYEE_INCLUDE,
    }),
    db.honor.groupBy({
      by: ["category"],
      where: { isPublished: true },
      _count: { id: true },
    }),
    db.honor.count({ where: { isPublished: true } }),
    db.honor.findMany({
      where: { isPublished: true, isFeatured: false },
      orderBy: { displayOrder: "asc" },
      take: 8,
      include: EMPLOYEE_INCLUDE,
    }),
    db.timelineItem.findMany({
      where: { isPublished: true },
      orderBy: { occurredAt: "asc" },
    }),
  ]);

  const oldestTimeline = timeline[0];
  const companyYears = oldestTimeline
    ? new Date().getFullYear() - oldestTimeline.occurredAt.getFullYear()
    : 6;

  const config: Record<string, string> = {};
  settings.forEach((s) => {
    config[s.contentKey] = s.contentValue;
  });

  const categoryStats: Record<string, number> = {
    SPARK: 0,
    GROWTH: 0,
    IMPACT: 0,
    GRAND_CHAMPION: 0,
  };
  categoryCount.forEach((c) => {
    categoryStats[c.category] = c._count.id;
  });

  return {
    config,
    ceoEmployee,
    featuredHonor,
    categoryStats,
    totalHonors: totalCount,
    totalAwards: totalCount,
    companyYears,
    allHonors,
    timeline,
  };
}

export default async function HonorsPage() {
  const data = await getHonorsPageData();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumb) }}
      />

      <div className="bg-gray-50 py-4">
        <div className="container mx-auto px-4">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-sm text-gray-500"
          >
            <Link href="/" className="hover:text-[#F97316] transition-colors">
              Trang chủ
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-gray-800 font-medium">Vinh danh nhân sự</span>
          </nav>
        </div>
      </div>

      <main>
        <HonorHero
          title={data.config["hero-title"] || "Vinh danh nhân sự xuất sắc"}
          subtitle={data.config["hero-subtitle"] || "Tri ân từ Ban Giám đốc Sata Robo"}
        />

        <HonorCEOQuote
          quote={data.config["ceo-quote"] || ""}
          name={data.ceoEmployee?.fullName || data.config["ceo-name"] || "Hồ Đắc Phúc"}
          title={
            data.ceoEmployee?.jobTitle
              ? `${data.ceoEmployee.jobTitle} — Sata Robo`
              : data.config["ceo-title"] || "Tổng Giám đốc — Sata Robo"
          }
          avatarUrl={
            data.ceoEmployee?.avatarUrl ||
            data.config["ceo-avatar-url"] ||
            undefined
          }
        />

        {data.featuredHonor && <HonorSpotlight honor={data.featuredHonor} />}

        <HonorStatsCounter
          totalHonors={data.totalHonors}
          totalAwards={data.totalAwards}
          companyYears={data.companyYears}
        />

        <HonorCategoryGrid stats={data.categoryStats} previewHonors={data.allHonors} />

        {data.timeline.length > 0 && <HonorTimeline items={data.timeline} />}
      </main>
    </>
  );
}
