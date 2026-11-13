import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { HonorUniformGrid } from "@/components/honors/uniform-grid";
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';

export const metadata: Metadata = {
  title: "Tất cả nhân sự được vinh danh | Sata Robo",
  description: "Danh sách đầy đủ các nhân sự xuất sắc của Sata Robo qua các năm.",
  alternates: { canonical: "https://satarobo.vn/vinh-danh/tat-ca" },
  // PUB-22: bổ sung openGraph khớp các trang sibling.
  openGraph: {
    title: "Tất cả nhân sự được vinh danh | Sata Robo",
    description: "Danh sách đầy đủ các nhân sự xuất sắc của Sata Robo qua các năm.",
    url: "https://satarobo.vn/vinh-danh/tat-ca",
    siteName: "Sata Robo",
    locale: "vi_VN",
    type: "website",
  },
};

export const revalidate = 60;

const breadcrumb = breadcrumbJsonLd([
  { name: "Trang chủ", url: "/" },
  { name: "Vinh danh nhân sự", url: "/vinh-danh" },
  { name: "Tất cả", url: "/vinh-danh/tat-ca" },
]);

export default async function AllHonorsPage() {
  const honors = await db.honor.findMany({
    where: { isPublished: true },
    orderBy: [{ awardedAt: "desc" }, { displayOrder: "asc" }],
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          jobTitle: true,
          avatarUrl: true,
          joinedAt: true,
        },
      },
    },
  });

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
            <Link href="/vinh-danh" className="hover:text-[#F97316] transition-colors">
              Vinh danh nhân sự
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-gray-800 font-medium">Tất cả</span>
          </nav>
        </div>
      </div>

      <main className="container max-w-6xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Tất cả nhân sự được vinh danh</h1>
          <p className="text-gray-600">
            Danh sách đầy đủ {honors.length} nhân sự xuất sắc của Sata Robo qua các năm.
          </p>
        </div>

        <HonorUniformGrid honors={honors} />
      </main>
    </>
  );
}
