'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { hasConsent } from '@/lib/cookie-consent'
import { BIEU_THUC_JS_LA_RIENG_TU, laDuongRiengTu } from '@/lib/disc/rieng-tu-duong-dan'
import { laTrangRiengTu } from '@/lib/public/trang-rieng-tu'

declare global {
  interface Window {
    fbq: (...args: unknown[]) => void
    _fbq: unknown
  }
}

/**
 * Meta Pixel — only loads after user grants 'marketing' consent.
 * Server-side conversion API (Meta CAPI) still fires regardless via /api/leads
 * because that's necessary for our business purpose (lead tracking we own),
 * but the browser pixel is opt-in.
 *
 * Đường riêng tư (`lib/disc/rieng-tu-duong-dan.ts`, có tính host portal): KHÔNG gửi PageView, KHÔNG để Pixel
 * tự đọc trang. `autoConfig=false` (không sự kiện tự động / Advanced Matching tự động từ ô nhập) và
 * `consent revoke` TRƯỚC `init` khi nạp thẳng vào đường riêng tư; điều hướng SPA vào/ra thì revoke/grant.
 * Pixel tự bắn PageView khi pushState nên tắt bằng `fbq.disablePushState` và tự gửi PageView theo pathname.
 */
export function MetaPixel() {
  const [granted, setGranted] = useState(false)
  const pathname = usePathname()
  const truoc = useRef<string | null>(null)
  const daThuHoi = useRef(false)
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID

  useEffect(() => {
    setGranted(hasConsent('marketing'))

    const handler = () => {
      setGranted(hasConsent('marketing'))
    }
    window.addEventListener('consent-change', handler)
    return () => window.removeEventListener('consent-change', handler)
  }, [])

  useEffect(() => {
    const daDoiRoute = truoc.current !== null && truoc.current !== pathname
    truoc.current = pathname
    if (!pixelId || typeof window.fbq !== 'function') return
    const rieng = laDuongRiengTu(pathname, window.location.hostname)
    // Pixel đã nạp thì KHÔNG gỡ được khi điều hướng SPA sang đường riêng tư ⇒ thu hồi đồng ý: Pixel ngừng gửi
    // mọi sự kiện (kể cả sự kiện tự động) cho tới khi quay lại đường thường.
    if (rieng) {
      window.fbq('consent', 'revoke')
      daThuHoi.current = true
      return
    }
    if (daThuHoi.current) {
      window.fbq('consent', 'grant')
      daThuHoi.current = false
    }
    if (daDoiRoute) window.fbq('track', 'PageView')
  }, [pathname, pixelId])

  if (!pixelId) return null
  if (!granted) return null
  // Trang mang MÃ LIÊN KẾT trong đường dẫn: không bao giờ nạp pixel — URL có token.
  if (laTrangRiengTu(pathname)) return null

  return (
    // Static pixel init — content is build-time constant, not user input
    <Script
      id="meta-pixel-init"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq.disablePushState=!0;var __r=${BIEU_THUC_JS_LA_RIENG_TU};fbq('set','autoConfig',false,'${pixelId}');if(__r){fbq('consent','revoke');}fbq('init','${pixelId}');if(!__r){fbq('track','PageView');}`,
      }}
    />
  )
}
