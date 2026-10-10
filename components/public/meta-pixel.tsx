'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'
import { hasConsent } from '@/lib/cookie-consent'

declare global {
  interface Window {
    fbq: (...args: unknown[]) => void
    _fbq: unknown
  }
}

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

/**
 * Meta Pixel — only loads after user grants 'marketing' consent.
 * Server-side conversion API (Meta CAPI) still fires regardless via /api/leads
 * because that's necessary for our business purpose (lead tracking we own),
 * but the browser pixel is opt-in.
 */
export function MetaPixel() {
  const [granted, setGranted] = useState(false)

  useEffect(() => {
    setGranted(hasConsent('marketing'))

    const handler = () => {
      setGranted(hasConsent('marketing'))
    }
    window.addEventListener('consent-change', handler)
    return () => window.removeEventListener('consent-change', handler)
  }, [])

  if (!PIXEL_ID) return null
  if (!granted) return null

  return (
    // Static pixel init — content is build-time constant, not user input
    <Script
      id="meta-pixel-init"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${PIXEL_ID}');fbq('track','PageView');`,
      }}
    />
  )
}
