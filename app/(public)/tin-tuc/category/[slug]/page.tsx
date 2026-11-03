import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld'
import { POSTS_PER_PAGE, CATEGORY_DISPLAY } from '@/lib/blog-utils'
import { BlogCard } from '@/components/blog/blog-card'
import { BlogListHero } from '../../_components/blog-list-hero'
import { Pagination } from '../../_components/pagination'

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

  const currentPage = Math.max(1, parseInt(pageStr ?? '1', 10))
  const skip = (currentPage - 1) * POSTS_PER_PAGE

  const where = { isPublished: true, category: slug }

  const [rawPosts, total] = await Promise.all([
    db.news
      .findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        take: POSTS_PER_PAGE,
        skip,
        select: {
          slug: true,
          title: true,
          excerpt: true,
          coverImage: true,
          publishedAt: true,
          category: true,
        },
      })
      .catch(() => []),
    db.news.count({ where }).catch(() => 0),
  ])

  const posts = rawPosts.map((p) => ({
    ...p,
    readingTime: null,
    author: null,
  }))

  const totalPages = Math.ceil(total / POSTS_PER_PAGE)
  const featuredPost = currentPage === 1 ? posts[0] : null
  const gridPosts = featuredPost ? posts.slice(1) : posts
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

      <BlogListHero activeCategory={slug} />

      <section className="section-padding bg-white">
        <div className="container-site">
          {posts.length === 0 ? (
            <div className="text-center py-20 text-text-muted">
              <p className="text-lg font-semibold">Chưa có bài viết nào trong danh mục này</p>
              <p className="text-sm mt-2">Hãy quay lại sau!</p>
            </div>
          ) : (
            <>
              {featuredPost && (
                <div className="mb-10">
                  <BlogCard post={featuredPost} featured />
                </div>
              )}

              {gridPosts.length > 0 && (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {gridPosts.map((post) => (
                    <BlogCard key={post.slug} post={post} />
                  ))}
                </div>
              )}

              <Pagination currentPage={currentPage} totalPages={totalPages} baseHref={baseHref} />
            </>
          )}
        </div>
      </section>
    </>
  )
}
