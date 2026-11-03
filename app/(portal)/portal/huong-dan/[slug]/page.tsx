// app/(portal)/portal/huong-dan/[slug]/page.tsx — trang chi tiết 1 bài
// hướng dẫn cổng PH. Nội dung tĩnh từ _content; slug lạ → notFound.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { GuideMarkdown } from "../_components/guide-markdown";
import { adjacentGuides, getGuide } from "../_content";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const guide = getGuide(slug);
  return {
    title: `${guide?.title ?? "Hướng dẫn"} | Cổng học viên Sata Robo`,
  };
}

export default async function PortalGuideDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const { prev, next } = adjacentGuides(slug);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/portal/huong-dan"
        className="mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Hướng dẫn sử dụng
      </Link>

      <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            {guide.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {guide.category} · {guide.description}
          </p>
        </div>
        {guide.pagePath ? (
          <Link
            href={guide.pagePath}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring outline-none"
          >
            Mở trang này
            <ExternalLink className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <GuideMarkdown content={guide.body} />
      </div>

      <nav className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
        {prev ? (
          <Link
            href={`/portal/huong-dan/${prev.slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring outline-none"
          >
            <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
            {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/portal/huong-dan/${next.slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring outline-none sm:ml-auto"
          >
            {next.title}
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
