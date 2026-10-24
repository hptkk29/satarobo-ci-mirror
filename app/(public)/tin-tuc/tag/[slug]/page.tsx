import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { breadcrumbJsonLd, jsonLdScript } from '@/lib/seo/jsonld'
import { POSTS_PER_PAGE } from '@/lib/blog-utils'
import { BlogCard } from '@/components/blog/blog-card'
import { Pagination } from '../../_components/pagination'

const BASE_URL = 'https://satarobo.vn'

interface Params {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const tag = decodeURIComponent(slug)
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
  const tag = decodeURIComponent(slug)

  const currentPage = Math.max(1, parseInt(pageStr ?? '1', 10))
  const skip = (currentPage - 1) * POSTS_PER_PAGE

  const where = { isPublished: true, tags: { has: tag } }

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

  if (posts.length === 0 && currentPage === 1) notFound()

  const totalPages = Math.ceil(total / POSTS_PER_PAGE)
  const featuredPost = currentPage === 1 ? posts[0] : null
  const gridPosts = featuredPost ? posts.slice(1) : posts
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

      {/* Header */}
      <section
        className="overflow-hidden w-full"
        style={{ background: 'linear-gradient(160deg, #fff9f5 0%, #ffffff 50%, #f5f3ff 100%)' }}
      >
        <div className="container-site py-14 md:py-18 text-center max-w-2xl mx-auto">
          <span className="badge-orange mb-4 inline-block">Tag</span>
          <h1 className="text-3xl sm:text-4xl font-black text-text-dark leading-tight">
            #{tag}
          </h1>
          <p className="text-text-muted mt-3">
            {total} bài viết gắn tag này
          </p>
        </div>
      </section>

      <section className="section-padding bg-white">
        <div className="container-site">
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
        </div>
      </section>
    </>
  )
}
