'use client'

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import type { FieldErrors } from 'react-hook-form'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { phoneVn } from '@/lib/validators/phone'
import { canonicalPhone } from '@/lib/phone'
import { readAttribution } from '@/lib/marketing/attribution'
import { operationalLocations } from '@/lib/locations'
import { VN_PROVINCES, VN_PROVINCE_DEFAULT } from '@/lib/vn-provinces'
import { GlowOrb } from '@/components/design-system/effects/glow-orb'
import { tokens } from '@/lib/design-tokens'
import { toast } from 'sonner'
import {
  AlertCircle,
  Building2,
  ChevronDown,
  GraduationCap,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  School,
  Send,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  useFormField,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { OTichChinhSach } from '@/components/public/o-tich-chinh-sach'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Cơ sở lấy ĐỘNG từ `lib/locations` — mở CS3 chỉ cần thêm data, không sửa form.
// Value TRÙNG nhãn: Lead không có cột cơ sở nên giá trị đi thẳng vào `note` dạng
// chữ, và `Select` của base-ui hiển thị chính giá trị (không tự tra nhãn như Radix)
// — tách value/label sẽ khiến ô hiện mỗi địa chỉ, mất tiền tố "Cơ sở 1".
const centerLabel = (name: string, address: string) =>
  `${name.split(' - ')[0] ?? name} - ${address}`

/**
 * Nhãn hiển thị → MÃ cơ sở (`Center.code`, vd "CS1"), 03/09/2026.
 *
 * Vì sao cần: ô cơ sở dùng chính NHÃN làm value (xem chú thích trên — `Select`
 * của base-ui hiện giá trị thô, không tra nhãn như Radix), nên nhãn là thứ duy
 * nhất form có trong tay. Bản đồ này quy nó về mã thật để gửi lên server.
 *
 * TRƯỚC BẢN VÁ NÀY lựa chọn của khách chỉ được nhồi vào `note` dạng chữ
 * ("Cơ sở: Cơ sở 2 - 114 Hoàng Diệu"), còn `Lead.centerId` để trống. Hệ quả:
 * lead web KHÔNG bao giờ về đúng cơ sở khách chọn — nó rơi vào nhánh "hệ thống
 * tự chọn cơ sở đều tay" của bộ chia, tức là chia sang cơ sở khác cũng được.
 */
const CENTER_CODE_BY_LABEL = new Map(
  operationalLocations().map((loc) => [centerLabel(loc.name, loc.address), loc.code]),
)

const CENTER_OPTIONS = operationalLocations().map((loc) =>
  centerLabel(loc.name, loc.address),
)

const DEFAULT_CENTER = (() => {
  const hq = operationalLocations().find((l) => l.isHQ)
  return hq ? centerLabel(hq.name, hq.address) : (CENTER_OPTIONS[0] ?? '')
})()

// Email: siết cho KHỚP `z.string().email()` của server (`lib/validators/lead.ts`).
// Regex lỏng kiểu `[^\s@]+@[^\s@]+\.[^\s@]+` cho "a@b..c" qua client rồi bị server
// trả 400 — mất cả lead chỉ vì một ô KHÔNG bắt buộc.
const EMAIL_RE = /^[^\s@.][^\s@]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/

// Ô không bắt buộc: bỏ trống thì bỏ qua, có nhập mới soi. Dùng `.refine` chứ
// KHÔNG `.optional().or(z.literal(''))` — union làm zod nuốt message riêng và
// FormMessage sẽ hiện "Invalid input" thay vì câu tiếng Việt.
const optionalText = (message: string) =>
  z
    .string()
    .optional()
    .refine((v) => {
      const s = (v ?? '').trim()
      return s === '' || (s.length >= 2 && s.length <= 100)
    }, { message })

const contactSchema = z.object({
  // Trần 93 ký tự: khi bỏ trống ô "Họ tên phụ huynh", `parentName` = "PH của <tên
  // con>" (+7 ký tự) và server chặn `parentName` max 100.
  hoTenCon: z
    .string()
    .trim()
    .min(2, 'Vui lòng nhập họ và tên con.')
    .max(93, 'Họ tên con quá dài.'),
  // phoneVn CHUẨN HOÁ (không phải regex) — "0905 123 456" phải qua được.
  sdt: phoneVn,
  coSo: z.string().min(1, 'Vui lòng chọn cơ sở.'),
  // 5 field dưới đây nằm trong panel mở rộng — tất cả không bắt buộc.
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
  // Hồ sơ BCT mục 3 — ô tích đồng ý Chính sách bảo mật.
  // `z.literal(true)` chứ KHÔNG phải `z.boolean()`: literal làm chính zodResolver chặn
  // submit và tự hiện lỗi dưới ô, khỏi phải thêm điều kiện rời ở nút gửi (một cổng, một
  // chỗ). `z.boolean()` sẽ cho `false` đi qua.
  dongYCsbm: z.literal(true, {
    message: 'Vui lòng đọc và đồng ý với Chính sách bảo mật.',
  }),
})

type ContactFormValues = z.infer<typeof contactSchema>

/** Field nằm trong panel "Thêm thông tin" — dùng để tự mở panel khi submit lỗi. */
const PANEL_FIELDS = ['hoTenPh', 'email', 'truong', 'lop', 'tinh'] as const

/** Thứ tự hiển thị trên UI — quyết định "lỗi đầu tiên" để cuộn tới. */
const FIELD_ORDER = [
  'hoTenCon',
  'sdt',
  'coSo',
  'hoTenPh',
  'email',
  'truong',
  'lop',
  'tinh',
] as const

const fieldDomId = (name: string) => `lienhe-field-${name}`
const EXTRA_PANEL_ID = 'lienhe-extra-panel'

// Ô nhập kiểu form quatang: cao, bo tròn, viền dày nhạt, focus viền cam + quầng.
// shadcn `Input` mặc định h-9 nhìn chật so với form landing → override qua className
// (tailwind-merge lấy lớp truyền sau) chứ KHÔNG sửa `components/ui/input.tsx` dùng chung.
// `md:text-base` phải ghi RÕ: `components/ui/input.tsx` có sẵn `md:text-base→sm`,
// mà `text-base` trần KHÔNG đè được biến thể `md:` ⇒ từ 768px trở lên ô chữ tụt về
// 14px trong khi ô select vẫn 16px, nhìn lệch nhau ngay trong cùng một form.
// `aria-invalid:ring-4` cũng phải ghi RÕ: `SelectTrigger` không có sẵn ring lỗi như
// `Input`, thiếu dòng này thì ô cơ sở/tỉnh báo lỗi chỉ đổi viền, nhạt hơn hẳn ô chữ.
const INPUT_CLASS =
  'h-12 w-full rounded-xl border-2 border-neutral-200 bg-white px-4 text-base md:text-base ' +
  'placeholder:text-neutral-400 transition-colors ' +
  'focus-visible:border-orange-400 focus-visible:ring-4 focus-visible:ring-orange-100 ' +
  'aria-invalid:border-red-400 aria-invalid:ring-4 aria-invalid:ring-red-100'

// `data-[size=default]:h-12` chứ KHÔNG phải `h-12`: `SelectTrigger` khoá chiều cao
// bằng `data-[size=default]:h-8`, selector có attribute nên thắng class trần và
// tailwind-merge cũng không coi hai lớp khác biến thể là xung đột ⇒ ô select lùn
// 32px đứng cạnh ô chữ 48px.
const TRIGGER_CLASS = `${INPUT_CLASS} data-[size=default]:h-12 justify-between text-left font-normal`

// `Label` của shadcn vốn là `flex items-center gap-2` — icon và chữ là 2 flex item,
// nên KHÔNG dùng `inline`/`vertical-align` (bị flex nuốt). Siết `gap-1.5` cho icon
// bám sát chữ như form legacy.
const LABEL_CLASS = 'flex items-center gap-1.5 text-sm font-bold text-neutral-800'

/** Nhãn có icon cam — cùng một bộ với form đăng ký legacy (`RegistrationForm`) để
 *  hai form đăng ký của Sata Robo nhìn như một, khách đi từ landing sang không lạ mắt. */
function FieldLabel({
  icon: Icon,
  required,
  children,
}: {
  icon: LucideIcon
  required?: boolean
  children: ReactNode
}) {
  return (
    <FormLabel className={LABEL_CLASS}>
      <Icon className="h-4 w-4 flex-shrink-0 text-orange-500" />
      {/* Gói chữ + dấu * trong 1 <span>: để trần thì dấu * thành flex item riêng,
          bị `gap` đẩy ra xa thành "Họ và tên con   *". */}
      <span>
        {children}
        {required && <span className="text-orange-600"> *</span>}
      </span>
    </FormLabel>
  )
}

/** Thay `FormMessage` mặc định: thêm icon cảnh báo cho khớp form legacy. Dùng
 *  `useFormField()` để lấy đúng `formMessageId` mà `FormControl` đã trỏ
 *  `aria-describedby` tới — tự viết id sẽ làm đứt liên kết cho screen reader. */
function FieldError() {
  const { error, formMessageId } = useFormField()
  if (!error?.message) return null
  // Không đặt `mt-*`: `FormItem` là `space-y-2`, selector `> * + *` thắng
  // specificity nên margin tự viết ở đây bị nuốt.
  return (
    <p
      id={formMessageId}
      className="flex items-center gap-1.5 text-xs font-semibold text-red-600"
    >
      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
      {String(error.message)}
    </p>
  )
}

function getCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`))
  return match?.[2] ?? ''
}

function getUrlParam(search: URLSearchParams, key: string): string {
  return search.get(key) ?? ''
}

/** Khách bật "giảm chuyển động" ở hệ điều hành (say chuyển động, tiền đình) thì
 *  nhảy thẳng — vẫn tới đúng chỗ, chỉ bỏ phần trượt. */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth')

/** Trượt tới thẻ form (`<section id="dang-ky">`, đã có `scroll-mt-24` chừa header dính). */
function scrollToForm() {
  document
    .getElementById('dang-ky')
    ?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
}

function ContactFormInner() {
  const searchParams = useSearchParams()
  const startTimeRef = useRef<number>(Date.now())
  const didJumpRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [extraOpen, setExtraOpen] = useState(false)

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      hoTenCon: '',
      sdt: '',
      coSo: DEFAULT_CENTER,
      hoTenPh: '',
      email: '',
      truong: '',
      lop: '',
      tinh: VN_PROVINCE_DEFAULT,
      website: '',
      // Mặc định CHƯA tích — ảnh minh hoạ của hướng dẫn BCT vẽ ô vuông rỗng.
      dongYCsbm: false as unknown as true,
    },
  })

  // Trên trang này mọi cú nhảy neo (#dang-ky gõ tay, bookmark, link trong trang)
  // đều trượt mượt thay vì giật cái rụp. Trả lại giá trị cũ khi rời trang để
  // không ảnh hưởng điều hướng của các trang khác.
  useEffect(() => {
    if (prefersReducedMotion()) return
    const root = document.documentElement
    const prev = root.style.scrollBehavior
    root.style.scrollBehavior = 'smooth'
    return () => {
      root.style.scrollBehavior = prev
    }
  }, [])

  // Đang Ở TRÊN trang này mà bấm CTA "Đặt buổi học thử 1-1" (header / nút nổi / thanh
  // dính mobile) thì URL không đổi ⇒ Next không điều hướng, effect không chạy lại,
  // nút thành nút chết. Bắt click ngay tại đây và trượt xuống form.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Ctrl/Cmd/Shift/chuột giữa: để nguyên cho trình duyệt mở tab mới.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href*="free-trial=true"]')
      // Chỉ nuốt click của link trỏ về CHÍNH trang này. Mai mốt có ai đặt CTA
      // `/khoa-hoc?free-trial=true` thì nó phải điều hướng bình thường, không thì
      // bấm mãi vẫn đứng yên tại /lien-he mà chẳng ai hiểu vì sao.
      if (!(link instanceof HTMLAnchorElement)) return
      if (link.pathname !== window.location.pathname) return
      e.preventDefault()
      e.stopPropagation()
      scrollToForm()
    }
    // PHẢI dùng capture: `<Link>` của Next gắn handler ngay trên thẻ <a> và tự gọi
    // preventDefault, chạy trước listener bubble ở document ⇒ bắt ở bubble là hụt.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // CTA "Đặt buổi học thử 1-1" trỏ `/lien-he?free-trial=true` (CỐ Ý không kèm `#dang-ky`:
  // có hash thì trình duyệt nhảy tới nơi ngay lúc tải, cuộn mượt sau đó không còn
  // gì để trượt). Không hash ⇒ trang mở ở đầu rồi trượt xuống form cho khách thấy
  // đường đi. Chờ 80ms cho Suspense render xong mới cuộn.
  useEffect(() => {
    if (didJumpRef.current) return
    const wantJump =
      searchParams.get('free-trial') === 'true' || window.location.hash === '#dang-ky'
    if (!wantJump) return

    // Đánh dấu BÊN TRONG timer: StrictMode ở `next dev` chạy effect → cleanup →
    // effect. Nếu set cờ trước khi hẹn giờ thì lượt 1 huỷ timer, lượt 2 thấy cờ
    // rồi return sớm ⇒ dev không bao giờ cuộn (prod thì có) — bẫy "chạy prod mới được".
    const timer = window.setTimeout(() => {
      didJumpRef.current = true
      scrollToForm()
      // Mobile: focus làm bàn phím ảo bật lên che form → chỉ focus từ md trở lên.
      if (window.matchMedia('(min-width: 768px)').matches) form.setFocus('hoTenCon')
    }, 80)
    return () => window.clearTimeout(timer)
  }, [searchParams, form])

  function onInvalid(errors: FieldErrors<ContactFormValues>) {
    const errorInPanel = PANEL_FIELDS.some((f) => errors[f])
    if (errorInPanel) setExtraOpen(true)

    const first = FIELD_ORDER.find((f) => errors[f])
    if (!first) return
    // Panel vừa mở cần 1 nhịp layout thì cuộn mới tới đúng chỗ.
    window.setTimeout(() => {
      document
        .getElementById(fieldDomId(first))
        ?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
      form.setFocus(first)
    }, errorInPanel ? 80 : 0)
  }

  async function onSubmit(values: ContactFormValues) {
    setIsSubmitting(true)

    const timeOnPage = Math.floor((Date.now() - startTimeRef.current) / 1000)
    const eventId = `lh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const childName = values.hoTenCon.trim()
    // Server bắt `parentName` min 2 ký tự — bỏ trống là 400 và lead bốc hơi.
    const parentName = values.hoTenPh?.trim() || `PH của ${childName}`

    const product = searchParams.get('product')
    const isFreeTrial = searchParams.get('free-trial') === 'true'
    // `?subject=` vẫn còn được dùng (`/hoc-cu` → `?subject=tu-van-hoc-cu`). Form đã
    // bỏ dropdown chủ đề nhưng KHÔNG được đánh rơi tham số, nếu không sale mất
    // thông tin khách hỏi về học cụ chứ không phải khoá học.
    const subject = searchParams.get('subject')
    // Cơ sở khách chọn → MÃ thật, gửi lên `centerCode` để server quy ra
    // `Lead.centerId`. Dòng "Cơ sở: …" trong `note` vẫn giữ: nó ghi lại đúng
    // NHÃN khách nhìn thấy lúc bấm, hữu ích khi đối chiếu về sau — nhưng từ nay
    // `centerId` mới là nguồn quyết định lead về cơ sở nào.
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
      // BLĐ chốt 22/09/2026 — khách đồng ý MỘT LƯỢT: tích ô Chính sách bảo mật là đồng ý
      // cả việc nhận tin tư vấn/ưu đãi (đã ghi vào mục 3 của Chính sách bảo mật).
      // Trước đó ô này đóng cứng `true`, tức khai khống một sự đồng ý chưa ai cho.
      consentMarketing: values.dongYCsbm,
      dongYChinhSachBaoMat: values.dongYCsbm,
      landingPage: typeof window !== 'undefined' ? window.location.href : undefined,
      referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
      // Tham số trên URL HIỆN TẠI ưu tiên; thiếu thì lấy bản đã giữ từ lúc khách
      // vào site (khách vào `/?ref=X&utm_source=fb` rồi mới bấm sang /lien-he thì
      // URL ở đây đã sạch — trước bản vá này nguồn mất trắng).
      utmSource: getUrlParam(searchParams, 'utm_source') || attribution.utmSource,
      utmMedium: getUrlParam(searchParams, 'utm_medium') || attribution.utmMedium,
      utmCampaign: getUrlParam(searchParams, 'utm_campaign') || attribution.utmCampaign,
      utmTerm: getUrlParam(searchParams, 'utm_term') || attribution.utmTerm,
      utmContent: getUrlParam(searchParams, 'utm_content') || attribution.utmContent,
      fbclid: getUrlParam(searchParams, 'fbclid') || attribution.fbclid,
      gclid: getUrlParam(searchParams, 'gclid') || attribution.gclid,
      ref: getUrlParam(searchParams, 'ref') || attribution.ref,
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

      toast.success('Gửi thành công!', {
        description: 'Đội ngũ Sata Robo sẽ liên hệ với bạn trong vòng 30 phút.',
      })
      form.reset({
        hoTenCon: '',
        sdt: '',
        coSo: DEFAULT_CENTER,
        hoTenPh: '',
        email: '',
        truong: '',
        lop: '',
        tinh: VN_PROVINCE_DEFAULT,
        website: '',
        // Reset về CHƯA tích: lượt gửi sau là một lượt đồng ý mới, không thừa kế lượt trước.
        dongYCsbm: false as unknown as true,
      })
      setExtraOpen(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi hệ thống'
      toast.error('Gửi thất bại', { description: message })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-5" noValidate>
        {/* Honeypot — ẩn khỏi người dùng, bot sẽ fill */}
        <input
          type="text"
          {...form.register('website')}
          className="hidden"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />

        {/* Họ và tên con */}
        <FormField
          control={form.control}
          name="hoTenCon"
          render={({ field }) => (
            <FormItem id={fieldDomId('hoTenCon')}>
              <FieldLabel icon={User} required>
                Họ và tên con
              </FieldLabel>
              <FormControl>
                <Input
                  type="text"
                  placeholder="VD: Nguyễn Minh Khoa"
                  autoComplete="off"
                  className={INPUT_CLASS}
                  {...field}
                />
              </FormControl>
              <FieldError />
            </FormItem>
          )}
        />

        {/* ĐT di động phụ huynh */}
        <FormField
          control={form.control}
          name="sdt"
          render={({ field }) => (
            <FormItem id={fieldDomId('sdt')}>
              <FieldLabel icon={Phone} required>
                ĐT di động phụ huynh
              </FieldLabel>
              <FormControl>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="VD: 09xx xxx xxx"
                  className={INPUT_CLASS}
                  {...field}
                />
              </FormControl>
              <FieldError />
            </FormItem>
          )}
        />

        {/* Cơ sở học */}
        <FormField
          control={form.control}
          name="coSo"
          render={({ field }) => (
            <FormItem id={fieldDomId('coSo')}>
              <FieldLabel icon={MapPin} required>
                Chọn cơ sở học
              </FieldLabel>
              <Select value={field.value} onValueChange={(v) => field.onChange(v ?? DEFAULT_CENTER)}>
                <FormControl>
                  <SelectTrigger className={TRIGGER_CLASS}>
                    <SelectValue placeholder="Chọn cơ sở..." />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {CENTER_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError />
            </FormItem>
          )}
        />

        {/* Mở rộng — giữ form chính đúng 3 ô để phụ huynh điền nhanh.
            Dạng thẻ viền cam đứt nét thay vì dòng chữ mảnh: phụ huynh dễ thấy nên
            chịu bấm vào điền thêm trường/lớp/tỉnh, sale đỡ phải hỏi lại qua điện thoại. */}
        <button
          type="button"
          hidden={extraOpen}
          onClick={() => setExtraOpen(true)}
          aria-expanded={extraOpen}
          aria-controls={EXTRA_PANEL_ID}
          className="group flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/70 px-4 py-3.5 text-left transition-colors hover:border-orange-400 hover:bg-orange-50"
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-white shadow-sm shadow-orange-500/40 transition-transform group-hover:scale-105">
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-orange-700">
              Thêm thông tin để xếp lớp nhanh hơn
            </span>
            <span className="block text-xs text-neutral-500">
              Trường, lớp, tỉnh/thành — không bắt buộc
            </span>
          </span>
          <ChevronDown className="h-5 w-5 flex-shrink-0 text-orange-500 transition-transform group-hover:translate-y-0.5" />
        </button>

        {/* Panel LUÔN mount, chỉ ẩn/hiện — đóng lại không mất giá trị đã nhập */}
        <div
          id={EXTRA_PANEL_ID}
          hidden={!extraOpen}
          className="space-y-4 rounded-2xl border-2 border-orange-200 bg-orange-50/50 p-4 sm:p-5"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-orange-700">
              Thêm thông tin{' '}
              <span className="font-normal text-neutral-500">(không bắt buộc)</span>
            </p>
            <button
              type="button"
              aria-label="Đóng"
              onClick={() => setExtraOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-neutral-500 transition-colors hover:bg-white hover:text-neutral-800"
            >
              ×
            </button>
          </div>

          <FormField
            control={form.control}
            name="hoTenPh"
            render={({ field }) => (
              <FormItem id={fieldDomId('hoTenPh')}>
                <FieldLabel icon={Users}>Họ tên phụ huynh</FieldLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder="VD: Nguyễn Văn A"
                    autoComplete="name"
                    className={INPUT_CLASS}
                    {...field}
                  />
                </FormControl>
                <FieldError />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem id={fieldDomId('email')}>
                <FieldLabel icon={Mail}>Email phụ huynh</FieldLabel>
                <FormControl>
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="(không bắt buộc)"
                    className={INPUT_CLASS}
                    {...field}
                  />
                </FormControl>
                <FieldError />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="truong"
            render={({ field }) => (
              <FormItem id={fieldDomId('truong')}>
                <FieldLabel icon={School}>Trường con đang học</FieldLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder="VD: Trường Tiểu học Hoàng Văn Thụ"
                    className={INPUT_CLASS}
                    {...field}
                  />
                </FormControl>
                <FieldError />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lop"
            render={({ field }) => (
              <FormItem id={fieldDomId('lop')}>
                <FieldLabel icon={GraduationCap}>Lớp con đang học</FieldLabel>
                <FormControl>
                  <Input type="text" placeholder="VD: Lớp 4" className={INPUT_CLASS} {...field} />
                </FormControl>
                <FieldError />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tinh"
            render={({ field }) => (
              <FormItem id={fieldDomId('tinh')}>
                <FieldLabel icon={Building2}>Tỉnh/Thành phố</FieldLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v ?? VN_PROVINCE_DEFAULT)}
                >
                  <FormControl>
                    <SelectTrigger className={TRIGGER_CLASS}>
                      <SelectValue placeholder="Chọn tỉnh/thành phố..." />
                    </SelectTrigger>
                  </FormControl>
                  {/* 63 tỉnh — bắt buộc giới hạn chiều cao để list cuộn được */}
                  <SelectContent className="max-h-72">
                    {VN_PROVINCES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError />
              </FormItem>
            )}
          />

          <button
            type="button"
            onClick={() => setExtraOpen(false)}
            className="w-full rounded-xl border-2 border-orange-300 bg-white py-2.5 text-sm font-bold text-orange-700 transition-colors hover:bg-orange-100"
          >
            Xong
          </button>
        </div>

        {/* Hồ sơ BCT mục 3. Trước 21/09/2026 chỗ này chỉ có đoạn <p> "Gửi thông tin đồng
            nghĩa bạn đồng ý…" ngay dưới nút — đó là DÒNG CHỮ, không phải ô tích, và hồ sơ
            đòi ô tích. Nút gửi KHÔNG cần thêm điều kiện: `z.literal(true)` trong
            `contactSchema` đã khiến zodResolver chặn submit và hiện lỗi dưới ô. */}
        <OTichChinhSach
          {...form.register('dongYCsbm')}
          loi={form.formState.errors.dongYCsbm?.message ?? null}
          disabled={isSubmitting}
          wrapperClassName="text-text-muted"
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary cta-pulse cta-shine h-14 w-full justify-center rounded-xl text-base font-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Đang gửi...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              ĐẶT BUỔI HỌC THỬ 1-1 MIỄN PHÍ
            </>
          )}
        </button>

        <p className="text-xs text-text-muted text-center">
          Thông tin của bạn được bảo mật tuyệt đối. Gửi thông tin đồng nghĩa bạn
          đồng ý để Sata Robo liên hệ tư vấn theo{' '}
          <a href="/chinh-sach-bao-mat" className="text-primary-purple underline">
            chính sách bảo mật
          </a>
          .
        </p>
      </form>
    </Form>
  )
}

// `id="dang-ky"` để ai gõ/bookmark `#dang-ky` vẫn tới đúng chỗ. CTA "Đặt buổi học thử 1-1"
// thì dùng `?free-trial=true` KHÔNG kèm hash — xem lý do ở effect cuộn mượt bên trên.
// `scroll-mt-24` chừa chỗ cho header dính — thiếu nó thì ô đầu bị header che.
export function ContactForm() {
  return (
    <section
      id="dang-ky"
      className={`scroll-mt-24 relative overflow-hidden ${tokens.vibrantBg.softWarm} ${tokens.spacing.section}`}
    >
      <GlowOrb color="orange" position="top-left" size="lg" />
      <div className="container-site max-w-2xl mx-auto relative z-10">
        <div className="text-center mb-10">
          <span className="badge-orange mb-3 inline-block">Đặt buổi học thử 1-1</span>
          <h2 className="heading-2 text-text-dark">
            Để lại thông tin,{' '}
            <span className="text-gradient-orange-purple">chúng tôi gọi lại</span>
          </h2>
          <p className="text-text-muted mt-3">
            Phản hồi trong vòng 30 phút trong giờ hành chính (8h – 21h hàng ngày)
          </p>
        </div>

        {/* Thẻ form bo lớn + đổ bóng ấm như form quatang; KHÔNG dùng `card-base` vì
            nó có hover đổi bóng — form đứng yên mà bóng nhấp nháy theo chuột thì kỳ. */}
        <div className="rounded-3xl bg-white p-5 shadow-xl shadow-orange-900/5 ring-1 ring-neutral-200/80 sm:p-8">
          {/* Suspense vì ContactFormInner dùng useSearchParams() */}
          <Suspense fallback={<div className="h-64 animate-pulse bg-gray-100 rounded-xl" />}>
            <ContactFormInner />
          </Suspense>
        </div>
      </div>
    </section>
  )
}
