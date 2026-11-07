'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { hasConsent } from '@/lib/cookie-consent'
import { BIEU_THUC_JS_LA_RIENG_TU, laDuongRiengTu } from '@/lib/disc/rieng-tu-duong-dan'
import { laTrangRiengTu } from '@/lib/public/trang-rieng-tu'

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void
    dataLayer: unknown[]
  }
}

/**
 * GA4 script — only loads after user grants 'analytics' consent.
 * Listens to `consent-change` events to load/unload dynamically.
 *
 * Đường riêng tư (`lib/disc/rieng-tu-duong-dan.ts`): bật cờ opt-out chính thức `ga-disable-<ID>`
 * ⇒ gtag không gửi BẤT KỲ hit nào (kể cả page_view tự động của đo lường nâng cao khi đổi route SPA),
 * nên URL/query (vd `?t=token`) không tới Google. Cờ được cập nhật theo pathname.
 */
export function GA4() {
  const [granted, setGranted] = useState(false)
  const pathname = usePathname()
  const batDauRiengTu = useRef<boolean | null>(null)
  const daBuPageView = useRef(false)
  const gaId = process.env.NEXT_PUBLIC_GA4_ID

  useEffect(() => {
    // Check on mount
    setGranted(hasConsent('analytics'))

    // Listen for consent changes
    const handler = () => {
      setGranted(hasConsent('analytics'))
    }
    window.addEventListener('consent-change', handler)
    return () => window.removeEventListener('consent-change', handler)
  }, [])

  useEffect(() => {
    if (!gaId) return
    const rieng = laDuongRiengTu(pathname, window.location.hostname)
    const w = window as unknown as Record<string, unknown>
    w[`ga-disable-${gaId}`] = rieng
    if (batDauRiengTu.current === null) batDauRiengTu.current = rieng
    // Trang đầu là đường riêng tư ⇒ config đã KHÔNG gửi page_view; vào trang thường lần đầu thì bù MỘT page_view
    // (chỉ pathname, không query).
    if (!rieng && batDauRiengTu.current && !daBuPageView.current && typeof window.gtag === 'function') {
      daBuPageView.current = true
      window.gtag('event', 'page_view', {
        page_location: `${window.location.origin}${window.location.pathname}`,
        page_path: window.location.pathname,
      })
    }
  }, [gaId, pathname, granted])

  if (!gaId) return null
  if (!granted) return null
  // Trang mang MÃ LIÊN KẾT trong đường dẫn (thông tin người mua hoá đơn): không bao giờ nạp phân tích — URL có token.
  if (laTrangRiengTu(pathname)) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      {/* Static gtag init — build-time constant, not user input */}
      <Script
        id="ga4-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `var __r=${BIEU_THUC_JS_LA_RIENG_TU};window['ga-disable-${gaId}']=__r;window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}',{send_page_view:!__r,anonymize_ip:true});`,
        }}
      />
    </>
  )
}
