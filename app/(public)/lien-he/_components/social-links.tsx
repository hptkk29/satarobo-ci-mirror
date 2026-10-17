import { Music2, MessageCircle } from 'lucide-react'
import { SATA_ROBO_PHONE } from '@/lib/locations'

// Facebook và YouTube không có trong phiên bản lucide-react hiện tại — dùng inline SVG
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

const SOCIALS = [
  {
    label: 'Facebook',
    Icon: FacebookIcon,
    href: 'https://www.facebook.com/satarobo',
    color: '#1877F2',
    bg: '#EBF5FF',
  },
  {
    label: 'TikTok',
    Icon: Music2,
    href: 'https://www.tiktok.com/@satarobo',
    color: '#010101',
    bg: '#F5F5F5',
  },
  {
    label: 'YouTube',
    Icon: YoutubeIcon,
    href: 'https://www.youtube.com/@satarobo',
    color: '#FF0000',
    bg: '#FFF0F0',
  },
  {
    label: 'Zalo',
    Icon: MessageCircle,
    href: SATA_ROBO_PHONE.zalo,
    color: '#0068FF',
    bg: '#EBF4FF',
  },
]

export function SocialLinks() {
  return (
    <section className="section-padding bg-white">
      <div className="container-site">
        <div className="text-center mb-10">
          <span className="badge-orange mb-3 inline-block">Mạng xã hội</span>
          <h2 className="heading-2 text-text-dark">
            Kết nối với{' '}
            <span className="text-gradient-orange-purple">Sata Robo</span>
          </h2>
          <p className="text-text-muted mt-3">
            Theo dõi để cập nhật tin tức, kết quả thi đấu và ưu đãi mới nhất
          </p>
        </div>

        <div className="flex justify-center gap-4 flex-wrap">
          {SOCIALS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-border hover:-translate-y-1 transition-all duration-200 min-w-[120px] hover:shadow-md"
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110"
                style={{ background: s.bg }}
              >
                <s.Icon className="w-7 h-7" style={{ color: s.color }} />
              </div>
              <span className="text-sm font-bold text-text-dark">{s.label}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
