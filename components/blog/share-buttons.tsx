'use client'

import { useState } from 'react'

interface ShareButtonsProps {
  url: string
  title: string
}

// Hàng chia sẻ của giao diện public mới (`.share` / `.btn.btn-line` của artifact): Facebook, Zalo,
// sao chép liên kết. Cả ba đều là chức năng thật — địa chỉ chia sẻ dựng từ url/tiêu đề bài.
export function ShareButtons({ url, title }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false)

  const encodedUrl = encodeURIComponent(url)
  const encodedTitle = encodeURIComponent(title)

  function handleCopy() {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {
        /* trình duyệt chặn clipboard: không báo "đã chép" sai */
      })
  }

  const kieuNut = { minHeight: 42, padding: '0 14px' } as const

  return (
    <div className="share" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <a
        className="btn btn-line"
        style={kieuNut}
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chia sẻ lên Facebook (mở tab mới)"
      >
        Facebook
      </a>
      <a
        className="btn btn-line"
        style={kieuNut}
        href={`https://zalo.me/share/url?url=${encodedUrl}&title=${encodedTitle}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chia sẻ qua Zalo (mở tab mới)"
      >
        Zalo
      </a>
      <button type="button" className="btn btn-line" style={kieuNut} onClick={handleCopy} aria-label="Sao chép liên kết bài viết">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </svg>
        {copied ? 'Đã sao chép' : 'Sao chép link'}
      </button>
    </div>
  )
}
