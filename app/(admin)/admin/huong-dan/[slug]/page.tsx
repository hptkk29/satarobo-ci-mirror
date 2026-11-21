// app/(admin)/admin/huong-dan/[slug]/page.tsx — trang chi tiết 1 bài hướng dẫn
// site admin. Nội dung tĩnh từ _content; slug lạ → notFound.
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
    title: `${guide?.title ?? "Hướng dẫn"} | Sata Robo Admin`,
  };
}

export default async function AdminGuideDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const { prev, next } = adjacentGuides(slug);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/huong-dan"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Hướng dẫn sử dụng
      </Link>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">{guide.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {guide.category} · {guide.description}
          </p>
        </div>
        {guide.pagePath ? (
          <Link
            href={guide.pagePath}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            Mở trang này
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <GuideMarkdown content={guide.body} />
      </div>

      <nav className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
        {prev ? (
          <Link
            href={`/huong-dan/${prev.slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" aria-hidden />
            {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/huong-dan/${next.slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted sm:ml-auto"
          >
            {next.title}
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
