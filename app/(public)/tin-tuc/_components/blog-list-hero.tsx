import Link from 'next/link'
import { Search } from 'lucide-react'
import { CATEGORY_DISPLAY } from '@/lib/blog-utils'

interface BlogListHeroProps {
  activeCategory?: string
  searchQuery?: string
}

const CATS = Object.entries(CATEGORY_DISPLAY)

export function BlogListHero({ activeCategory, searchQuery }: BlogListHeroProps) {
  return (
    <section
      className="overflow-hidden w-full"
      style={{ background: 'linear-gradient(160deg, #fff9f5 0%, #ffffff 50%, #f5f3ff 100%)' }}
    >
      <div className="container-site py-14 md:py-18 text-center max-w-3xl mx-auto">
        <span className="badge-orange mb-4 inline-block">Tin tức &amp; Kiến thức</span>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black leading-tight text-text-dark mb-4">
          Tin tức &amp; Kiến thức{' '}
          <span className="text-gradient-orange-purple">Robotics</span>
        </h1>
        <p className="text-lg text-text-muted mb-8">
          Cập nhật mới nhất từ Sata Robo + bài viết hữu ích cho phụ huynh và nhà trường
        </p>

        {/* Search bar */}
        <form action="/tin-tuc" method="GET" className="relative max-w-lg mx-auto mb-8">
          <input type="hidden" name="category" value={activeCategory ?? ''} />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted pointer-events-none" />
          <input
            type="text"
            name="q"
            defaultValue={searchQuery}
            placeholder="Tìm kiếm bài viết..."
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl border border-border bg-white shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-primary-orange/30 focus:border-primary-orange"
          />
          <button
            type="submit"
            className="absolute right-3 top-1/2 -translate-y-1/2 px-4 py-1.5 rounded-xl text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #F97316, #FBBF24)' }}
          >
            Tìm
          </button>
        </form>

        {/* Category tabs */}
        <div className="flex gap-2 flex-wrap justify-center">
          <Link
            href="/tin-tuc"
            className={`px-4 py-2 rounded-full text-sm font-bold transition border ${
              !activeCategory
                ? 'bg-primary-orange text-white border-primary-orange'
                : 'bg-white text-text-dark border-border hover:border-primary-orange hover:text-primary-orange'
            }`}
          >
            Tất cả
          </Link>
          {CATS.map(([slug, label]) => (
            <Link
              key={slug}
              href={`/tin-tuc?category=${slug}`}
              className={`px-4 py-2 rounded-full text-sm font-bold transition border ${
                activeCategory === slug
                  ? 'bg-primary-orange text-white border-primary-orange'
                  : 'bg-white text-text-dark border-border hover:border-primary-orange hover:text-primary-orange'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
