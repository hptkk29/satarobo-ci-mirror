import { jsonLdScript } from "@/lib/seo/jsonld";

/** Thẻ JSON-LD (dữ liệu có cấu trúc). Đây là chỗ DUY NHẤT được dùng dangerouslySetInnerHTML (luật CLAUDE.md). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />;
}
