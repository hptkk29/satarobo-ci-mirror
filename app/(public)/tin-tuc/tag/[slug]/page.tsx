import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld'
import { POSTS_PER_PAGE } from '@/lib/blog-utils'
import { TinTucHero } from '@/components/blog/tin-tuc-khung'
import { SELECT_BAI_DANH_SACH, sangTinTucItem } from '@/components/blog/tin-tuc-du-lieu'
import { giaiMaTag } from '@/components/blog/tin-tuc-thuan'
import { DanhSachPhanTrang } from '../../_components/danh-sach-phan-trang'

const BASE_URL = 'https://satarobo.vn'

interface Params {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  // `giaiMaTag`: tham số có thể đã được giải mã sẵn; `%` lẻ không được làm trang nổ URIError.
  const tag = giaiMaTag(slug)
  const title = `#${tag} — Tin tức Sata Robo`
  const description = `Bài viết gắn tag #${tag} từ Sata Robo — Robotics & STEM.`

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/tin-tuc/tag/${slug}` },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/tin-tuc/tag/${slug}`,
      siteName: 'Sata Robo',
      locale: 'vi_VN',
      type: 'website',
    },
  }
}

export default async function TagPage({ params, searchParams }: Params) {
  const { slug } = await params
  const { page: pageStr } = await searchParams

  const tag = giaiMaTag(slug)

  const parsed = parseInt(pageStr ?? '1', 10)
  const currentPage = Number.isFinite(parsed) ? Math.max(1, parsed) : 1
  const skip = (currentPage - 1) * POSTS_PER_PAGE

  const where = { isPublished: true, tags: { has: tag } }

  const [rawPosts, total] = await Promise.all([
    db.news
      .findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        take: POSTS_PER_PAGE,
        skip,
        select: SELECT_BAI_DANH_SACH,
      })
      .catch(() => []),
    db.news.count({ where }).catch(() => 0),
  ])

  const posts = rawPosts.map(sangTinTucItem)

  if (posts.length === 0 && currentPage === 1) notFound()

  const totalPages = Math.ceil(total / POSTS_PER_PAGE)
  const baseHref = `/tin-tuc/tag/${slug}`

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: 'Trang chủ', url: '/' },
              { name: 'Tin tức', url: '/tin-tuc' },
              { name: `#${tag}`, url: `/tin-tuc/tag/${slug}` },
            ])
          ),
        }}
      />

      <TinTucHero
        duongDan={[{ ten: 'Tin tức', href: '/tin-tuc' }, { ten: `#${tag}` }]}
        nhan="Thẻ bài viết"
        tieuDe="Bài viết gắn thẻ"
        tieuDeNhan={`#${tag}`}
        moTa={`${total} bài viết gắn thẻ này.`}
      />

      <DanhSachPhanTrang
        posts={posts}
        currentPage={currentPage}
        totalPages={totalPages}
        baseHref={baseHref}
        tieuDeRong="Chưa có bài viết nào gắn thẻ này"
      />
    </>
  )
}
