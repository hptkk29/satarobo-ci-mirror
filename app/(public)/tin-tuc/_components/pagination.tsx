import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PaginationProps {
  currentPage: number
  totalPages: number
  baseHref: string
}

export function Pagination({ currentPage, totalPages, baseHref }: PaginationProps) {
  if (totalPages <= 1) return null

  function pageHref(page: number) {
    const sep = baseHref.includes('?') ? '&' : '?'
    return `${baseHref}${sep}page=${page}`
  }

  // Show max 5 page numbers around current
  const pages: (number | '...')[] = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...')
    }
  }

  return (
    <nav className="flex items-center justify-center gap-2 py-10" aria-label="Phân trang">
      {/* Prev */}
      {currentPage > 1 ? (
        <Link
          href={pageHref(currentPage - 1)}
          className="p-2 rounded-xl border border-border hover:border-primary-orange hover:text-primary-orange transition"
          aria-label="Trang trước"
        >
          <ChevronLeft className="w-4 h-4" />
        </Link>
      ) : (
        <span className="p-2 rounded-xl border border-border opacity-30 cursor-not-allowed">
          <ChevronLeft className="w-4 h-4" />
        </span>
      )}

      {/* Page numbers */}
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`ellipsis-${i}`} className="px-2 text-text-muted select-none">
            ...
          </span>
        ) : (
          <Link
            key={p}
            href={pageHref(p)}
            className={cn(
              'w-9 h-9 flex items-center justify-center rounded-xl text-sm font-bold transition border',
              p === currentPage
                ? 'bg-primary-orange text-white border-primary-orange'
                : 'border-border text-text-dark hover:border-primary-orange hover:text-primary-orange'
            )}
            aria-current={p === currentPage ? 'page' : undefined}
          >
            {p}
          </Link>
        )
      )}

      {/* Next */}
      {currentPage < totalPages ? (
        <Link
          href={pageHref(currentPage + 1)}
          className="p-2 rounded-xl border border-border hover:border-primary-orange hover:text-primary-orange transition"
          aria-label="Trang sau"
        >
          <ChevronRight className="w-4 h-4" />
        </Link>
      ) : (
        <span className="p-2 rounded-xl border border-border opacity-30 cursor-not-allowed">
          <ChevronRight className="w-4 h-4" />
        </span>
      )}
    </nav>
  )
}
