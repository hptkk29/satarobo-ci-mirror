'use client'

// Bảng chốt hàng loạt: mỗi dòng = 1 học viên (LeadChild), gộp nhóm theo lead.
// Chọn lớp per học viên (lọc đúng khoá quan tâm + cơ sở lead), nhập "đã đóng"
// per lead (tuỳ chọn), rồi chốt theo lô 20 lead/lượt với progress + kết quả dòng.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { bulkConvertLeadsAction } from '../_actions'
import { MoneyInput } from "@/components/ui/money-input";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { formatPhoneVN } from "@/lib/phone";

type ChildInfo = {
  id: string
  fullName: string
  dob: string
  gradeLevel: string | null
  interestedCourseId: string | null
  note: string | null
}

type LeadInfo = {
  id: string
  parentName: string
  phone: string
  email: string | null
  centerId: string | null
  note: string | null
  createdAt: string
  children: ChildInfo[]
}

type ClassOption = {
  id: string
  label: string
  courseId: string
  courseName: string
  centerId: string | null
  listPrice: number
}

type CenterInfo = { id: string; name: string; code: string | null }

type RowResult = { ok: boolean; message?: string; warning?: string }

const inputCls =
  'w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'

const fmtVnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + 'đ'

export function BulkConvertClient({
  leads,
  classes,
  centers,
  hasPaymentLeadIds,
}: {
  leads: LeadInfo[]
  classes: ClassOption[]
  centers: CenterInfo[]
  hasPaymentLeadIds: string[]
}) {
  const hasPayment = useMemo(() => new Set(hasPaymentLeadIds), [hasPaymentLeadIds])
  const centerName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of centers) m.set(c.id, c.code || c.name)
    return m
  }, [centers])
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes])

  // State per lead + per child.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [childClass, setChildClass] = useState<Record<string, string>>({})
  const [childConsent, setChildConsent] = useState<Record<string, boolean>>({})
  const [paidAmount, setPaidAmount] = useState<Record<string, string>>({})
  const [paidDate, setPaidDate] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, RowResult>>({})
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // Bộ lọc hiển thị.
  const [filterCenter, setFilterCenter] = useState('')
  const [search, setSearch] = useState('')
  const [hideDone, setHideDone] = useState(true)

  // Helper gán lớp hàng loạt.
  const [bulkClassId, setBulkClassId] = useState('')

  // Ngày "hôm nay" theo GIỜ VIỆT NAM (dịch UTC+7 rồi mới cắt chuỗi): toISOString
  // trần là ngày UTC — khung 00:00–06:59 giờ VN nó lùi 1 ngày, default paidDate
  // sai và max chặn không cho chọn đúng hôm nay (review 02/08).
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)

  const visibleLeads = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter((l) => {
      if (results[l.id]?.ok && hideDone) return false
      if (filterCenter && l.centerId !== filterCenter) return false
      if (!q) return true
      return (
        l.parentName.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.children.some((c) => c.fullName.toLowerCase().includes(q))
      )
    })
  }, [leads, filterCenter, search, results, hideDone])

  const classesFor = (lead: LeadInfo, child: ChildInfo) =>
    classes.filter(
      (c) =>
        c.centerId === lead.centerId &&
        (!child.interestedCourseId || c.courseId === child.interestedCourseId),
    )

  const leadTotal = (lead: LeadInfo) =>
    lead.children.reduce((s, ch) => {
      const cls = childClass[ch.id] ? classById.get(childClass[ch.id]!) : null
      return s + (cls?.listPrice ?? 0)
    }, 0)

  const toggleLead = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const selectAllVisible = (on: boolean) =>
    setSelected(() => {
      if (!on) return new Set()
      return new Set(visibleLeads.filter((l) => l.children.length > 0 && !results[l.id]?.ok).map((l) => l.id))
    })

  const applyBulkClass = () => {
    const cls = bulkClassId ? classById.get(bulkClassId) : null
    if (!cls) return
    // Tính map mới NGOÀI setState (đếm trong updater chạy lúc render → toast báo
    // sai số / StrictMode đếm đôi — review 02/08).
    const next = { ...childClass }
    let applied = 0
    for (const lead of visibleLeads) {
      if (lead.centerId !== cls.centerId) continue
      for (const ch of lead.children) {
        if (next[ch.id]) continue // không ghi đè lựa chọn đã có
        if (ch.interestedCourseId && ch.interestedCourseId !== cls.courseId) continue
        next[ch.id] = cls.id
        applied++
      }
    }
    setChildClass(next)
    toast.success(`Đã gán lớp cho ${applied} học viên (chưa gán, cùng khoá & cơ sở)`)
  }

  const consentAllVisible = (on: boolean) =>
    setChildConsent((prev) => {
      const next = { ...prev }
      for (const lead of visibleLeads) for (const ch of lead.children) next[ch.id] = on
      return next
    })

  /**
   * 04/08 — điền ô "đã đóng" theo SỐ TIỀN TRONG FILE EXCEL đã import, thay vì lấy
   * giá niêm yết. Số này được importer ghi vào note của con dưới nhãn `ĐãĐóng=`
   * (lib/lead/import-registered.ts). Luật chủ dự án chốt: dòng KHÔNG có ghi chú 50%
   * thì số trong file CHÍNH LÀ đã đóng đủ ⇒ công nợ 0.
   *
   * Lead nhiều con → CỘNG số của các con (ô "đã đóng" là của cả lead).
   * Con nào không đọc được số thì bỏ qua con đó, không đoán.
   */
  const fillPaidFromImport = () => {
    setPaidAmount((prev) => {
      const next = { ...prev }
      for (const lead of visibleLeads) {
        if (!selected.has(lead.id) || hasPayment.has(lead.id)) continue
        let sum = 0
        for (const ch of lead.children) {
          const m = /ĐãĐóng=(\d+)/.exec(ch.note ?? '')
          if (m) sum += Number(m[1])
        }
        if (sum > 0) next[lead.id] = String(sum)
      }
      return next
    })
  }

  const fillPaidListPrice = () => {
    setPaidAmount((prev) => {
      const next = { ...prev }
      for (const lead of visibleLeads) {
        if (!selected.has(lead.id) || hasPayment.has(lead.id)) continue
        const total = leadTotal(lead)
        if (total > 0) next[lead.id] = String(total)
      }
      return next
    })
  }

  const readyLeads = useMemo(
    () =>
      visibleLeads.filter(
        (l) =>
          selected.has(l.id) &&
          !results[l.id]?.ok &&
          l.children.length > 0 &&
          l.children.every((ch) => Boolean(childClass[ch.id])),
      ),
    [visibleLeads, selected, results, childClass],
  )

  /** Đọc khoản giảm từ ghi chú con (nhãn do import ghi: `Giảm=500000đ` / `Giảm=10%`). */
  const readDiscount = (note: string | null): { type: 'AMOUNT' | 'PERCENT'; value: number } | null => {
    const m = /Giảm=(\d+)(%|đ)/.exec(note ?? '')
    if (!m) return null
    const value = Number(m[1])
    if (!Number.isFinite(value) || value <= 0) return null
    return { type: m[2] === '%' ? 'PERCENT' : 'AMOUNT', value }
  }

  /** Giải trình giảm giá — lấy của con đầu tiên có ghi (đơn gộp nhiều con dùng chung đơn). */
  const readDiscountReason = (children: { note: string | null }[]): string | null => {
    for (const ch of children) {
      const m = /LýDoGiảm=([^·]+)/.exec(ch.note ?? '')
      if (m) return m[1].trim()
    }
    return null
  }

  /** Hạn đợt 2 do màn xem thử import ghi vào note (`HạnĐợt2=2026-09-15`). */
  const readDue2 = (children: { note: string | null }[]): string | null => {
    for (const ch of children) {
      const m = /HạnĐợt2=(\d{4}-\d{2}-\d{2})/.exec(ch.note ?? '')
      if (m) return m[1]
    }
    return null
  }

  const submit = async () => {
    if (readyLeads.length === 0) {
      toast.error('Chưa có lead nào đủ điều kiện (cần chọn lớp cho mọi học viên của lead đã tick)')
      return
    }
    setRunning(true)
    setProgress({ done: 0, total: readyLeads.length })
    // Đếm bằng biến cục bộ + build map kết quả NGOÀI setState updater (updater
    // chạy lúc render nên đếm trong đó ra số sai / StrictMode đếm đôi — review 02/08).
    let okCount = 0
    let failCount = 0
    let aborted = false
    try {
      const CHUNK = 20
      for (let i = 0; i < readyLeads.length; i += CHUNK) {
        const chunk = readyLeads.slice(i, i + CHUNK)
        const payload = {
          items: chunk.map((lead) => ({
            leadId: lead.id,
            students: lead.children.map((ch) => ({
              leadChildId: ch.id,
              name: ch.fullName,
              dob: ch.dob || '',
              classId: childClass[ch.id]!,
              consentMedia: childConsent[ch.id] === true,
              // 04/08 — khuyến mãi người nhập đã gõ ở màn XEM THỬ IMPORT, lưu trong
              // ghi chú của con dưới nhãn `Giảm=`. Đọc lại ở đây để đơn tạo ra đã
              // đúng tiền ngay từ đầu, khỏi phải mở từng đơn sửa sau.
              discount: readDiscount(ch.note),
            })),
            discountReason: readDiscountReason(lead.children),
            dueDate2: readDue2(lead.children),
            paid:
              !hasPayment.has(lead.id) && Number(paidAmount[lead.id] ?? '') > 0
                ? {
                    amount: Math.round(Number(paidAmount[lead.id])),
                    paidDate: paidDate[lead.id] || today,
                    note: '',
                  }
                : null,
          })),
        }
        const chunkResults: Record<string, RowResult> = {}
        try {
          const res = await bulkConvertLeadsAction(payload)
          if (!res.ok) {
            for (const lead of chunk) {
              chunkResults[lead.id] = { ok: false, message: res.error }
              failCount++
            }
          } else {
            for (const r of res.results) {
              chunkResults[r.leadId] = { ok: r.ok, message: r.message, warning: r.warning }
              if (r.ok) okCount++
              else failCount++
            }
          }
        } catch {
          // Mất kết nối / action ném — đánh dấu chunk này lỗi rồi DỪNG (không âm
          // thầm bỏ dở giữa chừng; các chunk trước đã chốt vẫn giữ nguyên kết quả).
          for (const lead of chunk) {
            chunkResults[lead.id] = { ok: false, message: 'Mất kết nối hoặc lỗi hệ thống — bấm chốt lại (an toàn, không tạo trùng)' }
            failCount++
          }
          aborted = true
        }
        setResults((prev) => ({ ...prev, ...chunkResults }))
        setProgress({ done: Math.min(i + CHUNK, readyLeads.length), total: readyLeads.length })
        if (aborted) break
      }
      if (aborted) toast.error(`Bị gián đoạn: ${okCount} đã chốt · ${failCount} chưa xong — kiểm tra mạng rồi bấm chốt lại`)
      else if (failCount === 0) toast.success(`Đã chốt ${okCount} lead`)
      else toast.warning(`Xong: ${okCount} thành công · ${failCount} lỗi — xem cột kết quả`)
    } finally {
      setRunning(false)
    }
  }

  const doneCount = Object.values(results).filter((r) => r.ok).length

  return (
    <div className="space-y-4">
      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted p-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Cơ sở</label>
          <select value={filterCenter} onChange={(e) => setFilterCenter(e.target.value)} className={inputCls}>
            <option value="">Tất cả</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code || c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Tìm (tên PH / SĐT / tên HV)</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} className={inputCls} placeholder="Gõ để lọc…" />
        </div>
        <div className="min-w-[260px]">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Gán lớp nhanh (HV chưa gán, cùng khoá &amp; cơ sở)
            <HelpHint>
              Gán lớp đang chọn cho mọi học viên ĐANG HIỂN THỊ mà chưa có lớp, đúng cơ sở
              và đúng khoá bé quan tâm. Lớp đã chọn tay trước đó không bị ghi đè.
            </HelpHint>
          </label>
          <div className="flex gap-2">
            <select value={bulkClassId} onChange={(e) => setBulkClassId(e.target.value)} className={inputCls}>
              <option value="">— Chọn lớp —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  [{(c.centerId && centerName.get(c.centerId)) || '?'}] {c.label} · {c.courseName}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={applyBulkClass}
              disabled={!bulkClassId || running}
              className="shrink-0 rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              Áp dụng
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => selectAllVisible(true)} disabled={running} className="rounded-md border border-border px-2.5 py-1 hover:bg-muted">
          Tick tất cả đang hiển thị
        </button>
        <button type="button" onClick={() => selectAllVisible(false)} disabled={running} className="rounded-md border border-border px-2.5 py-1 hover:bg-muted">
          Bỏ tick
        </button>
        <button type="button" onClick={() => consentAllVisible(true)} disabled={running} className="rounded-md border border-border px-2.5 py-1 hover:bg-muted">
          Đồng ý ảnh: tick tất cả
        </button>
        {/* Hai nút điền hàng loạt: hệ quả (ghi đè / bỏ qua lead nào) không nhìn ra được
            từ chữ trên nút ⇒ để trong "?" ngay cạnh, khỏi phải bấm thử mới biết. */}
        <span className="inline-flex items-center gap-1">
          <button type="button" onClick={fillPaidFromImport} disabled={running} className="rounded-md border border-state-success bg-state-success-soft px-2.5 py-1 font-medium text-state-success-ink hover:bg-state-success-soft-hover">
            Điền &quot;đã đóng&quot; theo file Excel (lead đã tick)
          </button>
          <HelpHint>
            Lấy số tiền mà file Excel import đã ghi cho từng bé, cộng lại theo từng phụ
            huynh. Chỉ điền cho lead đang tick và chưa có khoản ghi nhận; bé nào file
            không có số thì bỏ qua, không đoán.
          </HelpHint>
        </span>
        <span className="inline-flex items-center gap-1">
          <button type="button" onClick={fillPaidListPrice} disabled={running} className="rounded-md border border-border px-2.5 py-1 hover:bg-muted">
            Điền &quot;đã đóng&quot; = học phí niêm yết (lead đã tick)
          </button>
          <HelpHint>
            Dùng khi phụ huynh đóng đủ: điền bằng tổng học phí niêm yết của các lớp đã
            chọn. Áp cho mọi lead đang tick và GHI ĐÈ số đang có trong ô.
          </HelpHint>
        </span>
        <label className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="h-4 w-4 rounded border-border" />
          Ẩn lead đã chốt xong
        </label>
      </div>

      {/* Bảng */}
      <div className="overflow-hidden rounded-lg border border-border">
        <PhanTrangBang cuonNgang>
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2"></th>
                <th className="px-3 py-2">Phụ huynh</th>
                <th className="px-3 py-2">Học viên</th>
                <th className="w-64 px-3 py-2">
                  Lớp
                  <HelpHint>
                    Chỉ hiện lớp đang mở cùng cơ sở với lead và đúng khoá bé quan tâm.
                    Bé nào chưa chọn lớp thì cả lead đó không chốt được.
                  </HelpHint>
                </th>
                <th className="w-24 px-3 py-2">
                  Ảnh: đồng ý
                  <HelpHint>
                    Tick khi phụ huynh đã đồng ý cho trung tâm dùng hình ảnh/video của bé
                    (NĐ 13/2023). Người tick và thời điểm được ghi nhật ký, nên chỉ tick
                    khi phụ huynh đã đồng ý thật.
                  </HelpHint>
                </th>
                <th className="w-56 px-3 py-2">
                  Đã đóng (đ) · ngày
                  <HelpHint>
                    Số tiền phụ huynh ĐÃ đóng và ngày tiền thực về — chốt xong hệ thống
                    tạo luôn khoản thu theo đúng hai ô này. Bỏ TRỐNG số tiền nghĩa là
                    chưa rõ và sẽ không tạo khoản thu nào (khác với gõ số 0). Lead đã có
                    khoản ghi nhận trước đó thì ô này khoá lại.
                  </HelpHint>
                </th>
                <th className="w-64 px-3 py-2">Kết quả</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleLeads.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    {leads.length === 0
                      ? 'Chưa có lead "Đã đăng ký" nào — import file Excel ở màn Import khách đã đăng ký trước.'
                      : 'Không có lead khớp bộ lọc.'}
                  </td>
                </tr>
              )}
              {visibleLeads.map((lead) => {
                const res = results[lead.id]
                const rowSpan = Math.max(1, lead.children.length)
                const noChildren = lead.children.length === 0
                const disabled = running || Boolean(res?.ok) || noChildren
                return lead.children.length === 0 ? (
                  <tr key={lead.id} className="bg-state-warning-soft/40">
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2">
                      <LeadCell lead={lead} centerLabel={(lead.centerId && centerName.get(lead.centerId)) || '—'} />
                    </td>
                    <td colSpan={5} className="px-3 py-2 text-xs text-state-warning-ink">
                      Lead không có học viên đính kèm — chốt riêng tại{' '}
                      <Link href={`/leads/${lead.id}/convert`} className="underline">
                        màn chuyển đổi
                      </Link>
                      .
                    </td>
                  </tr>
                ) : (
                  lead.children.map((ch, idx) => {
                    const options = classesFor(lead, ch)
                    return (
                      <tr key={ch.id} className={res?.ok ? 'bg-state-success-soft/50' : res ? 'bg-state-danger-soft/40' : undefined}>
                        {idx === 0 && (
                          <td className="px-3 py-2 align-top" rowSpan={rowSpan}>
                            <input
                              type="checkbox"
                              checked={selected.has(lead.id)}
                              onChange={(e) => toggleLead(lead.id, e.target.checked)}
                              disabled={disabled}
                              className="mt-1 h-4 w-4 rounded border-border"
                            />
                          </td>
                        )}
                        {idx === 0 && (
                          <td className="px-3 py-2 align-top" rowSpan={rowSpan}>
                            <LeadCell lead={lead} centerLabel={(lead.centerId && centerName.get(lead.centerId)) || '—'} />
                          </td>
                        )}
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-foreground">{ch.fullName}</div>
                          <div className="text-xs text-muted-foreground">
                            {[ch.gradeLevel, ch.dob].filter(Boolean).join(' · ')}
                          </div>
                          {ch.note && (
                            <div className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground" title={ch.note}>
                              {ch.note}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <select
                            value={childClass[ch.id] ?? ''}
                            onChange={(e) => setChildClass((prev) => ({ ...prev, [ch.id]: e.target.value }))}
                            disabled={disabled}
                            className={inputCls}
                          >
                            <option value="">— Chọn lớp —</option>
                            {options.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label} · {c.courseName} · {fmtVnd(c.listPrice)}
                              </option>
                            ))}
                          </select>
                          {options.length === 0 && (
                            <div className="mt-0.5 text-xs text-state-danger-ink">
                              Chưa có lớp mở cùng khoá tại cơ sở này — tạo lớp trước.
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center align-top">
                          <input
                            type="checkbox"
                            checked={childConsent[ch.id] === true}
                            onChange={(e) => setChildConsent((prev) => ({ ...prev, [ch.id]: e.target.checked }))}
                            disabled={disabled}
                            className="mt-1 h-4 w-4 rounded border-border"
                          />
                        </td>
                        {idx === 0 && (
                          <td className="px-3 py-2 align-top" rowSpan={rowSpan}>
                            {hasPayment.has(lead.id) ? (
                              <span className="inline-flex rounded-full bg-state-info-soft px-2 py-0.5 text-xs font-medium text-state-info-ink">
                                Đã có khoản ghi nhận
                              </span>
                            ) : (
                              <div className="space-y-1">
                                {/* Ô tiền: gõ 10000000 → hiện 10.000.000. Giữ state dạng
                                    chuỗi vì các nút "Điền đã đóng…" cũng ghi chuỗi vào đây,
                                    và ô TRỐNG (≠ 0) nghĩa là "chưa rõ" — không tạo khoản thu. */}
                                <MoneyInput
                                  name={`paidAmount-${lead.id}`}
                                  min={0}
                                  value={paidAmount[lead.id] ?? ''}
                                  onValueChange={(v) =>
                                    setPaidAmount((prev) => ({ ...prev, [lead.id]: v === null ? '' : String(v) }))
                                  }
                                  disabled={disabled}
                                  placeholder="Bỏ trống nếu chưa rõ"
                                  // suffix={null}: cột đã ghi "Đã đóng (đ)", và `inputCls`
                                  // mang px-2 nên hậu tố sẽ đè lên chữ số trong ô hẹp này.
                                  suffix={null}
                                  className={inputCls}
                                />
                                <input
                                  type="date"
                                  value={paidDate[lead.id] ?? today}
                                  max={today}
                                  onChange={(e) => setPaidDate((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                                  disabled={disabled}
                                  className={inputCls}
                                />
                                {Number(paidAmount[lead.id] ?? '') > 0 && leadTotal(lead) > 0 && (
                                  <div className="text-xs text-muted-foreground">
                                    Niêm yết: {fmtVnd(leadTotal(lead))}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        )}
                        {idx === 0 && (
                          <td className="px-3 py-2 align-top text-xs" rowSpan={rowSpan}>
                            {res?.ok && (
                              <div className="text-state-success-ink">
                                ✓ Đã chốt{res.warning ? ` — ${res.warning}` : ''}
                              </div>
                            )}
                            {res && !res.ok && <div className="text-state-danger-ink">✗ {res.message}</div>}
                            {!res && lead.note && (
                              <div className="max-w-[240px] truncate text-muted-foreground" title={lead.note}>
                                {lead.note}
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })
                )
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>

      {/* Thanh hành động */}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="text-sm text-muted-foreground">
          Đã tick: <span className="font-semibold">{selected.size}</span> · Đủ điều kiện:{' '}
          <span className="font-semibold">{readyLeads.length}</span>
          {doneCount > 0 && (
            <>
              {' '}
              · Đã chốt: <span className="font-semibold text-state-success-ink">{doneCount}</span>
            </>
          )}
        </div>
        {progress && running && (
          <div className="text-sm text-muted-foreground">
            Đang chốt… {progress.done}/{progress.total}
          </div>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={running || readyLeads.length === 0}
          className="ml-auto rounded-md bg-primary-dark px-4 py-2 text-sm font-semibold text-white hover:bg-primary-darker disabled:opacity-50"
        >
          {running ? 'Đang chốt…' : `Chốt ${readyLeads.length} lead`}
        </button>
        <HelpHint className="[&_svg]:size-4" label="Chốt hàng loạt nghĩa là gì" side="top">
          Chỉ chốt những lead đã tick VÀ đã chọn lớp cho mọi bé của lead đó. Mỗi lead
          được tạo học viên, ghi danh, đơn học phí và tài khoản phụ huynh chờ kích hoạt.
          Chạy theo lô 20 lead; nếu đứt giữa chừng, bấm chốt lại là an toàn — lead đã
          chốt không bị tạo trùng.
        </HelpHint>
      </div>

      <p className="text-xs text-muted-foreground">
        Sau khi chốt: tài khoản phụ huynh ở trạng thái <b>chờ kích hoạt</b> — phụ huynh vào{' '}
        <span className="font-mono">satarobo.vn/kich-hoat</span>, nhập SĐT để nhận mã OTP
        qua Zalo và tự đặt mật khẩu. Quản lý danh sách chờ kích hoạt tại màn{' '}
        <Link href="/students/tai-khoan" className="underline">
          Tài khoản phụ huynh
        </Link>
        .
      </p>
    </div>
  )
}

function LeadCell({ lead, centerLabel }: { lead: LeadInfo; centerLabel: string }) {
  return (
    <div>
      <Link href={`/leads/${lead.id}`} className="font-medium text-foreground hover:underline">
        {lead.parentName}
      </Link>
      <div className="text-xs text-muted-foreground">
        {formatPhoneVN(lead.phone)} · {centerLabel}
      </div>
      <div className="text-xs text-muted-foreground">Đăng ký: {lead.createdAt}</div>
    </div>
  )
}
