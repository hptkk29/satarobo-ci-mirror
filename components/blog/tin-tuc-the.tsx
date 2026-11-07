import Image from "next/image";
import Link from "next/link";
import { FF } from "@/components/public/pub-fonts";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import type { TinTucItem } from "@/components/blog/tin-tuc-thuan";

const SIZES_THE = "(max-width: 560px) 100vw, (max-width: 980px) 50vw, 400px";

/**
 * Thẻ bài viết (`a.news-card` của News.dc.html). Không có hook nên dùng được ở cả server lẫn client.
 * `animation` nội tuyến giữ như artifact (thẻ vào cảnh khi đổi tab). Khác artifact: nhãn thể loại là chuyên mục
 * thật (có thể trống), nhãn bên phải thêm ngày đăng, bài chưa có ảnh bìa dùng khung chuyển màu + logo.
 */
export function TinTucThe({ post, anim = true }: { post: TinTucItem; anim?: boolean }) {
  const nhanPhai = [post.ngay, `${post.phutDoc} phút đọc`].filter(Boolean).join(" · ");
  return (
    <Link href={`/tin-tuc/${post.slug}`} className="news-card" style={anim ? { color: "var(--accT)", animation: "srp-kitIn .55s cubic-bezier(.2,.8,.2,1) both" } : { color: "var(--accT)" }}>
      <span className="thumb">
        {post.coverImage ? (
          <Image src={post.coverImage} alt={post.title} width={800} height={500} sizes={SIZES_THE} />
        ) : (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "var(--band)" }}>
            <PubAnh id="7f3174f1b3c85f9cd78c9295c2624fe4" alt="" aria-hidden="true" sizes="72px" style={{ width: "72px", height: "72px", borderRadius: "999px", objectFit: "contain" }} />
          </span>
        )}
      </span>
      <span style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "10px", flexGrow: 1 }}>
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {post.category ? <span className="tag">{post.category}</span> : <span />}
          <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
            {nhanPhai}
          </span>
        </span>
        <strong style={{ fontFamily: FF.unbounded, fontWeight: 600, fontSize: "17px", lineHeight: 1.4 }}>{post.title}</strong>
        {post.excerpt && <span style={{ color: "var(--muted)", fontSize: "14px" }}>{post.excerpt}</span>}
        <span style={{ marginTop: "auto", fontWeight: 700, color: "var(--accT)", fontSize: "14px" }}>Đọc tiếp →</span>
      </span>
    </Link>
  );
}

/** Thẻ "Bài viết liên quan" của NewsDetail.dc.html (gọn hơn thẻ danh sách: chỉ nhãn + tiêu đề). */
export function TinTucTheLienQuan({ post, chiSo }: { post: TinTucItem; chiSo: number }) {
  return (
    <Link href={`/tin-tuc/${post.slug}`} className={`news-card sv ${chiSo > 0 ? `d${chiSo + 1} ` : ""}a-deal`} style={{ color: "var(--accT)" }}>
      <span className="thumb">
        {post.coverImage ? (
          <Image src={post.coverImage} alt={post.title} width={800} height={500} sizes={SIZES_THE} />
        ) : (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: "var(--band)" }}>
            <PubAnh id="7f3174f1b3c85f9cd78c9295c2624fe4" alt="" aria-hidden="true" sizes="72px" style={{ width: "72px", height: "72px", borderRadius: "999px", objectFit: "contain" }} />
          </span>
        )}
      </span>
      <span style={{ padding: "16px", display: "grid", gap: "8px" }}>
        {post.category && (
          <span className="tag" style={{ justifySelf: "start" }}>
            {post.category}
          </span>
        )}
        <strong style={{ fontFamily: FF.unbounded, fontWeight: 600, fontSize: "16px", lineHeight: 1.4 }}>{post.title}</strong>
      </span>
    </Link>
  );
}
