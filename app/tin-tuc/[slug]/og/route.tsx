import { ImageResponse } from 'next/og'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const revalidate = 3600

interface Params {
  params: Promise<{ slug: string }>
}

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params

  const post = await db.news
    .findUnique({
      where: { slug },
      select: { title: true, excerpt: true },
    })
    .catch(() => null)

  const title = post?.title ?? 'Tin tức & Blog'
  const excerpt = post?.excerpt ?? 'Sata Robo — Hệ sinh thái Robotics & STEM giáo dục hàng đầu Đà Nẵng'
  const author = 'Sata Robo'

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 60%, #1e1b4b 100%)',
          padding: '60px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '6px',
            background: 'linear-gradient(90deg, #F97316, #7C3AED)',
          }}
        />

        {/* Category badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '28px',
          }}
        >
          <div
            style={{
              background: 'rgba(249, 115, 22, 0.2)',
              border: '1px solid rgba(249, 115, 22, 0.4)',
              borderRadius: '6px',
              padding: '6px 16px',
              color: '#F97316',
              fontSize: '18px',
              fontWeight: 600,
            }}
          >
            Tin tức & Blog
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            color: '#ffffff',
            fontSize: title.length > 60 ? '42px' : '52px',
            fontWeight: 800,
            lineHeight: 1.25,
            marginBottom: '24px',
            flex: 1,
            display: 'flex',
            alignItems: 'flex-start',
          }}
        >
          {title.length > 120 ? title.substring(0, 117) + '...' : title}
        </div>

        {/* Excerpt */}
        {excerpt && (
          <div
            style={{
              color: 'rgba(255,255,255,0.65)',
              fontSize: '22px',
              lineHeight: 1.5,
              marginBottom: '32px',
              maxWidth: '900px',
            }}
          >
            {excerpt.length > 120 ? excerpt.substring(0, 117) + '...' : excerpt}
          </div>
        )}

        {/* Footer row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #F97316, #7C3AED)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '18px',
                fontWeight: 700,
              }}
            >
              {author.charAt(0).toUpperCase()}
            </div>
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '20px' }}>{author}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#F97316', fontSize: '26px', fontWeight: 900 }}>Sata</span>
            <span style={{ color: '#7C3AED', fontSize: '26px', fontWeight: 900 }}>Robo</span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
