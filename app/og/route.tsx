import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title') ?? 'Sata Robo'
  const subtitle = searchParams.get('subtitle') ?? 'Trung tâm đào tạo STEM – Lập trình Robotics & AI – Sata Robo'

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'flex-end',
          background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
          padding: '60px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Decorative circle top-right */}
        <div
          style={{
            position: 'absolute',
            top: '-80px',
            right: '-80px',
            width: '400px',
            height: '400px',
            borderRadius: '50%',
            background: 'rgba(249, 115, 22, 0.15)',
          }}
        />
        {/* Decorative circle bottom-left */}
        <div
          style={{
            position: 'absolute',
            bottom: '-60px',
            left: '-60px',
            width: '300px',
            height: '300px',
            borderRadius: '50%',
            background: 'rgba(124, 58, 237, 0.2)',
          }}
        />

        {/* Brand */}
        <div style={{ display: 'flex', marginBottom: '32px' }}>
          <span style={{ color: '#F97316', fontSize: '36px', fontWeight: 900 }}>Sata</span>
          <span style={{ color: '#7C3AED', fontSize: '36px', fontWeight: 900 }}>Robo</span>
        </div>

        {/* Title */}
        <div
          style={{
            color: '#ffffff',
            fontSize: title.length > 50 ? '44px' : '56px',
            fontWeight: 800,
            lineHeight: 1.2,
            marginBottom: '20px',
            maxWidth: '960px',
          }}
        >
          {title}
        </div>

        {/* Subtitle */}
        <div
          style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: '26px',
            fontWeight: 400,
            lineHeight: 1.4,
            maxWidth: '900px',
          }}
        >
          {subtitle}
        </div>

        {/* Bottom badge */}
        <div
          style={{
            position: 'absolute',
            bottom: '48px',
            right: '60px',
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '8px',
            padding: '8px 20px',
            color: 'rgba(255,255,255,0.8)',
            fontSize: '20px',
          }}
        >
          satarobo.vn
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
