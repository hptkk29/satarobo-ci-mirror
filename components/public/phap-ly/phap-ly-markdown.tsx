import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import Image from "next/image";
import type { Components } from "react-markdown";

// Hiển thị thân văn bản pháp lý (Markdown). Cùng bộ plugin với `components/blog/markdown-renderer.tsx`
// (gfm + raw + sanitize). Phần tử đầu ra khớp CSS của artifact `ChinhSach-*` (`.prose`, `.pol-table`,
// `.pol-note`…) nên KHÔNG thêm lớp bọc nào: văn bản nằm thẳng trong `<section className="pol-sec">`.
const thanhPhan: Components = {
  h1: () => null, // tiêu đề trang đã ở đầu trang
  a: ({ href, children }) => (
    <a
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) => {
    if (!src || typeof src !== "string") return null;
    return <Image src={src} alt={alt ?? ""} width={800} height={450} sizes="(max-width: 768px) 100vw, 768px" style={{ height: "auto", maxWidth: "100%" }} />;
  },
  // Bảng có ô dài đẩy tràn ngang ở 375px ⇒ khối `.pol-table` của artifact có sẵn vùng cuộn ngang.
  table: ({ children }) => (
    <div className="pol-table">
      <table>{children}</table>
    </div>
  ),
  // Trích dẫn trong văn bản pháp lý = ghi chú nổi bật (`.pol-note` của artifact), không phải khối trích dẫn dạng báo.
  blockquote: ({ children }) => <div className="pol-note">{children}</div>,
};

export function PhapLyMarkdown({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={thanhPhan}>
      {content}
    </ReactMarkdown>
  );
}
