import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import Image from "next/image";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import Link from "next/link";
import { db } from "@/lib/db";
import { calcReadingTime } from "@/lib/blog-utils";
import { blogPostingJsonLd, breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import { ShareButtons } from "@/components/blog/share-buttons";
import { TinTucTheLienQuan } from "@/components/blog/tin-tuc-the";
import { CtaDocXong, DuongDan } from "@/components/blog/tin-tuc-khung";
import { SELECT_BAI_DANH_SACH, sangTinTucItem } from "@/components/blog/tin-tuc-du-lieu";
import { dinhDangNgay, duongDanTag, tachMucLuc } from "@/components/blog/tin-tuc-thuan";

const BASE_URL = "https://satarobo.vn";

export const revalidate = 300; // ISR_DETAIL — chi tiết tin (convention list=60/detail=300, xem lib/isr.ts)

// PUB-08: dedup fetch giữa generateMetadata + page (cùng slug) trong 1 request.
const getNewsBySlug = cache((slug: string) =>
  db.news.findUnique({ where: { slug } }).catch(() => null),
);

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const posts = await db.news
    .findMany({ where: { isPublished: true }, select: { slug: true } })
    .catch(() => []);
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = await getNewsBySlug(slug);

  if (!post) return {};

  const title = post.seoTitle ?? post.title;
  const description = post.seoDescription ?? post.excerpt;
  const image = post.coverImage;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/tin-tuc/${slug}`,
      siteName: "Sata Robo",
      ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: title }] } : {}),
      locale: "vi_VN",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
    alternates: { canonical: `${BASE_URL}/tin-tuc/${slug}` },
  };
}

export default async function NewsDetailPage({ params }: Params) {
  const { slug } = await params;

  const post = await getNewsBySlug(slug);

  if (!post || !post.isPublished) notFound();

  // Bài liên quan + bài trước/sau: ba câu độc lập ⇒ chạy song song.
  const [related, baiTruoc, baiSau] = await Promise.all([
    db.news
      .findMany({
        where: {
          isPublished: true,
          slug: { not: slug },
          ...(post.category ? { category: post.category } : {}),
        },
        orderBy: { publishedAt: "desc" },
        take: 3,
        select: SELECT_BAI_DANH_SACH,
      })
      .catch(() => []),
    post.publishedAt
      ? db.news
          .findFirst({
            where: { isPublished: true, slug: { not: slug }, publishedAt: { lt: post.publishedAt } },
            orderBy: { publishedAt: "desc" },
            select: { slug: true, title: true },
          })
          .catch(() => null)
      : null,
    post.publishedAt
      ? db.news
          .findFirst({
            where: { isPublished: true, slug: { not: slug }, publishedAt: { gt: post.publishedAt } },
            orderBy: { publishedAt: "asc" },
            select: { slug: true, title: true },
          })
          .catch(() => null)
      : null,
  ]);

  const baiLienQuan = related.map(sangTinTucItem);

  const postUrl = `${BASE_URL}/tin-tuc/${slug}`;
  const phutDoc = calcReadingTime(post.content);
  const nhanMeta = [dinhDangNgay(post.publishedAt), `${phutDoc} phút đọc`].filter(Boolean).join(" · ");
  const mucLuc = tachMucLuc(post.content);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: "Trang chủ", url: "/" },
              { name: "Tin tức", url: "/tin-tuc" },
              { name: post.title, url: `/tin-tuc/${slug}` },
            ]),
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            blogPostingJsonLd({
              title: post.title,
              slug,
              excerpt: post.excerpt,
              coverImage: post.coverImage,
              publishedAt: post.publishedAt,
              updatedAt: post.updatedAt,
              author: { name: null },
              category: post.category,
            }),
          ),
        }}
      />

      <header className="gridbg" style={{ borderBottom: "1px solid var(--line)", position: "relative", overflow: "hidden" }}>
        <div className="glow" aria-hidden="true" style={{ width: 640, height: 640, right: -200, top: -260 }} />
        <div className="wrap" style={{ maxWidth: 1100, paddingTop: "clamp(40px,5vw,72px)", paddingBottom: 28, position: "relative" }}>
          <DuongDan lop="load2" muc={[{ ten: "Tin tức", href: "/tin-tuc" }, { ten: post.title }]} />
          <div className="load2" style={{ maxWidth: 860 }}>
            {post.category && <span className="tag">{post.category}</span>}
            <h1 style={{ marginTop: 14, fontSize: "clamp(28px,3.4vw,48px)", lineHeight: 1.18 }}>{post.title}</h1>
            <p className="lead" style={{ margin: "16px 0 0", fontSize: "clamp(16px,1.2vw,19px)", color: "var(--muted)" }}>
              {post.excerpt}
            </p>
          </div>
          <div className="load3" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, marginTop: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <PubAnh id="7f3174f1b3c85f9cd78c9295c2624fe4" alt="" sizes="44px" style={{ width: "44px", height: "44px", borderRadius: "999px" }} />
              <div>
                <strong>Sata Robo</strong>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                  {nhanMeta}
                </div>
              </div>
            </div>
            <ShareButtons url={postUrl} title={post.title} />
          </div>
        </div>
      </header>

      {post.coverImage && (
        <div className="wrap" style={{ maxWidth: 1100, marginTop: 28 }}>
          <figure
            className="sv a-blur par"
            style={{ margin: 0, borderRadius: 24, overflow: "hidden", height: "clamp(240px,40vw,520px)", boxShadow: "0 30px 60px var(--shadow)", position: "relative" }}
          >
            <Image src={post.coverImage} alt={post.title} fill priority sizes="(max-width: 1100px) 100vw, 1100px" style={{ objectFit: "cover" }} />
          </figure>
        </div>
      )}

      <section className="sec" style={{ paddingTop: 40 }}>
        <div className="wrap" style={{ maxWidth: 1100 }}>
          <div className="article-grid">
            <div style={{ minWidth: 0 }}>
              <MarkdownRenderer content={post.content} variant="pub" />

              <aside className="inline-cta sv a-iris">
                <PubAnh id="21be53cabd4ac017cdbde87433593cfb" className="float" alt="" aria-hidden="true" style={{ height: "auto", width: "90px", flexShrink: 0 }} sizes="90px" />
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>Muốn con thử học Robotics?</p>
                  <p style={{ margin: "4px 0 12px", color: "#f3e4ff", fontSize: 14 }}>
                    Buổi học thử 1-1 miễn phí – giáo viên đánh giá và gợi ý lộ trình phù hợp với con.
                  </p>
                  <Link href="/lien-he?free-trial=true" className="btn btn-acc">
                    Đặt buổi học thử
                  </Link>
                </div>
              </aside>

              {post.tags.length > 0 && (
                <div className="tags">
                  {post.tags.map((tag) => (
                    <Link key={tag} href={duongDanTag(tag)} className="chip" style={{ textDecoration: "none", color: "inherit" }}>
                      #{tag}
                    </Link>
                  ))}
                </div>
              )}

              <div className="author sv a-blur">
                <PubAnh id="7f3174f1b3c85f9cd78c9295c2624fe4" alt="" sizes="56px" />
                <div>
                  <strong>Sata Robo</strong>
                  <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 14 }}>
                    Cập nhật sự kiện, khoá học và câu chuyện học viên tại Sata Robo.
                  </p>
                </div>
              </div>

              {(baiTruoc || baiSau) && (
                <nav className="prevnext" aria-label="Bài trước và bài sau">
                  {baiTruoc ? (
                    <Link href={`/tin-tuc/${baiTruoc.slug}`}>
                      <small>← Bài trước</small>
                      <b>{baiTruoc.title}</b>
                    </Link>
                  ) : (
                    <span />
                  )}
                  {baiSau ? (
                    <Link href={`/tin-tuc/${baiSau.slug}`} style={{ textAlign: "right" }}>
                      <small>Bài sau →</small>
                      <b>{baiSau.title}</b>
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </div>

            <aside className="side">
              {mucLuc.length >= 2 && (
                <nav className="toc card" aria-label="Mục lục">
                  <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                    Mục lục
                  </span>
                  <ol>
                    {mucLuc.map((m) => (
                      <li key={m.id}>
                        <a href={`#${m.id}`}>{m.text}</a>
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
              <div className="card side-cta">
                <PubAnh id="214f70bfc7cb9a92126b0a2e6207c48a" className="float" alt="" aria-hidden="true" style={{ height: "auto", width: "90px", margin: "0 auto" }} sizes="90px" />
                <p style={{ margin: 0, fontWeight: 700 }}>Học thử 1-1 miễn phí</p>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>Con tự lắp 1 robot và cho nó chạy.</p>
                <Link href="/lien-he?free-trial=true" className="btn btn-acc" style={{ width: "100%" }}>
                  Đăng ký ngay
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {baiLienQuan.length > 0 && (
        <section className="sec gridbg" style={{ backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
          <div className="wrap" style={{ maxWidth: 1100 }}>
            <div className="head2 sv a-mask">
              <div>
                <span className="label mono">
                  <b>[✦]</b>{" "}
                  Đọc tiếp
                </span>
                <h2>
                  Bài viết <span className="grad">liên quan</span>
                </h2>
              </div>
              <span />
              <PubAnh id="9befff8c7810fdf04d94f687c7c23e67" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{ right: "0", top: "-124px", width: "112px", height: "auto" }} sizes="112px" />
            </div>
            <div className="g3">
              {baiLienQuan.map((p, i) => (
                <TinTucTheLienQuan key={p.slug} post={p} chiSo={i} />
              ))}
            </div>
          </div>
        </section>
      )}

      <CtaDocXong tieuDe="Đọc xong rồi, cho con thử thật nhé!" />
    </>
  );
}
