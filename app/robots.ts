import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const isProduction = process.env.VERCEL_ENV === 'production'

  if (!isProduction) {
    return {
      rules: { userAgent: '*', disallow: '/' },
      sitemap: undefined,
    }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/login', '/api/admin/'],
      },
    ],
    sitemap: 'https://satarobo.vn/sitemap.xml',
  }
}
