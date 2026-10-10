'use client'

import { useState } from 'react'
import { Link2, Check, MessageCircle } from 'lucide-react'

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

interface ShareButtonsProps {
  url: string
  title: string
}

export function ShareButtons({ url, title }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false)

  const encodedUrl = encodeURIComponent(url)
  const encodedTitle = encodeURIComponent(title)

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-sm font-semibold text-text-muted">Chia sẻ:</span>

      {/* Facebook */}
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1877F2] text-white text-sm font-bold hover:opacity-90 transition"
        aria-label="Chia sẻ lên Facebook"
      >
        <FacebookIcon className="w-4 h-4" />
        Facebook
      </a>

      {/* Zalo */}
      <a
        href={`https://zalo.me/share/url?url=${encodedUrl}&title=${encodedTitle}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0068FF] text-white text-sm font-bold hover:opacity-90 transition"
        aria-label="Chia sẻ qua Zalo"
      >
        <MessageCircle className="w-4 h-4" />
        Zalo
      </a>

      {/* Copy link */}
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-bold text-text-dark hover:border-primary-orange hover:text-primary-orange transition"
        aria-label="Copy link bài viết"
      >
        {copied ? <Check className="w-4 h-4 text-green-600" /> : <Link2 className="w-4 h-4" />}
        {copied ? 'Đã copy!' : 'Copy link'}
      </button>
    </div>
  )
}
