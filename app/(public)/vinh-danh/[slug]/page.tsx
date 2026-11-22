import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Trophy } from "lucide-react";
import { db } from "@/lib/db";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import { ShareButtons } from "@/components/blog/share-buttons";
import { HonorMasonryGrid } from "@/components/honors/masonry-grid";
import { CATEGORY_META, CATEGORY_SLUG_MAP } from "@/lib/honors/category-meta";
import { getHonorView } from "@/lib/honors/honor-view";
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld';
import { PersonSchema } from "@/components/seo/person-schema";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  // Category page?
  const categoryEnum = CATEGORY_SLUG_MAP[slug];
  if (categoryEnum) {
    const meta = CATEGORY_META[categoryEnum];
    return {
      title: `${meta.title} — Vinh danh | Sata Robo`,
      description: meta.description,
      alternates: { canonical: `https://satarobo.vn/vinh-danh/${slug}` },
    };
  }

  // Honor person page
  const honor = await db.honor.findUnique({
    where: { slug },
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
  if (!honor) return { title: "Không tìm thấy | Sata Robo" };
  const view = getHonorView(honor);

  return {
    title: `${view.fullName} — ${honor.awardName} | Sata Robo`,
    description:
      honor.shortBio || `${view.fullName} — ${view.jobTitle}. ${honor.awardName}.`,
    alternates: { canonical: `https://satarobo.vn/vinh-danh/${slug}` },
    openGraph: {
      title: `${view.fullName} — ${honor.awardName}`,
      description: honor.shortBio || "",
      url: `https://satarobo.vn/vinh-danh/${slug}`,
      siteName: "Sata Robo",
      images: [
        {
          url: `https://satarobo.vn/vinh-danh/${slug}/og`,
          width: 1200,
          height: 630,
        },
      ],
    },
  };
}

export async function generateStaticParams() {
  // PUB-03: /vinh-danh đang bị ẩn cứng (app/(public)/vinh-danh/layout.tsx gọi notFound()).
  // Trả [] để KHÔNG query DB lúc build cho trang không bao giờ render. Khi mở lại section
  // (xóa layout ẩn), khôi phục đoạn bên dưới.
  return [];
  // const honors = await db.honor
  //   .findMany({ where: { isPublished: true }, select: { slug: true } })
  //   .catch(() => []);
  // return [
  //   ...Object.keys(CATEGORY_SLUG_MAP).map((slug) => ({ slug })),
  //   ...honors.map((h) => ({ slug: h.slug })),
  // ];
}

export const revalidate = 300; // ISR_DETAIL (convention list=60/detail=300, xem lib/isr.ts)

export default async function VinhDanhSlugPage({ params }: Props) {
  const { slug } = await params;

  // ─── Branch 1: Category page ───────────────────────────────────────────────
  const categoryEnum = CATEGORY_SLUG_MAP[slug];
  if (categoryEnum) {
    const meta = CATEGORY_META[categoryEnum];
    const Icon = meta.icon;

    const honors = await db.honor.findMany({
      where: { category: categoryEnum, isPublished: true },
      orderBy: [{ displayOrder: "asc" }, { awardedAt: "desc" }],
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

    const categoryBreadcrumb = breadcrumbJsonLd([
      { name: "Trang chủ", url: "/" },
      { name: "Vinh danh nhân sự", url: "/vinh-danh" },
      { name: meta.title, url: `/vinh-danh/${slug}` },
    ]);

    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(categoryBreadcrumb) }}
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
              <span className="text-gray-800 font-medium">{meta.title}</span>
            </nav>
          </div>
        </div>

        <main className="container max-w-6xl mx-auto px-4 py-12">
          <div className="text-center mb-12">
            <div
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-4"
              style={{ backgroundColor: meta.bgColor, color: meta.textColor }}
            >
              <Icon className="w-5 h-5" />
              <span className="font-semibold">{meta.title}</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">{meta.title}</h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">{meta.description}</p>
          </div>

          {honors.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p>Chưa có nhân sự nào trong hạng mục này.</p>
              <p className="text-sm mt-2">
                Sata Robo đang tìm kiếm những người xứng đáng tiếp theo.
              </p>
            </div>
          ) : (
            <HonorMasonryGrid honors={honors} />
          )}
        </main>
      </>
    );
  }

  // ─── Branch 2: Person page ─────────────────────────────────────────────────
  const honor = await db.honor.findUnique({
    where: { slug },
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
  if (!honor || !honor.isPublished) notFound();

  const meta = CATEGORY_META[honor.category];
  const Icon = meta.icon;
  const categorySlug = meta.slug;
  const view = getHonorView(honor);

  const personBreadcrumb = breadcrumbJsonLd([
    { name: "Trang chủ", url: "/" },
    { name: "Vinh danh nhân sự", url: "/vinh-danh" },
    { name: meta.title, url: `/vinh-danh/${categorySlug}` },
    { name: view.fullName, url: `/vinh-danh/${slug}` },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(personBreadcrumb) }}
      />
      <PersonSchema honor={honor} />

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
            <Link
              href={`/vinh-danh/${categorySlug}`}
              className="hover:text-[#F97316] transition-colors"
            >
              {meta.title}
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-gray-800 font-medium truncate max-w-[200px]">
              {view.fullName}
            </span>
          </nav>
        </div>
      </div>

      <main className="container max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          {view.avatarUrl ? (
            <div className="w-40 h-40 rounded-full overflow-hidden mx-auto mb-6 ring-4 ring-orange-200">
              <Image
                src={view.avatarUrl}
                alt={view.fullName}
                width={200}
                height={200}
                className="w-full h-full object-cover"
                priority
              />
            </div>
          ) : (
            <div
              className="w-40 h-40 rounded-full flex items-center justify-center mx-auto mb-6 ring-4 ring-orange-200 text-5xl font-bold text-white"
              style={{ backgroundColor: meta.accentColor }}
            >
              {view.fullName.charAt(0)}
            </div>
          )}

          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-4"
            style={{ backgroundColor: meta.bgColor, color: meta.textColor }}
          >
            <Icon className="w-5 h-5" />
            <span className="font-semibold text-sm">{honor.awardName}</span>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold mb-2">{view.fullName}</h1>
          <p className="text-lg text-gray-600">
            {view.jobTitle}
            {view.years != null && view.years > 0 && ` · ${view.years} năm gắn bó`}
          </p>
        </div>

        {honor.pullQuote && (
          <blockquote className="my-12 px-8 py-6 border-l-4 border-orange-500 bg-orange-50 rounded-r-lg">
            <p className="text-xl italic text-gray-800 leading-relaxed">
              &ldquo;{honor.pullQuote}&rdquo;
            </p>
            <footer className="mt-3 text-sm text-gray-600">— {view.fullName}</footer>
          </blockquote>
        )}

        <div className="prose prose-lg max-w-none mb-12">
          <MarkdownRenderer content={honor.story} />
        </div>

        {honor.achievements && (
          <div className="bg-gray-50 rounded-xl p-6 mb-12">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-orange-500" />
              Thành tựu nổi bật
            </h2>
            <div className="prose prose-sm max-w-none">
              <MarkdownRenderer content={honor.achievements} />
            </div>
          </div>
        )}

        <div className="border-t border-gray-200 pt-8">
          <ShareButtons
            url={`https://satarobo.vn/vinh-danh/${slug}`}
            title={`${view.fullName} — ${honor.awardName} | Sata Robo`}
          />
        </div>
      </main>
    </>
  );
}
