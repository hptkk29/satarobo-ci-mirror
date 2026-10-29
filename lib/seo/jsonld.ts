import { marked } from 'marked'
import { HR_CONTACT } from '@/lib/data/job-options'
import {
  SATA_ROBO_CONTACT,
  SATA_ROBO_LOCATIONS,
  SATA_ROBO_PHONE,
  OPENING_HOURS_SCHEMA,
} from '@/lib/locations'

const BASE_URL = 'https://satarobo.vn'

/**
 * Serialize a JSON-LD object for inline injection into a <script type="application/ld+json">.
 * JSON.stringify does NOT escape `<`, `>` or `&`, so a DB-authored field containing the literal
 * `</script>` would break out of the script tag (stored XSS). Escaping these as unicode escapes
 * keeps the JSON valid while making a `</script>` breakout impossible. Also escapes the U+2028/2029
 * line separators which are valid in JSON but illegal in JS string literals.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    name: SATA_ROBO_CONTACT.shortName,
    // Hồ sơ BCT mục 2. `legalName` là thuộc tính schema.org dành riêng cho tên pháp nhân;
    // trước 21/09/2026 tên đầy đủ chỉ nằm ở `alternateName` (chỗ dành cho tên gọi khác),
    // nên bộ máy đọc được "Sata Robo" mà không đọc được pháp nhân nào đứng sau.
    legalName: SATA_ROBO_CONTACT.legalNameUpper,
    alternateName: SATA_ROBO_CONTACT.companyName,
    url: BASE_URL,
    logo: `${BASE_URL}/brand/logo-satarobo.jpg`,
    description: 'Trung tâm đào tạo STEM – Lập trình Robotics & AI – Sata Robo',
    taxID: SATA_ROBO_CONTACT.taxCode,
    contactPoint: [
      // MỘT contactPoint cho cả công ty [24/09/2026]. Trước đó là một điểm liên hệ cho MỖI
      // cơ sở, mỗi cơ sở một số riêng; nay chỉ còn một số nên hai điểm sẽ mang cùng
      // `telephone` — schema.org đọc ra hai kênh chăm sóc khách hàng trùng nhau.
      {
        '@type': 'ContactPoint',
        telephone: SATA_ROBO_PHONE.e164,
        contactType: 'customer service',
        email: SATA_ROBO_CONTACT.emails.general,
        areaServed: 'VN',
        availableLanguage: 'Vietnamese',
      },
      {
        '@type': 'ContactPoint',
        telephone: '+84' + HR_CONTACT.phoneRaw.substring(1),
        contactType: 'HR',
        email: SATA_ROBO_CONTACT.emails.recruitment,
        areaServed: 'VN',
        availableLanguage: 'Vietnamese',
      },
    ],
    address: SATA_ROBO_LOCATIONS.filter((loc) => loc.status === 'operational').map((loc) => ({
      '@type': 'PostalAddress',
      streetAddress: loc.address.replace(', Đà Nẵng', ''),
      addressLocality: loc.district,
      addressRegion: 'Đà Nẵng',
      addressCountry: 'VN',
      // Trước 21/09/2026 dòng này nối thêm " - Trụ sở chính" khi isHQ, tức TRANG CHỦ
      // phát chuỗi bị hướng dẫn BCT cấm ở dạng MÁY ĐỌC ĐƯỢC. Kiểm bằng view-source +
      // grep "Trụ sở", đừng kiểm bằng mắt trên màn hình.
      name: loc.name,
    })),
    sameAs: [
      SATA_ROBO_CONTACT.facebook,
      SATA_ROBO_CONTACT.tiktok,
      SATA_ROBO_CONTACT.youtube,
      SATA_ROBO_PHONE.zalo,
    ],
  }
}

export function aboutPageJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'Về chúng tôi — Sata Robo',
    url: `${BASE_URL}/ve-chung-toi`,
    description:
      'Câu chuyện thương hiệu, tầm nhìn sứ mệnh và đội ngũ của Sata Robo — Hệ sinh thái Robotics & STEM giáo dục hàng đầu Đà Nẵng.',
    publisher: {
      '@type': 'Organization',
      name: 'Sata Robo',
      url: BASE_URL,
    },
  }
}

export function contactPageJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: 'Liên hệ — Sata Robo',
    url: `${BASE_URL}/lien-he`,
    description: 'Liên hệ với Sata Robo — Hotline, email và 2 cơ sở tại Đà Nẵng.',
  }
}

interface CenterInput {
  id: string
  name: string
  address: string
  phone: string | null
  email: string | null
}

export function localBusinessJsonLd(center: CenterInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${BASE_URL}/lien-he#${center.id}`,
    name: center.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: center.address,
      addressLocality: 'Đà Nẵng',
      addressCountry: 'VN',
    },
    telephone: center.phone ?? undefined,
    email: center.email ?? undefined,
    url: BASE_URL,
    // Sinh từ `workingHours` của chính cơ sở, KHÔNG gõ tay. Trước 21/09/2026 dòng này
    // đóng cứng 'Mo-Su 08:00-21:00' trong khi /lien-he in "T2 - T7: 8:00 - 20:00" ngay
    // phía trên — hai con số khác nhau cho cùng một cơ sở, trên cùng một trang, một cái
    // cho người đọc và một cái cho máy đọc.
    openingHours: OPENING_HOURS_SCHEMA,
    image: `${BASE_URL}/brand/logo-satarobo.jpg`,
  }
}

export function itemListJsonLd(
  items: Array<{ url: string; name: string; position: number }>
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item) => ({
      '@type': 'ListItem',
      position: item.position,
      name: item.name,
      url: item.url,
    })),
  }
}

export interface ProductForJsonLd {
  slug: string
  name: string
  description: string
  price: number
  image: string
}

export function productJsonLd(product: ProductForJsonLd) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: `${BASE_URL}${product.image}`,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'VND',
      availability: 'https://schema.org/InStock',
      url: `${BASE_URL}/hoc-cu#${product.slug}`,
    },
  }
}

export interface BlogPostingInput {
  title: string
  slug: string
  excerpt: string | null
  coverImage: string | null
  publishedAt: Date | null
  updatedAt: Date
  author: { name: string | null }
  category?: string | null
}

export function blogPostingJsonLd(post: BlogPostingInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    image: post.coverImage ?? undefined,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { '@type': 'Person', name: post.author.name ?? 'Sata Robo' },
    publisher: {
      '@type': 'Organization',
      name: 'Sata Robo',
      logo: {
        '@type': 'ImageObject',
        url: `${BASE_URL}/brand/logo-satarobo.jpg`,
      },
    },
    description: post.excerpt ?? undefined,
    mainEntityOfPage: `${BASE_URL}/tin-tuc/${post.slug}`,
    articleSection: post.category ?? undefined,
    url: `${BASE_URL}/tin-tuc/${post.slug}`,
  }
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  fulltime: 'FULL_TIME',
  parttime: 'PART_TIME',
  intern: 'INTERN',
  contract: 'CONTRACTOR',
}

function markdownToHtml(md: string): string {
  if (!md) return ''
  return String(marked.parse(md, { gfm: true, breaks: false })).trim()
}

export interface JobForJsonLd {
  slug: string
  title: string
  description: string
  requirements: string | null
  benefits: string | null
  location: string | null
  type: string | null
  salaryMin: number | null
  salaryMax: number | null
  openings: number
  createdAt: Date
  closesAt: Date | null
}

export function jobPostingJsonLd(job: JobForJsonLd) {
  const fullDescriptionHtml = [
    markdownToHtml(job.description),
    job.requirements ? markdownToHtml(job.requirements) : '',
    job.benefits ? markdownToHtml(job.benefits) : '',
  ].filter(Boolean).join('\n')

  // Always provide validThrough: default to 90 days from datePosted if closesAt is null
  const validThrough = job.closesAt
    ? job.closesAt.toISOString()
    : new Date(job.createdAt.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()

  const isRemote = job.location === 'online-hybrid' || job.location === 'remote'

  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: fullDescriptionHtml,
    identifier: {
      '@type': 'PropertyValue',
      name: 'Sata Robo',
      value: job.slug,
    },
    datePosted: job.createdAt.toISOString().split('T')[0],
    validThrough,
    employmentType: EMPLOYMENT_TYPE_MAP[job.type ?? ''] ?? 'OTHER',
    hiringOrganization: {
      '@type': 'Organization',
      // Đọc từ hằng, không gõ tay: bản sao ở đây từng là chuỗi literal thứ hai của tên
      // pháp nhân, và hai bản sao thì sớm muộn cũng lệch.
      name: SATA_ROBO_CONTACT.companyName,
      sameAs: BASE_URL,
      logo: `${BASE_URL}/brand/logo-satarobo.jpg`,
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '211 Nguyễn Hữu Thọ',
        addressLocality: 'Hải Châu',
        addressRegion: 'Đà Nẵng',
        addressCountry: 'VN',
      },
    },
    ...(isRemote && {
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: {
        '@type': 'Country',
        name: 'Vietnam',
      },
    }),
    ...(job.salaryMin && job.salaryMax
      ? {
          baseSalary: {
            '@type': 'MonetaryAmount',
            currency: 'VND',
            value: {
              '@type': 'QuantitativeValue',
              minValue: job.salaryMin,
              maxValue: job.salaryMax,
              unitText: 'MONTH',
            },
          },
        }
      : {}),
    totalJobOpenings: job.openings,
    directApply: false,
    applicantContact: {
      '@type': 'ContactPoint',
      contactType: 'recruiter',
      email: HR_CONTACT.email,
      telephone: '+84' + HR_CONTACT.phoneRaw.substring(1),
    },
  }
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Sata Robo',
    url: BASE_URL,
    description: 'Trung tâm đào tạo STEM – Lập trình Robotics & AI – Sata Robo',
    publisher: {
      '@type': 'Organization',
      name: 'Sata Robo',
      url: BASE_URL,
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${BASE_URL}/tin-tuc?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${BASE_URL}${item.url}`,
    })),
  }
}
