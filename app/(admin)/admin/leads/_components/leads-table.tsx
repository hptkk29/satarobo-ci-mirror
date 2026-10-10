'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition, useState, useEffect } from 'react'
import {
  Loader2,
  Download,
  Trash2,
  ArrowDown,
  Columns3,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import {
  LEAD_COLUMNS,
  LEAD_COLUMNS_STORAGE_KEY,
  chuanHoaCot,
  cotMacDinh,
  doiChoCot,
  laNhapLai,
} from '@/lib/tables/lead-columns'
import { deleteLead } from '../actions'
import {
  LEAD_STATUS_LABEL as STATUS_LABELS,
  LEAD_STATUS_BADGE as STATUS_COLORS,
  KANBAN_COLUMNS,
} from '@/lib/leads/status'
import { formatPhoneVN } from '@/lib/phone'
import { formatDateTimeVNZoned } from '@/lib/format/date'
import { Badge } from '@/components/ui/badge'
import { ChonSoDong } from '@/components/ui/chon-so-dong'
import { DieuHuongTrang } from '@/components/ui/dieu-huong-trang'
import { LeadsRefreshButton } from './refresh-button'

export type LeadRow = {
  id: string
  parentName: string
  phone: string
  email: string | null
  childName: string | null
  childAge: number | null
  status: string
  source: string | null
  note: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  eventId: string | null
  landingPage: string | null
  referrer: string | null
  ipAddress: string | null
  userAgent: string | null
  consentMarketing: boolean
  createdAt: string
  /** Lần nhập gần nhất; null với lead cũ chưa có mốc. */
  lastInboundAt: string | null
  /** Số lần khách vào phễu (1 = chưa quay lại). Dùng cho nhãn "nhập lại N lần". */
  inboundCount: number
  center: { name: string } | null
  courseName: string | null
  assignedTo: { name: string | null } | null
  // SHARE T1 — lead bật "dùng chung" cho team (badge trên bảng).
  isSharedWithTeam: boolean
  assignedToId: string | null
}

/** SHARE T1 — chip "Dùng chung": outline = lead người khác chia sẻ cho mình;
 *  secondary = lead mình đang chia sẻ cho team. */
function SharedBadge({ lead, currentUserId }: { lead: LeadRow; currentUserId: string }) {
  if (!lead.isSharedWithTeam) return null
  if (lead.assignedToId === currentUserId) {
    return (
      <Badge variant="secondary" title="Bạn đang chia sẻ lead này">
        Dùng chung
      </Badge>
    )
  }
  return <Badge variant="outline">Dùng chung</Badge>
}

function shortSource(source: string | null): string {
  if (!source) return '—'
  const parts = source.split(' - ')
  return parts.slice(0, 2).join(' · ')
}

/**
 * Ngày KÈM GIỜ (30/08) — dùng cho cột "Ngày nhận lead".
 *
 * Ngày không thôi là chưa đủ: ngày cao điểm có hàng chục phiếu, mà thứ Sale cần biết
 * là ai vào TRƯỚC — gọi theo thứ tự đó mới đúng cam kết phản hồi.
 */
/**
 * Ô trạng thái trên BẢNG — chỉ là NHÃN, không sửa được (chốt 30/08/2026).
 *
 * Đổi bậc phễu là quyết định cần nhìn cả hồ sơ (đã gọi chưa, con mấy tuổi, ghi chú
 * gì); làm được ngay trên một dòng bảng thì dễ bấm nhầm, mà bấm nhầm ở đây là lead
 * rơi khỏi phễu. Ô sửa nay nằm ở TRANG CHI TIẾT, cạnh nút Sửa —
 * `_components/status-select.tsx`.
 */
function StatusCell({ lead }: { lead: LeadRow }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[lead.status as keyof typeof STATUS_COLORS] ?? 'bg-muted text-muted-foreground'}`}
    >
      {STATUS_LABELS[lead.status as keyof typeof STATUS_LABELS] ?? lead.status}
    </span>
  )
}

function DeleteCell({ lead, onDeleted }: { lead: LeadRow; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  // Reset confirm state sau 4 giây nếu user không click tiếp
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(t)
  }, [confirming])

  function handleClick() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    startTransition(async () => {
      const res = await deleteLead(lead.id)
      if (res.ok) {
        onDeleted()
      } else {
        alert(res.error ?? 'Lỗi xoá lead')
        setConfirming(false)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${ confirming ? 'bg-state-danger-ink text-white hover:bg-state-danger-ink' : 'text-state-danger-ink hover:bg-state-danger-soft' }`}
      aria-label={confirming ? `Xác nhận xoá ${lead.parentName}` : `Xoá ${lead.parentName}`}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
      {confirming ? 'Xác nhận?' : 'Xoá'}
    </button>
  )
}

function ThSap({
  nhan,
  khoa,
  dangSap,
}: {
  nhan: string
  khoa: 'moi_nhat' | 'nhap_lai'
  dangSap: 'moi_nhat' | 'nhap_lai'
}) {
  const searchParams = useSearchParams()
  const u = new URLSearchParams(searchParams.toString())
  u.set('sort', khoa)
  u.set('page', '1')
  const dang = dangSap === khoa
  return (
    <Link
      href={`/leads?${u.toString()}`}
      // Đổi sắp xếp = đổi tham số của CHÍNH trang này. Không có `scroll={false}` thì
      // Next cuộn lên đầu, người dùng đang soi dòng giữa bảng bị mất chỗ.
      scroll={false}
      className={`inline-flex items-center gap-1 hover:text-foreground ${dang ? 'text-foreground' : ''}`}
      title={dang ? 'Đang sắp theo cột này' : `Sắp theo ${nhan.toLowerCase()}`}
    >
      {nhan}
      {dang && <ArrowDown className="h-3 w-3" aria-hidden />}
    </Link>
  )
}

/**
 * Một Ô của bảng, chọn theo KHOÁ CỘT trong danh mục (`lib/tables/lead-columns.ts`).
 *
 * ⚠️ Mọi giá trị ở đây đã đi qua che PII Ở SERVER (`maskLeadPiiFields` trong page.tsx)
 * TRƯỚC khi xuống client. Đừng thêm ô nào đọc dữ liệu từ nguồn khác.
 */
function LeadCell({
  col,
  lead,
  currentUserId,
}: {
  col: string
  lead: LeadRow
  currentUserId: string
}) {
  switch (col) {
    case 'parentName':
      return (
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            {/* 30/08 — LINK THẬT, không phải chữ thường. Cột "Hành động" (nơi có nút
                "Xem chi tiết lead") đã gỡ, nên nếu ô này chỉ là <span> thì đường vào
                trang chi tiết chỉ còn `onClick` trên <tr>: người dùng bàn phím không
                tới được, và không ai mở được lead ở tab mới (chuột giữa / Ctrl+click)
                — thao tác mà sale làm suốt để so vài lead một lúc. */}
            <Link
              href={`/leads/${lead.id}`}
              onClick={e => e.stopPropagation()}
              className="font-medium text-foreground hover:text-primary hover:underline"
            >
              {lead.parentName}
            </Link>
            <SharedBadge lead={lead} currentUserId={currentUserId} />
          </div>
          {lead.childName && (
            <div className="text-xs text-muted-foreground">
              Con: {lead.childName}
              {lead.childAge ? ` · ${lead.childAge} tuổi` : ''}
            </div>
          )}
        </td>
      )
    case 'phone':
      // 30/08 — hiện `0987654321`, không phải `84987654321`: `84…` là quy ước LƯU
      // TRỮ, còn đây là số sale chép ra để gọi.
      return (
        <td
          // 30/08 — Ô NÀY KHÔNG ĐIỀU HƯỚNG (chủ dự án chốt). Cả dòng là vùng bấm để
          // mở lead, nên bôi đen số để chép sẽ tính là một cú bấm dòng và văng sang
          // trang khác giữa chừng — chép SĐT lại là việc sale làm nhiều nhất trên
          // bảng này. `stopPropagation` cắt sự kiện trước khi nó nổi lên <tr>;
          // `cursor-text` + `select-all` nói cho người dùng biết đây là chữ để lấy,
          // và một cú bấm là chọn trọn số, không phải kéo cho khéo.
          onClick={e => e.stopPropagation()}
          className="cursor-text select-all px-4 py-3 text-sm tabular-nums text-foreground"
        >
          {formatPhoneVN(lead.phone)}
        </td>
      )
    case 'course':
      return (
        <td className="px-4 py-3 max-w-[200px]">
          <span className="block truncate text-sm text-muted-foreground" title={lead.courseName ?? ''}>
            {lead.courseName ?? '—'}
          </span>
          {lead.source && (
            <span className="block truncate text-xs text-muted-foreground" title={lead.source}>
              {shortSource(lead.source)}
            </span>
          )}
        </td>
      )
    case 'status':
      return (
        <td className="px-4 py-3">
          <StatusCell lead={lead} />
        </td>
      )
    case 'center':
      return <td className="px-4 py-3 text-sm text-muted-foreground">{lead.center?.name ?? '—'}</td>
    case 'assignedTo':
      return (
        <td className="px-4 py-3 text-sm">
          {lead.assignedTo?.name ? (
            <span className="text-foreground">{lead.assignedTo.name}</span>
          ) : (
            <span className="font-medium text-state-warning-ink">Chưa phân công</span>
          )}
        </td>
      )
    case 'createdAt': {
      // ⚠️ 07/09/2026 — cột này in NGÀY NHẬN HIỆU LỰC, không phải `createdAt` trần.
      //
      // Khách gọi lại / điền form lần nữa thì hệ thống KHÔNG đẻ lead mới (trùng SĐT),
      // nó nâng `lastInboundAt` (`ghiNhanNhapLai`). In `createdAt` trần thì phiếu vừa
      // nóng lại trông y hệt phiếu nguội ba tháng và Sale không có cách nào biết để
      // gọi trước — đúng thứ chủ dự án báo.
      //
      // Ngày gốc KHÔNG mất: nằm ở `title` của ô này, ở cột tuỳ chọn "Lần nhập gần
      // nhất", và ở màn chi tiết (kèm số lần).
      //
      // ⚠️ Ô này và THỨ TỰ SẮP XẾP phải đi cùng nhau. In ngày mới mà vẫn sắp theo
      // `createdAt` là tệ hơn lúc đầu: phiếu hiện ngày hôm nay nhưng nằm ở vị trí
      // của ba tháng trước, và cột lại có mũi tên sắp xếp trên đầu.
      const nhapLai = laNhapLai(lead.createdAt, lead.lastInboundAt)
      return (
        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums">
          <span
            className={
              nhapLai ? 'font-semibold text-state-success-ink' : 'text-muted-foreground'
            }
            title={
              nhapLai
                ? `Nhận lần đầu: ${formatDateTimeVNZoned(lead.createdAt)}`
                : undefined
            }
          >
            {formatDateTimeVNZoned(nhapLai ? lead.lastInboundAt! : lead.createdAt)}
          </span>
          {nhapLai && (
            <span className="ml-1.5 text-xs font-medium text-state-success-ink">
              · nhập lại{lead.inboundCount > 1 ? ` ${lead.inboundCount} lần` : ''}
            </span>
          )}
        </td>
      )
    }
    case 'lastInboundAt':
      return (
        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums">
          {lead.lastInboundAt ? (
            <span
              className={
                // Nhập lại SAU ngày tạo = khách chủ động quay lại. Tín hiệu nóng nhất
                // trên bảng này, đừng để nó chìm.
                lead.lastInboundAt > lead.createdAt
                  ? 'font-semibold text-state-success-ink'
                  : 'text-muted-foreground'
              }
            >
              {formatDateTimeVNZoned(lead.lastInboundAt)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )
    case 'childName':
      return <td className="px-4 py-3 text-sm text-foreground">{lead.childName ?? '—'}</td>
    case 'childAge':
      return (
        <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
          {lead.childAge ?? '—'}
        </td>
      )
    case 'email':
      return (
        <td className="px-4 py-3 max-w-[200px]">
          <span className="block truncate text-sm text-muted-foreground" title={lead.email ?? ''}>
            {lead.email ?? '—'}
          </span>
        </td>
      )
    case 'source':
      return (
        <td className="px-4 py-3 max-w-[180px]">
          <span className="block truncate text-sm text-muted-foreground" title={lead.source ?? ''}>
            {lead.source ? shortSource(lead.source) : '—'}
          </span>
        </td>
      )
    case 'note':
      return (
        <td className="px-4 py-3 max-w-[240px]">
          <span className="block truncate text-sm text-muted-foreground" title={lead.note ?? ''}>
            {lead.note ?? '—'}
          </span>
        </td>
      )
    case 'utmCampaign':
      return (
        <td className="px-4 py-3 max-w-[180px]">
          <span className="block truncate text-sm text-muted-foreground" title={lead.utmCampaign ?? ''}>
            {lead.utmCampaign ?? '—'}
          </span>
        </td>
      )
    default:
      // Khoá lạ không bao giờ tới được đây (`chuanHoaCot` đã lọc), nhưng trả ô rỗng
      // vẫn tốt hơn làm lệch số ô so với số <th>.
      return <td className="px-4 py-3" />
  }
}

export function LeadsTable({
  leads,
  total,
  page,
  pageSize,
  sapXep,
  canDelete,
  canExport,
  currentStatus,
  currentQ,
  currentUserId,
}: {
  leads: LeadRow[]
  total: number
  page: number
  pageSize: number
  /** Cột đang được sắp xếp — để tô đậm đầu cột tương ứng. */
  sapXep: 'moi_nhat' | 'nhap_lai'
  canDelete: boolean
  /**
   * `leads:export` — chỉ Quản lý cơ sở + Quản trị tối cao (chốt 31/08/2026).
   * Thiếu thì KHÔNG vẽ nút. Đây chỉ là lớp giao diện: route
   * `/api/admin/leads/export` tự gác lại bằng cùng permission, vì URL đó gõ tay vào
   * trình duyệt là tải được file — giấu nút không phải là chặn.
   */
  canExport: boolean
  currentStatus?: string
  currentQ?: string
  currentUserId: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // CỘT HIỂN THỊ — mỗi người một bộ, lưu trong trình duyệt của chính họ.
  //
  // KHÔNG lưu ở DB/URL có chủ đích: đây là tiện nghi cá nhân, không phải dữ liệu cần
  // chia sẻ hay khôi phục. Khởi tạo bằng bộ MẶC ĐỊNH rồi mới đọc localStorage trong
  // `useEffect` — đọc thẳng lúc render là hydrate lệch (server không có localStorage).
  const [cot, setCot] = useState<string[]>(() => cotMacDinh())
  const [moChonCot, setMoChonCot] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LEAD_COLUMNS_STORAGE_KEY)
      if (raw) setCot(chuanHoaCot(JSON.parse(raw)))
    } catch {
      // Trình duyệt chặn site data / JSON hỏng → giữ bộ mặc định. Bảng phải chạy được
      // kể cả khi không đọc được gì.
    }
  }, [])

  /**
   * Ghi lựa chọn xuống trình duyệt. Không lưu được (chặn site data / hết dung lượng)
   * thì vẫn đổi trong phiên này — mất khi tải lại, chứ không làm hỏng thao tác.
   */
  function luuCot(moi: string[]): string[] {
    try {
      window.localStorage.setItem(LEAD_COLUMNS_STORAGE_KEY, JSON.stringify(moi))
    } catch {
      /* xem chú thích trên */
    }
    return moi
  }

  function doiCot(key: string, hien: boolean) {
    // Bật thêm thì cột mới vào CUỐI bảng — chèn giữa là xô lệch bố cục người dùng
    // vừa tự xếp; muốn nó lên trước thì có nút dời chỗ.
    setCot(prev => luuCot(chuanHoaCot(hien ? [...prev, key] : prev.filter(k => k !== key))))
  }

  function doiThuTu(key: string, huong: -1 | 1) {
    setCot(prev => luuCot(chuanHoaCot(doiChoCot(prev, key, huong))))
  }

  // Thứ tự CỦA NGƯỜI DÙNG (30/08), không phải thứ tự danh mục — `cot` đã qua
  // `chuanHoaCot` nên không còn khoá lạ; `filter` chỉ để TypeScript yên tâm.
  const cotHien = cot
    .map(k => LEAD_COLUMNS.find(c => c.key === k))
    .filter((c): c is (typeof LEAD_COLUMNS)[number] => !!c)
  const cotAn = LEAD_COLUMNS.filter(c => !cot.includes(c.key))
  const totalPages = Math.ceil(total / pageSize)
  // 30/08 — GỠ nút "Xem chi tiết lead" (chủ dự án chốt): bấm dòng đã vào thẳng trang
  // chi tiết, nút kia chỉ lặp lại cùng một việc và ăn một cột ngang.
  // Cột "Hành động" vì thế chỉ còn lý do tồn tại khi người dùng XOÁ được lead — role
  // không xoá được thì không thấy cột nào cả.
  const showActions = canDelete

  const navigate = (updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v === undefined || v === '') {
        params.delete(k)
      } else {
        params.set(k, v)
      }
    })
    params.delete('page')
    // `scroll: false` — đổi bộ lọc là ở LẠI trang này, chỉ khác tham số truy vấn.
    router.push(`/leads?${params.toString()}`, { scroll: false })
  }

  const goPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(p))
    // `scroll: false` — sang trang khác của cùng bảng thì giữ nguyên vị trí đang xem,
    // đừng để Next kéo về đầu tài liệu.
    router.push(`/leads?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="space-y-4">
      {/* Filters — tìm kiếm dùng chung ô "Tìm" ở thanh lọc phía trên (tránh 2 ô trùng nhau). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={currentStatus ?? ''}
          onChange={e => navigate({ status: e.target.value || undefined })}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary-purple focus:outline-none focus:ring-2 focus:ring-primary-purple/20"
        >
          <option value="">Tất cả trạng thái</option>
          {KANBAN_COLUMNS.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>

        {/* XUẤT EXCEL — 31/08. Đổi từ CSV: CSV mở bằng Excel hay vỡ tiếng Việt và nuốt
            số 0 đầu của SĐT. Chỉ hiện với người có `leads:export` (QLCS + Quản trị tối cao). */}
        {canExport && (
          <a
            href={`/api/admin/leads/export${currentStatus ? `?status=${currentStatus}` : ''}${currentQ ? `${currentStatus ? '&' : '?'}q=${encodeURIComponent(currentQ)}` : ''}`}
            download
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Xuất Excel"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Xuất Excel</span>
          </a>
        )}
        {/* LÀM MỚI — 31/08. Cùng nhóm "điều khiển bảng" với Xuất Excel / Cột hiển thị.
            `ml-auto` ở đây để cụm vẫn dạt phải khi người dùng KHÔNG có nút Xuất. */}
        <LeadsRefreshButton className={`${canExport ? '' : 'ml-auto '}inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50`} />
        {/* CHỌN CỘT — 30/08. Đặt cạnh nút xuất vì cùng nhóm "điều khiển bảng". */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMoChonCot(v => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Columns3 className="h-4 w-4" /> Cột hiển thị
          </button>
          {moChonCot && (
            <>
              {/* Nền bắt click-ra-ngoài. Không dùng thư viện popover cho một hộp
                  chọn ở màn quản trị. */}
              <button
                type="button"
                aria-label="Đóng"
                onClick={() => setMoChonCot(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute right-0 z-50 mt-1 w-64 rounded-xl border border-border bg-card p-2 shadow-lg">
                {/* Cột ĐANG HIỆN — theo đúng thứ tự trên bảng, kèm nút dời chỗ. */}
                {cotHien.map((c, i) => (
                  <div
                    key={c.key}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked
                      disabled={c.batBuoc}
                      onChange={() => doiCot(c.key, false)}
                      aria-label={`Ẩn cột ${c.label}`}
                    />
                    <span className="flex-1 truncate text-foreground" title={c.label}>
                      {c.label}
                    </span>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => doiThuTu(c.key, -1)}
                      aria-label={`Đưa cột ${c.label} lên trước`}
                      className="rounded p-0.5 text-muted-foreground hover:bg-card disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={i === cotHien.length - 1}
                      onClick={() => doiThuTu(c.key, 1)}
                      aria-label={`Đưa cột ${c.label} xuống sau`}
                      className="rounded p-0.5 text-muted-foreground hover:bg-card disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {/* Cột đang ẨN — không có nút dời chỗ vì chúng chưa ở trên bảng.
                    Bật lên thì cột vào cuối, rồi dời bằng nút mũi tên ở nhóm trên. */}
                {cotAn.length > 0 && (
                  <p className="mt-2 px-2 text-xs font-semibold uppercase text-muted-foreground">
                    Đang ẩn
                  </p>
                )}
                {cotAn.map(c => (
                  <label
                    key={c.key}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => doiCot(c.key, true)}
                      aria-label={`Hiện cột ${c.label}`}
                    />
                    <span className="text-muted-foreground">{c.label}</span>
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => setCot(luuCot(cotMacDinh()))}
                  className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  Về mặc định
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                {cotHien.map(c => (
                  <th
                    key={c.key}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {/* Hai cột mốc thời gian bấm được để đổi thứ tự; còn lại là nhãn thường. */}
                    {c.key === 'createdAt' ? (
                      <ThSap nhan={c.label} khoa="moi_nhat" dangSap={sapXep} />
                    ) : c.key === 'lastInboundAt' ? (
                      <ThSap nhan={c.label} khoa="nhap_lai" dangSap={sapXep} />
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
                {showActions && (
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Hành động
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.length === 0 ? (
                <tr>
                  <td
                    colSpan={cotHien.length + (showActions ? 1 : 0)}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có lead nào
                  </td>
                </tr>
              ) : (
                leads.map(lead => (
                  <tr
                    key={lead.id}
                    // 30/08 — bấm dòng vào THẲNG trang chi tiết (chủ dự án chốt).
                    // Ngăn kéo cũ chỉ chép lại một phần hồ sơ, nên ai cũng phải mở
                    // tiếp trang chi tiết để làm việc thật — thêm một bước cho mọi lượt.
                    onClick={() => router.push(`/leads/${lead.id}`)}
                    className="cursor-pointer hover:bg-muted/60"
                  >
                    {cotHien.map(c => (
                      <LeadCell
                        key={c.key}
                        col={c.key}
                        lead={lead}
                        currentUserId={currentUserId}
                      />
                    ))}
                    {showActions && (
                      <td
                        className="px-4 py-3 text-right"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <DeleteCell lead={lead} onDeleted={() => router.refresh()} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <ChonSoDong soDong={pageSize} tong={total} tenDonVi="lead" />
            <span>
              Trang {page}/{totalPages}
            </span>
          </div>
          <DieuHuongTrang trang={page} soTrang={totalPages} onDoi={goPage} />
        </div>
      )}

    </div>
  )
}
