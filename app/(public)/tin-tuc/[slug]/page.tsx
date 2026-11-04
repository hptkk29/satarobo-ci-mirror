import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Calendar, Tag, ArrowLeft, Newspaper } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import { ShareButtons } from "@/components/blog/share-buttons";

const BASE_URL = "https://satarobo.vn";

export const revalidate = 300; // ISR_DETAIL — chi tiết tin (convention list=60/detail=300, xem lib/isr.ts)

// PUB-08: dedup fetch giữa generateMetadata + page (cùng slug) trong 1 request.
const getNewsBySlug = cache((slug: string) =>
  db.news.findUnique({ where: { slug } }).catch(() => null),
);

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const posts = await db.news
    .findMany({ where: { isPublished: true }, select: { slug: true } })
    .catch(() => []);
  return posts.map((p) => ({ slug: p.slug }));
}

function formatVnDate(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = await getNewsBySlug(slug);

  if (!post) return {};

  const title = post.seoTitle ?? post.title;
  const description = post.seoDescription ?? post.excerpt;
  const image = post.coverImage;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/tin-tuc/${slug}`,
      siteName: "Sata Robo",
      ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: title }] } : {}),
      locale: "vi_VN",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
    alternates: { canonical: `${BASE_URL}/tin-tuc/${slug}` },
  };
}

export default async function NewsDetailPage({ params }: Params) {
  const { slug } = await params;

  const post = await getNewsBySlug(slug);

  if (!post || !post.isPublished) notFound();

  const related = await db.news
    .findMany({
      where: {
        isPublished: true,
        slug: { not: slug },
        ...(post.category ? { category: post.category } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: {
        slug: true,
        title: true,
        coverImage: true,
        publishedAt: true,
        excerpt: true,
      },
    })
    .catch(() => []);

  const postUrl = `${BASE_URL}/tin-tuc/${slug}`;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: "Trang chủ", url: "/" },
              { name: "Tin tức", url: "/tin-tuc" },
              { name: post.title, url: `/tin-tuc/${slug}` },
            ]),
          ),
        }}
      />

      <div className="container-site py-10 max-w-3xl mx-auto">
        <Link
          href="/tin-tuc"
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-primary-orange transition mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Quay lại tin tức
        </Link>

        {post.category && (
          <Badge className="bg-soft-cream text-primary-orange border border-primary-orange/30 font-semibold mb-4 inline-block">
            {post.category}
          </Badge>
        )}

        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-text-dark leading-tight mb-6">
          {post.title}
        </h1>

        <div className="flex items-center gap-4 text-sm text-text-muted flex-wrap mb-8 pb-6 border-b border-border">
          {post.publishedAt && (
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {formatVnDate(post.publishedAt)}
            </span>
          )}
          {post.tags.length > 0 && (
            <span className="flex items-center gap-1.5">
              <Tag className="w-4 h-4" />
              {post.tags.join(", ")}
            </span>
          )}
        </div>

        {post.coverImage && (
          <div className="relative h-[280px] sm:h-[400px] rounded-3xl overflow-hidden mb-10">
            <Image
              src={post.coverImage}
              alt={post.title}
              fill
              className="object-cover"
              priority
            />
          </div>
        )}

        <MarkdownRenderer content={post.content} />

        <div className="mt-8 pt-6 border-t border-border">
          <ShareButtons url={postUrl} title={post.title} />
        </div>

        {related.length > 0 && (
          <div className="mt-12 pt-8 border-t border-border">
            <h2 className="text-xl font-bold text-text-dark mb-4">Bài viết liên quan</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/tin-tuc/${r.slug}`}
                  className="block group rounded-xl border border-neutral-200 overflow-hidden hover:shadow-md transition-all"
                >
                  {r.coverImage ? (
                    <div className="relative aspect-video bg-neutral-100">
                      <Image
                        src={r.coverImage}
                        alt={r.title}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 33vw"
                      />
                    </div>
                  ) : (
                    <div className="aspect-video bg-gradient-to-br from-orange-50 to-purple-50 flex items-center justify-center text-orange-300">
                      <Newspaper className="h-12 w-12" aria-hidden="true" />
                    </div>
                  )}
                  <div className="p-3">
                    <p className="text-sm font-bold line-clamp-2 group-hover:text-orange-600 transition-colors">
                      {r.title}
                    </p>
                    {r.publishedAt && (
                      <p className="text-xs text-neutral-500 mt-1">
                        {formatVnDate(r.publishedAt)}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
