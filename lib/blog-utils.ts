import readingTime from 'reading-time'

export const CATEGORIES = ['phu-huynh', 'tin-tuc', 'giao-duc', 'doanh-nghiep'] as const
export type BlogCategory = (typeof CATEGORIES)[number]

export const CATEGORY_DISPLAY: Record<string, string> = {
  'phu-huynh': 'Phụ huynh',
  'tin-tuc': 'Tin tức',
  'giao-duc': 'Giáo dục',
  'doanh-nghiep': 'Doanh nghiệp',
}

export const POSTS_PER_PAGE = 9

export function calcReadingTime(content: string): number {
  const result = readingTime(content)
  return Math.max(1, Math.ceil(result.minutes))
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date))
}

export function slugToTag(slug: string): string {
  return slug.replace(/-/g, ' ')
}
