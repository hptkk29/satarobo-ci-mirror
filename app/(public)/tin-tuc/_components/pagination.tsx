import Link from 'next/link'

interface PaginationProps {
  currentPage: number
  totalPages: number
  baseHref: string
}

const KIEU_NUT = { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 42 } as const
const KIEU_TAT = { ...KIEU_NUT, opacity: 0.35, cursor: 'not-allowed' } as const

// Phân trang của trang chuyên mục / tag (đường dẫn thật, có `?page=`). Dùng viên thuốc `.pill` của
// giao diện public mới; trang hiện tại là `.pill.on`.
export function Pagination({ currentPage, totalPages, baseHref }: PaginationProps) {
  if (totalPages <= 1) return null

  function pageHref(page: number) {
    const sep = baseHref.includes('?') ? '&' : '?'
    return `${baseHref}${sep}page=${page}`
  }

  // Hiện trang đầu, trang cuối và ±2 quanh trang hiện tại.
  const pages: (number | '...')[] = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...')
    }
  }

  return (
    <nav style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 32 }} aria-label="Phân trang">
      {currentPage > 1 ? (
        <Link href={pageHref(currentPage - 1)} className="pill" style={KIEU_NUT} aria-label="Trang trước">
          ←
        </Link>
      ) : (
        <span className="pill" style={KIEU_TAT} aria-hidden="true">
          ←
        </span>
      )}

      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`ellipsis-${i}`} style={{ alignSelf: 'center', color: 'var(--muted)' }} aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={pageHref(p)}
            className={p === currentPage ? 'pill on' : 'pill'}
            style={KIEU_NUT}
            aria-current={p === currentPage ? 'page' : undefined}
          >
            {p}
          </Link>
        ),
      )}

      {currentPage < totalPages ? (
        <Link href={pageHref(currentPage + 1)} className="pill" style={KIEU_NUT} aria-label="Trang sau">
          →
        </Link>
      ) : (
        <span className="pill" style={KIEU_TAT} aria-hidden="true">
          →
        </span>
      )}
    </nav>
  )
}
