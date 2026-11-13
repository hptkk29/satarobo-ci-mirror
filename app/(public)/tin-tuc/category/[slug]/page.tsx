import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld'
import { POSTS_PER_PAGE, CATEGORY_DISPLAY } from '@/lib/blog-utils'
import { TinTucHero } from '@/components/blog/tin-tuc-khung'
import { SELECT_BAI_DANH_SACH, sangTinTucItem } from '@/components/blog/tin-tuc-du-lieu'
import { DanhSachPhanTrang } from '../../_components/danh-sach-phan-trang'

const BASE_URL = 'https://satarobo.vn'

interface Params {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}

export async function generateStaticParams() {
  return Object.keys(CATEGORY_DISPLAY).map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const label = CATEGORY_DISPLAY[slug]
  if (!label) return {}

  const title = `${label} — Tin tức Sata Robo`
  const description = `Tổng hợp bài viết chủ đề ${label} từ Sata Robo — Tin tức, kiến thức Robotics & STEM hữu ích.`

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/tin-tuc/category/${slug}` },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/tin-tuc/category/${slug}`,
      siteName: 'Sata Robo',
      locale: 'vi_VN',
      type: 'website',
    },
  }
}

export default async function CategoryPage({ params, searchParams }: Params) {
  const { slug } = await params
  const { page: pageStr } = await searchParams

  const label = CATEGORY_DISPLAY[slug]
  if (!label) notFound()

  const parsed = parseInt(pageStr ?? '1', 10)
  const currentPage = Number.isFinite(parsed) ? Math.max(1, parsed) : 1
  const skip = (currentPage - 1) * POSTS_PER_PAGE

  const where = { isPublished: true, category: slug }

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
  const totalPages = Math.ceil(total / POSTS_PER_PAGE)
  const baseHref = `/tin-tuc/category/${slug}`

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: 'Trang chủ', url: '/' },
              { name: 'Tin tức', url: '/tin-tuc' },
              { name: label, url: `/tin-tuc/category/${slug}` },
            ])
          ),
        }}
      />

      <TinTucHero
        duongDan={[{ ten: 'Tin tức', href: '/tin-tuc' }, { ten: label }]}
        nhan="Chuyên mục"
        tieuDe="Tin tức"
        tieuDeNhan={label}
        moTa={`Tổng hợp bài viết chủ đề ${label} từ Sata Robo — Tin tức, kiến thức Robotics & STEM hữu ích.`}
      />

      <DanhSachPhanTrang
        posts={posts}
        currentPage={currentPage}
        totalPages={totalPages}
        baseHref={baseHref}
        tieuDeRong="Chưa có bài viết nào trong danh mục này"
      />
    </>
  )
}
