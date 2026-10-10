import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, Calendar, Tag as TagIcon, Newspaper, Star } from "lucide-react";
import { db } from "@/lib/db";
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { HeroMinimal } from "@/components/design-system/heroes/hero-minimal";
import { SectionBase } from "@/components/design-system/sections/section-base";
import { tokens } from "@/lib/design-tokens";

const BASE_URL = "https://satarobo.vn";

export const metadata: Metadata = {
  title: "Tin tức & Sự kiện — Sata Robo",
  description:
    "Cập nhật tin tức mới nhất từ Sata Robo — sự kiện, khoá học, ưu đãi và thông tin Cuộc thi Sáng tạo Robotics 2026.",
  alternates: { canonical: `${BASE_URL}/tin-tuc` },
  openGraph: {
    title: "Tin tức & Sự kiện — Sata Robo",
    description: "Cập nhật tin tức từ Sata Robo Đà Nẵng.",
    url: `${BASE_URL}/tin-tuc`,
    siteName: "Sata Robo",
  },
};

export const revalidate = 60;

function formatDate(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export default async function NewsListPage() {
  const news = await db.news
    .findMany({
      where: { isPublished: true },
      orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }, { displayOrder: "asc" }],
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        coverImage: true,
        category: true,
        tags: true,
        publishedAt: true,
        isFeatured: true,
      },
    })
    .catch(() => []);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: "Trang chủ", url: "/" },
              { name: "Tin tức", url: "/tin-tuc" },
            ]),
          ),
        }}
      />

      <div className="bg-white border-b border-neutral-200 py-3">
        <div className={tokens.spacing.container}>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-neutral-500">
            <Link href="/" className="hover:text-orange-600 transition-colors">
              Trang chủ
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-neutral-800 font-medium">Tin tức</span>
          </nav>
        </div>
      </div>

      <HeroMinimal
        eyebrow="TIN TỨC"
        title="Cập nhật từ Sata Robo"
        subtitle="Sự kiện, khoá học mới, ưu đãi và thông tin Cuộc thi Robotics 2026"
      />

      <SectionBase theme="white">
        {news.length === 0 ? (
          <div className="text-center py-20 text-neutral-500">
            <p className="text-lg font-semibold">Chưa có bài viết nào</p>
            <p className="text-sm mt-2">Hãy quay lại sau!</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
            {news.map((post) => (
              <Link
                key={post.id}
                href={`/tin-tuc/${post.slug}`}
                className="group block bg-white rounded-2xl border border-neutral-200 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all"
              >
                <div className="aspect-video relative overflow-hidden bg-gradient-to-br from-orange-50 to-purple-50">
                  {post.coverImage ? (
                    <Image
                      src={post.coverImage}
                      alt={post.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                      sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-orange-300">
                      <Newspaper className="h-16 w-16" aria-hidden="true" />
                    </div>
                  )}
                  {post.isFeatured && (
                    <div className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 bg-orange-500 text-white text-xs font-bold rounded-full shadow-md">
                      <Star className="h-3 w-3 fill-current" />
                      Nổi bật
                    </div>
                  )}
                </div>
                <div className="p-5">
                  {post.category && (
                    <div className="text-xs font-bold uppercase tracking-wider text-purple-600 mb-2">
                      {post.category}
                    </div>
                  )}
                  <h3 className="text-lg font-bold text-neutral-900 mb-2 line-clamp-2 group-hover:text-orange-600 transition-colors">
                    {post.title}
                  </h3>
                  <p className="text-sm text-neutral-600 line-clamp-3 mb-4">{post.excerpt}</p>
                  <div className="flex items-center gap-3 text-xs text-neutral-500">
                    {post.publishedAt && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDate(post.publishedAt)}
                      </span>
                    )}
                    {post.tags.length > 0 && (
                      <span className="flex items-center gap-1">
                        <TagIcon className="h-3.5 w-3.5" />
                        {post.tags[0]}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionBase>
    </>
  );
}
