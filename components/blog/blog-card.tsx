import Image from 'next/image'
import Link from 'next/link'
import { Calendar, Clock, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/blog-utils'
import { CATEGORY_DISPLAY } from '@/lib/blog-utils'

export interface BlogCardPost {
  slug: string
  title: string
  excerpt: string | null
  coverImage: string | null
  publishedAt: Date | null
  category: string | null
  readingTime: number | null
  author: { name: string | null } | null
}

interface BlogCardProps {
  post: BlogCardPost
  featured?: boolean
}

export function BlogCard({ post, featured = false }: BlogCardProps) {
  const catLabel = post.category ? CATEGORY_DISPLAY[post.category] : null

  return (
    <Link
      href={`/tin-tuc/${post.slug}`}
      className={`group card-base overflow-hidden flex flex-col hover:-translate-y-1 transition-all duration-200 ${
        featured ? 'md:flex-row' : ''
      }`}
    >
      {/* Cover image */}
      <div
        className={`relative bg-gradient-to-br from-orange-50 to-purple-50 overflow-hidden flex-shrink-0 ${
          featured ? 'h-56 md:h-auto md:w-[45%]' : 'h-48'
        }`}
      >
        {post.coverImage ? (
          <Image
            src={post.coverImage}
            alt={post.title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            priority={featured}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300">
            <div className="text-4xl font-black opacity-20">SR</div>
          </div>
        )}
        {featured && (
          <div className="absolute top-3 left-3">
            <Badge className="bg-primary-orange text-white border-0 font-bold">NỔI BẬT</Badge>
          </div>
        )}
        {catLabel && !featured && (
          <div className="absolute top-3 left-3">
            <Badge className="bg-white/90 text-text-dark border-0 text-xs font-semibold shadow-sm">
              {catLabel}
            </Badge>
          </div>
        )}
      </div>

      {/* Content */}
      <div className={`p-5 flex flex-col gap-3 flex-1 ${featured ? 'md:p-7' : ''}`}>
        {featured && catLabel && (
          <Badge className="bg-soft-cream text-primary-orange border border-primary-orange/30 w-fit font-semibold">
            {catLabel}
          </Badge>
        )}

        <h3
          className={`font-extrabold text-text-dark leading-snug group-hover:text-primary-orange transition-colors ${
            featured ? 'text-xl md:text-2xl' : 'text-base'
          }`}
        >
          {post.title}
        </h3>

        {post.excerpt && (
          <p
            className={`text-text-muted leading-relaxed ${
              featured ? 'text-base line-clamp-3' : 'text-sm line-clamp-2'
            }`}
          >
            {post.excerpt}
          </p>
        )}

        {/* Meta */}
        <div className="flex items-center gap-4 text-xs text-text-muted mt-auto pt-3 border-t border-border flex-wrap">
          {post.author?.name && (
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              {post.author.name}
            </span>
          )}
          {post.publishedAt && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(post.publishedAt)}
            </span>
          )}
          {post.readingTime && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {post.readingTime} phút đọc
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
