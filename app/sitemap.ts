import type { MetadataRoute } from 'next'
import { db } from '@/lib/db'
import { VALID_COURSE_SLUGS } from '@/components/legacy-laptrinhrobot/_data/courses-details'
import { allLegalSlugs } from '@/lib/legal-pages'

const BASE_URL = 'https://satarobo.vn'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE_URL}/ve-chung-toi`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/khoa-hoc`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/khoa-hoc/laptrinhrobot`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE_URL}/khoa-hoc/luyenthirobosim`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
    // /hoc-cu đã gỡ 21/09/2026 — trang đang bị ẩn (hồ sơ BCT mục 4), khai URL trả 404
    // với Google là tự báo lỗi cho mình. Thêm lại cùng lúc với việc xoá layout ẩn.
    { url: `${BASE_URL}/tuyen-dung`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/lien-he`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/tin-tuc`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    // /vinh-danh entries removed — section is hidden via layout.tsx 404.
    // Re-add when /vinh-danh is re-enabled.
  ]

  // Trang pháp lý sinh từ `lib/legal-pages.ts` — KHÔNG khai tay.
  // Cách khai tay cũ đã bỏ sót thật một trang: `/quyen-rieng-tu` tồn tại, được build, có
  // metadata riêng, nhưng chưa bao giờ vào sitemap. Với 10 chính sách bắt buộc của hồ sơ
  // BCT thì cùng một cơ chế sẽ sót tiếp, và sót ở đây là sót thứ cơ quan quản lý đi tìm.
  const legalRoutes: MetadataRoute.Sitemap = allLegalSlugs().map((slug) => ({
    url: `${BASE_URL}/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'yearly',
    priority: 0.3,
  }))

  const [news, jobs] = await Promise.all([
    db.news
      .findMany({
        where: { isPublished: true },
        select: { slug: true, updatedAt: true },
        orderBy: { publishedAt: 'desc' },
      })
      .catch(() => []),
    db.jobPosting
      .findMany({
        where: { status: 'OPEN' },
        select: { slug: true, updatedAt: true },
      })
      .catch(() => []),
    // db.honor disabled — /vinh-danh section is 404 via layout.
  ])

  const newsRoutes: MetadataRoute.Sitemap = news.map((n) => ({
    url: `${BASE_URL}/tin-tuc/${n.slug}`,
    lastModified: n.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.7,
  }))

  const jobRoutes: MetadataRoute.Sitemap = jobs.map((j) => ({
    url: `${BASE_URL}/tuyen-dung/${j.slug}`,
    lastModified: j.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  // Phase A1 — 9 trang chi tiết khóa Sata1-Sata8 + combo (SSG).
  // Từng gỡ ngày 21/09/2026 khi 9 trang này bị ẩn (hồ sơ BCT mục 4 — không công khai giá).
  // KHÔI PHỤC 22/09/2026: BLĐ chốt "có khoá nào thì công khai giá khoá đó", nên các trang
  // này nay in học phí niêm yết và được hiển thị lại.
  const courseRoutes: MetadataRoute.Sitemap = VALID_COURSE_SLUGS.map((slug) => ({
    url: `${BASE_URL}/khoa-hoc/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 0.9,
  }))

  return [...staticRoutes, ...legalRoutes, ...newsRoutes, ...jobRoutes, ...courseRoutes]
}
