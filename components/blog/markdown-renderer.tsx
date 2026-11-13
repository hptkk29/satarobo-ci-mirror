import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import Image from 'next/image'
import type { Components } from 'react-markdown'
import { rehypeIdMuc } from '@/components/blog/rehype-id-muc'

const mdComponents: Components = {
  // H1 ẩn — title đã render ở page level
  h1: () => null,
  img: ({ src, alt }) => {
    if (!src || typeof src !== 'string') return null
    return (
      <span className="block my-6">
        <Image
          src={src}
          alt={alt ?? ''}
          width={800}
          height={450}
          sizes="(max-width: 768px) 100vw, 768px"
          className="h-auto w-full rounded-2xl object-contain"
        />
      </span>
    )
  },
  a: ({ href, children }) => (
    <a
      href={href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      className="text-primary-orange underline underline-offset-2 hover:text-primary-orange-dark"
    >
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 overflow-x-auto text-sm my-6">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes('language-')
    if (isBlock) return <code className={className} {...props}>{children}</code>
    return (
      <code className="bg-orange-50 text-primary-orange px-1.5 py-0.5 rounded text-[0.875em] font-mono" {...props}>
        {children}
      </code>
    )
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-primary-orange pl-5 py-2 bg-soft-cream rounded-r-xl my-6 not-italic">
      {children}
    </blockquote>
  ),
  // Bảng GFM render được sẵn (remarkGfm + rehypeSanitize giữ thẻ table), nhưng `prose` KHÔNG
  // bọc wrapper cuộn ngang ⇒ bảng có ô dài đẩy tràn cả trang ở 375px. Chính sách chấm dứt
  // dịch vụ có bảng 2 cột với ô "Trước khi khai giảng (≥ 3 ngày làm việc)" — đúng ca đó.
  //
  // ⚠️ Phải đè Ở ĐÂY, không đè bằng `prose-table:*` ở `components/public/legal-page.tsx`:
  //    trang đó mở một <article class="prose"> rồi component này mở <article class="prose">
  //    LỒNG BÊN TRONG, nên lớp trong ghi đè lớp ngoài.
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto">
      <table className="my-0">{children}</table>
    </div>
  ),
}

// Biến thể "pub" cho giao diện public mới (bài tin tức): màu lấy từ token `.sr-pub` nên đổi theo
// sáng/tối; KHÔNG dùng màu cứng (`bg-soft-cream`, `bg-orange-50`, `text-primary-orange`) của biến
// thể mặc định — những màu đó vỡ ở chủ đề tối. Kiểu chữ của khối bài nằm ở `.sr-pub .prose` (pub.css).
const mdComponentsPub: Components = {
  ...mdComponents,
  a: ({ href, children }) => (
    <a
      href={href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
    >
      {children}
    </a>
  ),
  pre: ({ children }) => <pre className="pub-pre">{children}</pre>,
  code: ({ className, children, ...props }) => (
    <code className={className} {...props}>
      {children}
    </code>
  ),
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
}

interface MarkdownRendererProps {
  content: string
  /**
   * `mac-dinh` (giữ nguyên): bài của trang học / vinh danh / pháp lý. `pub`: giao diện public mới —
   * thêm `id` cho h2 (mục lục) và bảng màu theo token. Dùng ở phía SERVER.
   */
  variant?: 'mac-dinh' | 'pub'
}

export function MarkdownRenderer({ content, variant = 'mac-dinh' }: MarkdownRendererProps) {
  if (variant === 'pub') {
    return (
      <article className="prose max-w-none pub-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeIdMuc]}
          components={mdComponentsPub}
        >
          {content}
        </ReactMarkdown>
      </article>
    )
  }
  return (
    <article className="prose prose-lg max-w-none prose-headings:font-extrabold prose-headings:text-text-dark prose-p:text-text-muted prose-p:leading-relaxed prose-img:mx-auto prose-img:my-5 prose-img:h-auto prose-img:max-w-full prose-img:rounded-2xl prose-a:no-underline prose-pre:bg-transparent prose-pre:p-0 prose-blockquote:not-italic">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={mdComponents}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}
