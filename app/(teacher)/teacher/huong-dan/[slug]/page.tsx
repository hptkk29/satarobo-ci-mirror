// app/(teacher)/teacher/huong-dan/[slug]/page.tsx — trang chi tiết 1 bài
// hướng dẫn. Nội dung tĩnh từ _content; slug lạ → notFound.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { BackLink } from "../../_components/ui/back-link";
import { PageHeader } from "../../_components/ui/page-header";
import { GuideMarkdown } from "../_components/guide-markdown";
import { adjacentGuides, getGuide } from "../_content";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const guide = getGuide(slug);
  return {
    title: `${guide?.title ?? "Hướng dẫn"} | Giáo viên Sata Robo`,
  };
}

export default async function TeacherGuideDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const { prev, next } = adjacentGuides(slug);

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink
        href="/teacher/huong-dan"
        label="Hướng dẫn sử dụng"
        className="mb-4"
      />

      <PageHeader
        title={guide.title}
        subtitle={`${guide.category} · ${guide.description}`}
        actions={
          guide.pagePath ? (
            <Link
              href={guide.pagePath}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring outline-none"
            >
              Mở trang này
              <ExternalLink className="h-4 w-4" aria-hidden />
            </Link>
          ) : undefined
        }
      />

      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <GuideMarkdown content={guide.body} />
      </div>

      <nav className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
        {prev ? (
          <Link
            href={`/teacher/huong-dan/${prev.slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring outline-none"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" aria-hidden />
            {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/teacher/huong-dan/${next.slug}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring outline-none sm:ml-auto"
          >
            {next.title}
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
