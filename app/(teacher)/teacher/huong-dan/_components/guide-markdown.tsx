// Renderer markdown cho bộ hướng dẫn site GV. KHÔNG dùng components/blog/
// markdown-renderer: bản blog gắn token màu site public (primary-orange,
// soft-cream, text-dark) — sai nhận diện + vỡ dark mode dưới .teacher-root.
// Ở đây chỉ dùng token semantic (foreground/muted/border/primary) nên tự đổi
// theo Sáng/Tối của site GV.
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const mdComponents: Components = {
  // H1 ẩn — tiêu đề đã render ở PageHeader của trang chi tiết.
  h1: () => null,
  h2: ({ children }) => (
    <h2 className="mt-8 border-b border-border pb-2 text-lg font-bold text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 text-base font-bold text-foreground">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="my-3 text-sm leading-relaxed text-foreground/90">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90">
      {children}
    </ol>
  ),
  a: ({ href, children }) => {
    const url = href ?? "#";
    if (url.startsWith("/")) {
      return (
        <Link
          href={url}
          className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
        >
          {children}
        </Link>
      );
    }
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
      >
        {children}
      </a>
    );
  },
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 rounded-r-lg border-l-4 border-primary bg-muted/60 px-4 py-2 text-sm [&_p]:my-1">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl bg-muted p-4 text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-border">
      <table className="min-w-[560px] w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-2 text-left text-xs font-bold text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-3 py-2 align-top text-foreground/90 last:border-b-0">
      {children}
    </td>
  ),
  hr: () => <hr className="my-6 border-border" />,
};

export function GuideMarkdown({ content }: { content: string }) {
  return (
    <article>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </article>
  );
}
