'use client'

/**
 * Biểu mẫu "Đặt buổi học thử 1-1" DÙNG CHUNG (PUB-1, 02/11/2026) — giao diện của artifact
 * "Sata Robo — Website mới" (`.fld` / `.inp` / `.req` / `.btn-acc`), logic gửi giữ NGUYÊN từ
 * `app/(public)/lien-he/_components/contact-form.tsx` cũ: zod, honeypot `website`, thời gian
 * trên trang, attribution (UTM · ref first-touch · aff/clk · fbp/fbc), payload `/api/leads`,
 * ô đồng ý Chính sách bảo mật (`OTichChinhSach`), nhảy tới form khi `?free-trial=true`.
 *
 * Ba biến thể:
 *  - `page`  : khối "Để lại thông tin, chúng tôi gọi lại" của trang /lien-he (`<section id="dang-ky">`).
 *  - `home`  : khối [08] của trang chủ (`<section id="lien-he">`, có hoạt ảnh vào).
 *  - `popup` : chỉ phần ô nhập + nút gửi (khung, tiêu đề, "Để sau" do popup tự vẽ); không có
 *              ô "Thêm thông tin". Gửi xong gọi `onSuccess` để popup đổi sang lời cảm ơn.
 *
 * Cố ý KHÔNG dùng `useSearchParams`: hook đó buộc Suspense và kéo trang tĩnh sang động — trang chủ
 * (ISR, ngân sách LCP) và layout public (popup) đều nhúng form này. Query đọc từ
 * `window.location.search` lúc cần (cùng cách `AttributionCapture`).
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { phoneVn } from '@/lib/validators/phone'
import { canonicalPhone } from '@/lib/phone'
import { readAttribution } from '@/lib/marketing/attribution'
import { operationalLocations } from '@/lib/locations'
import { VN_PROVINCES, VN_PROVINCE_DEFAULT } from '@/lib/vn-provinces'
import { OTichChinhSach } from '@/components/public/o-tich-chinh-sach'
import { CAU_PHAN_HOI, GIO_LAM_VIEC } from '@/components/public/gio-lam-viec'

// Cơ sở lấy ĐỘNG từ `lib/locations` — mở CS3 chỉ cần thêm data, không sửa form.
// Value TRÙNG nhãn: Lead không có cột cơ sở nên nhãn đi thẳng vào `note` dạng chữ.
const centerLabel = (name: string, address: string) =>
  `${name.split(' - ')[0] ?? name} - ${address}`

/**
 * Nhãn hiển thị → MÃ cơ sở (`Center.code`, vd "CS1"), 03/09/2026. Nhãn là thứ duy nhất ô chọn
 * giữ; bản đồ này quy nó về mã thật để server gán `Lead.centerId`. Thiếu nó thì lead web rơi vào
 * nhánh "tự chọn cơ sở đều tay" của bộ chia — không về đúng cơ sở khách chọn.
 */
const CENTER_CODE_BY_LABEL = new Map(
  operationalLocations().map((loc) => [centerLabel(loc.name, loc.address), loc.code]),
)

const CENTER_OPTIONS = operationalLocations().map((loc) => centerLabel(loc.name, loc.address))

const DEFAULT_CENTER = (() => {
  const hq = operationalLocations().find((l) => l.isHQ)
  return hq ? centerLabel(hq.name, hq.address) : (CENTER_OPTIONS[0] ?? '')
})()

// Email: siết cho KHỚP `z.string().email()` của server (`lib/validators/lead.ts`). Regex lỏng cho
// "a@b..c" qua client rồi bị server trả 400 — mất cả lead chỉ vì một ô KHÔNG bắt buộc.
const EMAIL_RE = /^[^\s@.][^\s@]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/

// Ô không bắt buộc: bỏ trống thì bỏ qua, có nhập mới soi. Dùng `.refine` chứ KHÔNG
// `.optional().or(z.literal(''))` — union làm zod nuốt message riêng ("Invalid input").
const optionalText = (message: string) =>
  z
    .string()
    .optional()
    .refine((v) => {
      const s = (v ?? '').trim()
      return s === '' || (s.length >= 2 && s.length <= 100)
    }, { message })

const contactSchema = z.object({
  // Trần 93 ký tự: khi bỏ trống "Họ tên phụ huynh", `parentName` = "PH của <tên con>" (+7 ký tự)
  // và server chặn `parentName` max 100.
  hoTenCon: z.string().trim().min(2, 'Vui lòng nhập họ và tên con.').max(93, 'Họ tên con quá dài.'),
  // phoneVn CHUẨN HOÁ (không phải regex) — "0905 123 456" phải qua được.
  sdt: phoneVn,
  coSo: z.string().min(1, 'Vui lòng chọn cơ sở.'),
  // 5 ô dưới đây nằm trong panel mở rộng — tất cả không bắt buộc.
  hoTenPh: optionalText('Họ tên không hợp lệ.'),
  email: z
    .string()
    .optional()
    .refine((v) => {
      const s = (v ?? '').trim()
      return s === '' || EMAIL_RE.test(s)
    }, { message: 'Email không hợp lệ.' }),
  truong: optionalText('Tên trường không hợp lệ.'),
  lop: optionalText('Lớp không hợp lệ.'),
  tinh: z.string().min(1, 'Vui lòng chọn tỉnh/thành phố.').optional(),
  website: z.string().max(0).optional().or(z.literal('')),
  // Hồ sơ BCT mục 3 — ô tích đồng ý Chính sách bảo mật. `z.literal(true)` chứ KHÔNG `z.boolean()`:
  // literal làm chính zodResolver chặn submit và tự hiện lỗi dưới ô (một cổng, một chỗ).
  dongYCsbm: z.literal(true, { message: 'Vui lòng đọc và đồng ý với Chính sách bảo mật.' }),
})

type ContactFormValues = z.infer<typeof contactSchema>

/** Ô nằm trong panel "Thêm thông tin" — dùng để tự mở panel khi submit lỗi. */
const PANEL_FIELDS = ['hoTenPh', 'email', 'truong', 'lop', 'tinh'] as const

/** Thứ tự hiển thị trên UI — quyết định "lỗi đầu tiên" để cuộn tới. */
const FIELD_ORDER = ['hoTenCon', 'sdt', 'coSo', 'hoTenPh', 'email', 'truong', 'lop', 'tinh'] as const

/** Mã ô → hậu tố id trên DOM (`<formId>-<hậu tố>`), giữ theo artifact: f-con · f-sdt · f-cs … */
const HAU_TO_ID = {
  hoTenCon: 'con',
  sdt: 'sdt',
  coSo: 'cs',
  hoTenPh: 'ph',
  email: 'email',
  truong: 'truong',
  lop: 'lop',
  tinh: 'tinh',
  dongYCsbm: 'ok',
} as const

const EMPTY_VALUES: ContactFormValues = {
  hoTenCon: '',
  sdt: '',
  coSo: DEFAULT_CENTER,
  hoTenPh: '',
  email: '',
  truong: '',
  lop: '',
  tinh: VN_PROVINCE_DEFAULT,
  website: '',
  // Mặc định CHƯA tích — hướng dẫn BCT vẽ ô vuông rỗng; lượt gửi sau là một lượt đồng ý mới.
  dongYCsbm: false as unknown as true,
}

export type LienHeFormVariant = 'page' | 'home' | 'popup'

export type LienHeFormProps = {
  variant: LienHeFormVariant
  /** Tiền tố id của các ô (mặc định `f`, popup `p`) — tránh trùng id khi có hai form trên một trang. */
  formId?: string
  /** Gọi sau khi `/api/leads` trả OK (popup dùng để đổi sang lời cảm ơn). */
  onSuccess?: () => void
}

/* ───────── tiện ích trình duyệt ───────── */

function getCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`))
  return match?.[2] ?? ''
}

function getUrlParam(search: URLSearchParams, key: string): string {
  return search.get(key) ?? ''
}

/** Khách bật "giảm chuyển động" ở hệ điều hành thì nhảy thẳng — vẫn tới đúng chỗ, chỉ bỏ phần trượt. */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth')

/** Trượt tới thẻ form (`<section id="dang-ky">`). */
function scrollToForm() {
  document.getElementById('dang-ky')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
}

/* ───────── hình & kiểu ───────── */

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

const IcCon = () => (
  <svg {...ICON}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)
const IcSdt = () => (
  <svg {...ICON}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
)
const IcCoSo = () => (
  <svg {...ICON}>
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)
const IcGui = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
  </svg>
)

const CARD_STYLE: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: '22px',
  padding: 'clamp(20px,4vw,32px)',
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
  boxShadow: '0 30px 60px var(--shadow)',
}

const BADGE_STYLE: CSSProperties = {
  display: 'inline-block',
  padding: '5px 14px',
  borderRadius: '999px',
  border: '1px solid rgba(254,143,45,.5)',
  background: 'rgba(254,143,45,.12)',
  color: 'var(--accT)',
  fontWeight: 700,
  fontSize: '13px',
}

/** Một ô nhập: nhãn (+ biểu tượng, dấu * bắt buộc) · điều khiển · lỗi từng ô. */
function Truong({
  id,
  nhan,
  icon,
  batBuoc,
  loi,
  children,
}: {
  id: string
  nhan: string
  icon?: ReactNode
  batBuoc?: boolean
  loi?: string
  children: ReactNode
}) {
  return (
    <div className="fld">
      <label htmlFor={id}>
        {icon}
        {nhan}
        {batBuoc ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {loi ? (
        <p id={`${id}-loi`} className="pub-err" role="alert">
          {loi}
        </p>
      ) : null}
    </div>
  )
}

/* ───────── thân form ───────── */

export function LienHeForm({ variant, formId, onSuccess }: LienHeFormProps) {
  const p = formId ?? (variant === 'popup' ? 'p' : 'f')
  const idCua = (ten: keyof typeof HAU_TO_ID) => `${p}-${HAU_TO_ID[ten]}`
  const laPopup = variant === 'popup'
  const laTrang = variant === 'page'

  const startTimeRef = useRef<number>(Date.now())
  const didJumpRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [extraOpen, setExtraOpen] = useState(false)
  const [done, setDone] = useState(false)

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: EMPTY_VALUES,
  })
  const { register, handleSubmit, formState } = form
  const errors = formState.errors

  // Trên trang /lien-he mọi cú nhảy neo đều trượt mượt thay vì giật cái rụp; trả lại giá trị cũ
  // khi rời trang để không ảnh hưởng điều hướng của trang khác.
  useEffect(() => {
    if (!laTrang || prefersReducedMotion()) return
    const root = document.documentElement
    const prev = root.style.scrollBehavior
    root.style.scrollBehavior = 'smooth'
    return () => {
      root.style.scrollBehavior = prev
    }
  }, [laTrang])

  // Đang Ở TRÊN trang này mà bấm CTA "Đặt buổi học thử 1-1" (header / nút nổi / thanh dưới) thì URL
  // không đổi ⇒ Next không điều hướng, nút thành nút chết. Bắt click tại đây và trượt xuống form.
  useEffect(() => {
    if (!laTrang) return
    const onClick = (e: MouseEvent) => {
      // Ctrl/Cmd/Shift/chuột giữa: để nguyên cho trình duyệt mở tab mới.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href*="free-trial=true"]')
      // Chỉ nuốt click của link trỏ về CHÍNH trang này; CTA trỏ trang khác phải điều hướng bình thường.
      if (!(link instanceof HTMLAnchorElement)) return
      if (link.pathname !== window.location.pathname) return
      e.preventDefault()
      e.stopPropagation()
      scrollToForm()
    }
    // PHẢI dùng capture: `<Link>` của Next gắn handler ngay trên thẻ <a> và tự preventDefault,
    // chạy trước listener bubble ở document ⇒ bắt ở bubble là hụt.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [laTrang])

  // CTA "Đặt buổi học thử 1-1" trỏ `/lien-he?free-trial=true` (CỐ Ý không kèm `#dang-ky`: có hash
  // thì trình duyệt nhảy ngay lúc tải, cuộn mượt sau đó không còn gì để trượt). Chờ 80ms cho
  // trang dựng xong mới cuộn.
  useEffect(() => {
    if (!laTrang || didJumpRef.current) return
    const wantJump =
      new URLSearchParams(window.location.search).get('free-trial') === 'true' ||
      window.location.hash === '#dang-ky'
    if (!wantJump) return

    // Đánh dấu BÊN TRONG timer: StrictMode ở `next dev` chạy effect → cleanup → effect; set cờ
    // trước khi hẹn giờ thì lượt 1 huỷ timer, lượt 2 thấy cờ rồi return sớm ⇒ dev không cuộn.
    const timer = window.setTimeout(() => {
      didJumpRef.current = true
      scrollToForm()
      // Mobile: focus làm bàn phím ảo bật lên che form → chỉ focus từ md trở lên.
      if (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 768px)').matches) form.setFocus('hoTenCon')
    }, 80)
    return () => window.clearTimeout(timer)
  }, [laTrang, form])

  function onInvalid(errs: FieldErrors<ContactFormValues>) {
    const errorInPanel = PANEL_FIELDS.some((f) => errs[f])
    if (errorInPanel) setExtraOpen(true)

    const first = FIELD_ORDER.find((f) => errs[f])
    if (!first) return
    // Panel vừa mở cần 1 nhịp layout thì cuộn mới tới đúng chỗ.
    window.setTimeout(() => {
      document
        .getElementById(idCua(first))
        ?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
      form.setFocus(first)
    }, errorInPanel ? 80 : 0)
  }

  async function onSubmit(values: ContactFormValues) {
    setIsSubmitting(true)

    const searchParams = new URLSearchParams(window.location.search)
    const timeOnPage = Math.floor((Date.now() - startTimeRef.current) / 1000)
    const eventId = `lh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const childName = values.hoTenCon.trim()
    // Server bắt `parentName` min 2 ký tự — bỏ trống là 400 và lead bốc hơi.
    const parentName = values.hoTenPh?.trim() || `PH của ${childName}`

    const product = searchParams.get('product')
    // Popup và khối trang chủ CHÍNH LÀ "đặt buổi học thử 1-1"; trang /lien-he chỉ khi có ?free-trial=true.
    const isFreeTrial = variant !== 'page' || searchParams.get('free-trial') === 'true'
    // `?subject=` vẫn còn được dùng (`/hoc-cu` → `?subject=tu-van-hoc-cu`); không được đánh rơi.
    const subject = searchParams.get('subject')
    // Cơ sở khách chọn → MÃ thật, gửi lên `centerCode` để server quy ra `Lead.centerId`. Dòng
    // "Cơ sở: …" trong `note` vẫn giữ: ghi lại đúng NHÃN khách nhìn thấy lúc bấm.
    const centerCode = values.coSo ? CENTER_CODE_BY_LABEL.get(values.coSo) : undefined

    // Trường/lớp/tỉnh vẫn nhồi vào `note` (Lead không có cột riêng cho chúng).
    const note = [
      values.coSo ? `Cơ sở: ${values.coSo}` : '',
      values.truong?.trim() ? `Trường: ${values.truong.trim()}` : '',
      values.lop?.trim() ? `Lớp: ${values.lop.trim()}` : '',
      values.tinh?.trim() ? `Tỉnh/TP: ${values.tinh.trim()}` : '',
      subject ? `Chủ đề: ${subject}` : '',
      product ? `Quan tâm: ${product}` : '',
      isFreeTrial ? 'Đăng ký buổi học thử 1-1 miễn phí' : '',
    ]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 500)

    const attribution = readAttribution()
    const payload = {
      parentName,
      childName,
      // Chuẩn hoá TRƯỚC khi gửi — số gõ có khoảng trắng gửi thô sẽ bị 400.
      phone: canonicalPhone(values.sdt) ?? values.sdt.trim(),
      email: values.email?.trim() || undefined,
      source: 'lien-he',
      centerCode,
      note,
      eventId,
      timeOnPage,
      website: values.website ?? '',
      // BLĐ chốt 22/09/2026 — khách đồng ý MỘT LƯỢT: tích ô Chính sách bảo mật là đồng ý cả việc
      // nhận tin tư vấn/ưu đãi (đã ghi vào mục 3 của Chính sách bảo mật).
      consentMarketing: values.dongYCsbm,
      dongYChinhSachBaoMat: values.dongYCsbm,
      landingPage: typeof window !== 'undefined' ? window.location.href : undefined,
      referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
      // Tham số trên URL HIỆN TẠI ưu tiên; thiếu thì lấy bản đã giữ từ lúc khách vào site (khách vào
      // `/?ref=X&utm_source=fb` rồi mới sang /lien-he thì URL ở đây đã sạch).
      utmSource: getUrlParam(searchParams, 'utm_source') || attribution.utmSource,
      utmMedium: getUrlParam(searchParams, 'utm_medium') || attribution.utmMedium,
      utmCampaign: getUrlParam(searchParams, 'utm_campaign') || attribution.utmCampaign,
      utmTerm: getUrlParam(searchParams, 'utm_term') || attribution.utmTerm,
      utmContent: getUrlParam(searchParams, 'utm_content') || attribution.utmContent,
      fbclid: getUrlParam(searchParams, 'fbclid') || attribution.fbclid,
      gclid: getUrlParam(searchParams, 'gclid') || attribution.gclid,
      // `ref` là FIRST-TOUCH (09/10/2026): `attribution.ref` đã gộp CẢ ref trên URL hiện tại (AttributionCapture chạy lúc tải trang) theo luật
      // "giữ ref đầu còn hạn 90 ngày" — nên nó đứng TRƯỚC. Đảo thứ tự cũ (URL trước) là để link giới thiệu thứ hai đè link thứ nhất ngay lúc submit,
      // phá hết công của cookie. URL chỉ còn là đường lùi khi cookie không ghi được (trình duyệt chặn).
      ref: attribution.ref || getUrlParam(searchParams, 'ref'),
      // AFF-P1 (audit XI·L2): link giới thiệu Affiliate /r/<token> chuyển tới trang đích kèm ?aff=&clk=. LAST-TOUCH như UTM: URL hiện tại trước, rồi bản đã giữ trong cookie nguồn.
      // CẶP (token + lượt bấm của chính token đó): URL có `aff` thì dùng cặp trên URL (`clk` có thể trống), không ghép `clk` cũ trong cookie với `aff` mới. Cắt 40 ký tự như cookie — validator từ chối dài hơn và khách mất lead.
      ...(getUrlParam(searchParams, 'aff')
        ? { aff: getUrlParam(searchParams, 'aff').slice(0, 40), clk: getUrlParam(searchParams, 'clk').slice(0, 40) || undefined }
        : { aff: attribution.aff, clk: attribution.clk }),
      fbp: getCookie('_fbp') || undefined,
      fbc: getCookie('_fbc') || undefined,
    }

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()

      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? 'Lỗi hệ thống')
      }

      form.reset(EMPTY_VALUES)
      setExtraOpen(false)
      setDone(true)
      onSuccess?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi hệ thống'
      toast.error('Gửi thất bại', { description: message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const loiCua = (ten: keyof ContactFormValues) => {
    const m = errors[ten]?.message
    return typeof m === 'string' ? m : undefined
  }
  const aria = (ten: keyof typeof HAU_TO_ID) => ({
    'aria-invalid': errors[ten] ? true : undefined,
    'aria-describedby': errors[ten] ? `${idCua(ten)}-loi` : undefined,
  })

  /* ----- thân các ô ----- */
  const cacO = (
    <>
      {/* Honeypot — ẩn khỏi người dùng, bot sẽ điền */}
      <input
        type="text"
        {...register('website')}
        style={{ display: 'none' }}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      <Truong id={idCua('hoTenCon')} nhan="Họ và tên con" icon={<IcCon />} batBuoc loi={loiCua('hoTenCon')}>
        <input
          id={idCua('hoTenCon')}
          className="inp"
          type="text"
          autoComplete="off"
          placeholder="VD: Nguyễn Minh Khoa"
          {...aria('hoTenCon')}
          {...register('hoTenCon')}
        />
      </Truong>

      <Truong id={idCua('sdt')} nhan="ĐT di động phụ huynh" icon={<IcSdt />} batBuoc loi={loiCua('sdt')}>
        <input
          id={idCua('sdt')}
          className="inp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="VD: 09xx xxx xxx"
          {...aria('sdt')}
          {...register('sdt')}
        />
      </Truong>

      <Truong id={idCua('coSo')} nhan="Chọn cơ sở học" icon={<IcCoSo />} batBuoc loi={loiCua('coSo')}>
        <select id={idCua('coSo')} className="inp" {...aria('coSo')} {...register('coSo')}>
          {CENTER_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Truong>

      {laPopup ? null : (
        <>
          {/* Nút mở rộng — giữ form chính đúng 3 ô để phụ huynh điền nhanh. */}
          <button
            type="button"
            onClick={() => setExtraOpen(true)}
            aria-expanded={extraOpen}
            aria-controls={`${p}-them`}
            style={{
              display: extraOpen ? 'none' : 'flex',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
              textAlign: 'left',
              padding: '14px 16px',
              borderRadius: '14px',
              border: '1.5px dashed rgba(254,143,45,.7)',
              background: 'rgba(254,143,45,.08)',
              cursor: 'pointer',
              font: 'inherit',
              color: 'var(--text)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '36px',
                height: '36px',
                flexShrink: 0,
                borderRadius: '999px',
                background: '#f97316',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                fontWeight: 700,
              }}
            >
              +
            </span>
            <span style={{ flexGrow: 1 }}>
              <strong style={{ display: 'block', color: 'var(--accT)' }}>Thêm thông tin để xếp lớp nhanh hơn</strong>
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Trường, lớp, tỉnh/thành — không bắt buộc</span>
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {/* Panel LUÔN mount, chỉ ẩn/hiện — đóng lại không mất giá trị đã nhập. */}
          <div
            id={`${p}-them`}
            style={{
              display: extraOpen ? 'flex' : 'none',
              border: '1.5px solid rgba(254,143,45,.55)',
              borderRadius: '14px',
              padding: '16px',
              flexDirection: 'column',
              gap: '14px',
              background: 'rgba(254,143,45,.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '14px' }}>
                <strong style={{ color: 'var(--accT)' }}>Thêm thông tin </strong>
                <span style={{ color: 'var(--muted)' }}>(không bắt buộc)</span>
              </span>
              <button
                type="button"
                onClick={() => setExtraOpen(false)}
                aria-label="Thu gọn"
                style={{ width: '36px', height: '36px', border: 0, background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: '18px' }}
              >
                ×
              </button>
            </div>
            <Truong id={idCua('hoTenPh')} nhan="Họ tên phụ huynh" loi={loiCua('hoTenPh')}>
              <input id={idCua('hoTenPh')} className="inp" type="text" autoComplete="name" placeholder="VD: Nguyễn Văn A" {...aria('hoTenPh')} {...register('hoTenPh')} />
            </Truong>
            <Truong id={idCua('email')} nhan="Email phụ huynh" loi={loiCua('email')}>
              <input id={idCua('email')} className="inp" type="email" inputMode="email" autoComplete="email" placeholder="(không bắt buộc)" {...aria('email')} {...register('email')} />
            </Truong>
            <Truong id={idCua('truong')} nhan="Trường con đang học" loi={loiCua('truong')}>
              <input id={idCua('truong')} className="inp" type="text" placeholder="VD: Trường Tiểu học Hoàng Văn Thụ" {...aria('truong')} {...register('truong')} />
            </Truong>
            <Truong id={idCua('lop')} nhan="Lớp con đang học" loi={loiCua('lop')}>
              <input id={idCua('lop')} className="inp" type="text" placeholder="VD: Lớp 4" {...aria('lop')} {...register('lop')} />
            </Truong>
            <Truong id={idCua('tinh')} nhan="Tỉnh/Thành phố" loi={loiCua('tinh')}>
              <select id={idCua('tinh')} className="inp" {...aria('tinh')} {...register('tinh')}>
                {VN_PROVINCES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Truong>
            <button
              type="button"
              onClick={() => setExtraOpen(false)}
              className="btn btn-line"
              style={{ width: '100%', color: 'var(--accT)', borderColor: 'rgba(254,143,45,.6)' }}
            >
              Xong
            </button>
          </div>
        </>
      )}

      {/* Hồ sơ BCT mục 3 — ô tích đồng ý; `z.literal(true)` trong schema đã chặn submit + hiện lỗi dưới ô. */}
      <OTichChinhSach
        {...register('dongYCsbm')}
        id={idCua('dongYCsbm')}
        loi={loiCua('dongYCsbm') ?? null}
        disabled={isSubmitting}
        wrapperClassName={laPopup ? 'pub-ok pub-ok-sm' : 'pub-ok'}
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn btn-acc"
        style={{
          width: '100%',
          minHeight: laPopup ? '54px' : '56px',
          fontSize: laPopup ? '15px' : '16px',
          letterSpacing: laPopup ? undefined : '.02em',
          boxShadow: '0 14px 30px rgba(249,115,22,.35)',
          opacity: isSubmitting ? 0.65 : undefined,
          cursor: isSubmitting ? 'not-allowed' : undefined,
        }}
      >
        <IcGui />
        {isSubmitting ? 'Đang gửi...' : 'ĐẶT BUỔI HỌC THỬ 1-1 MIỄN PHÍ'}
      </button>

      {laPopup ? null : (
        <p style={{ margin: 0, textAlign: 'center', fontSize: '13px', color: 'var(--muted)' }}>
          Thông tin của bạn được bảo mật tuyệt đối. Gửi thông tin đồng nghĩa bạn đồng ý để Sata Robo liên hệ tư vấn theo{' '}
          <Link href="/chinh-sach-bao-mat">chính sách bảo mật</Link>.
        </p>
      )}
    </>
  )

  const thanThanhCong = (
    <div style={{ ...CARD_STYLE, alignItems: 'center', textAlign: 'center', gap: 0 }} role="status">
      <Image src="/pub/da7446f042256bc74bcdfe2e701329c9.webp" alt="" aria-hidden="true" width={642} height={714} className={variant === 'home' ? 'bob' : undefined} style={{ width: '140px', height: 'auto' }} />
      <p style={{ margin: '10px 0 6px', fontFamily: "var(--font-unbounded),'Unbounded',sans-serif", fontWeight: 600, fontSize: '22px' }}>Cảm ơn ba mẹ!</p>
      <p style={{ margin: '0 0 18px', color: 'var(--muted)' }}>
        Sata Robo sẽ gọi lại trong 30 phút (trong giờ làm việc: {GIO_LAM_VIEC}).
      </p>
      <button type="button" onClick={() => setDone(false)} className="btn btn-line">
        Gửi thêm một bé khác
      </button>
    </div>
  )

  const formEl = (
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      noValidate
      style={laPopup ? { display: 'flex', flexDirection: 'column', gap: '14px' } : CARD_STYLE}
    >
      {cacO}
    </form>
  )

  if (laPopup) return formEl

  /* ----- khung mục (tiêu đề + hình dán) cho `page` / `home` ----- */
  const laHome = variant === 'home'
  const khoiForm = done ? thanThanhCong : formEl

  const tieuDe = (
    <div className={laHome ? 'sv a-pop' : undefined} style={{ textAlign: 'center', marginBottom: '28px' }}>
      <span style={BADGE_STYLE}>Đặt buổi học thử 1-1</span>
      <h2 style={{ marginTop: '14px' }}>
        Để lại thông tin, <span className="grad">chúng tôi gọi lại</span>
      </h2>
      <p style={{ margin: '10px 0 0', color: 'var(--muted)' }}>
        {CAU_PHAN_HOI}
      </p>
    </div>
  )

  if (laHome) {
    return (
      <section id="lien-he" className="sec" style={{ position: 'relative', overflowX: 'clip' }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: '40%',
            width: '900px',
            height: '700px',
            marginLeft: '-450px',
            borderRadius: '999px',
            background: 'radial-gradient(closest-side, var(--glowA), transparent 70%)',
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        />
        <div className="wrap" style={{ maxWidth: '680px', position: 'relative' }}>
          {tieuDe}
          <div className="sv a-form" style={{ position: 'relative' }}>
            <Image width={634} height={646} className="sticker float hide-sm" src="/pub/9ae4558c2081175d5a405b660b794651.webp" alt="" aria-hidden="true" style={{ left: '-150px', top: '40px', width: '150px', height: 'auto' }} />
            <Image width={562} height={726} className="sticker bob hide-sm" src="/pub/1c1303f2271fc141c6f40e95384b5c23.webp" alt="" aria-hidden="true" style={{ right: '-140px', bottom: '60px', width: '130px', height: 'auto' }} />
            {khoiForm}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      id="dang-ky"
      className="sec gridbg"
      style={{ backgroundColor: 'var(--bg2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', overflowX: 'clip' }}
    >
      <div className="wrap" style={{ maxWidth: '680px', position: 'relative' }}>
        {tieuDe}
        <div style={{ position: 'relative' }}>
          <Image width={642} height={724} className="sticker hide-sm" src="/pub/21be53cabd4ac017cdbde87433593cfb.webp" alt="" aria-hidden="true" style={{ left: '-160px', top: '40px', width: '150px', height: 'auto' }} />
          <Image width={512} height={758} className="sticker hide-sm" src="/pub/42d4d66e4311582de0d03b3122bb7b04.webp" alt="" aria-hidden="true" style={{ right: '-150px', bottom: '60px', width: '130px', height: 'auto' }} />
          {khoiForm}
        </div>
      </div>
    </section>
  )
}
