import { promises as fs } from "fs";
import path from "path";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { HeroMinimal } from "@/components/design-system/heroes/hero-minimal";
import { SectionBase } from "@/components/design-system/sections/section-base";
import { tokens } from "@/lib/design-tokens";

// PUB-20 — shell chung 3 trang legal (đọc content/legal/<slug>.md → breadcrumb + hero +
// markdown). Metadata giữ ở từng page.tsx (Next yêu cầu export tại route).
export async function LegalPage({
  slug,
  title,
  subtitle,
  breadcrumbLabel,
  eyebrow = "PHÁP LÝ",
}: {
  slug: string;
  title: string;
  subtitle: string;
  breadcrumbLabel: string;
  eyebrow?: string;
}) {
  const filePath = path.join(process.cwd(), "content", "legal", `${slug}.md`);
  const content = await fs.readFile(filePath, "utf-8");
  const breadcrumb = breadcrumbJsonLd([
    { name: "Trang chủ", url: "/" },
    { name: breadcrumbLabel, url: `/${slug}` },
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
            <Link href="/" className="hover:text-orange-600 transition-colors">Trang chủ</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-neutral-800 font-medium">{breadcrumbLabel}</span>
          </nav>
        </div>
      </div>

      <HeroMinimal eyebrow={eyebrow} title={title} subtitle={subtitle} />

      <SectionBase theme="white" variant="narrow">
        <article className="prose prose-lg max-w-none">
          <MarkdownRenderer content={content} />
        </article>
      </SectionBase>
    </>
  );
}
