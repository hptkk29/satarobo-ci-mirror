'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { hasConsent } from '@/lib/cookie-consent'
import { laTrangRiengTu } from '@/lib/public/trang-rieng-tu';

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void
    dataLayer: unknown[]
  }
}

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID

/**
 * GA4 script — only loads after user grants 'analytics' consent.
 * Listens to `consent-change` events to load/unload dynamically.
 */
export function GA4() {
  const [granted, setGranted] = useState(false)
  const pathname = usePathname()

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

  if (!GA4_ID) return null
  if (!granted) return null
  // Trang mang MÃ LIÊN KẾT trong đường dẫn (thông tin người mua hoá đơn): không bao giờ nạp phân tích — URL có token.
  if (laTrangRiengTu(pathname)) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
        strategy="afterInteractive"
      />
      {/* Static gtag init — build-time constant, not user input */}
      <Script
        id="ga4-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA4_ID}',{send_page_view:true,anonymize_ip:true});`,
        }}
      />
    </>
  )
}
