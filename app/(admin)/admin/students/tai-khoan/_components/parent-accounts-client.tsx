'use client'

// Bảng TK phụ huynh: hành động per-dòng (gửi lại OTP / gửi ZNS báo cấp TK) +
// hàng loạt (ZNS cho tất cả chưa nhận) + xuất CSV gọi điện thủ công.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { resendActivationOtpByUser, sendAccountZns, sendAccountZnsBulk } from '../_actions'
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

type ZnsInfo = { status: string; simulated: boolean; error: string | null; at: string } | null

type ParentRow = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  center: string
  status: string
  createdAt: string
  students: { id: string; name: string; code: string | null }[]
  zns: ZnsInfo
}

export function ParentAccountsClient({
  parents,
  znsConfigured,
  xuatDuoc,
}: {
  parents: ParentRow[]
  znsConfigured: boolean
  /**
   * Cờ "được TẢI VỀ" — phân quyền ở Cấu hình vận hành → Quyền xuất dữ liệu.
   * Khác quyền XEM: người xem được trang vẫn thấy số trên màn, chỉ không lấy được tệp.
   */
  xuatDuoc: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return parents
    return parents.filter(
      (p) =>
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.phone ?? '').includes(q) ||
        p.students.some((s) => s.name.toLowerCase().includes(q)),
    )
  }, [parents, search])

  const resendOtp = (id: string) => {
    setBusyId(id)
    startTransition(async () => {
      const res = await resendActivationOtpByUser(id)
      if (res.ok && res.warning) toast.warning(res.warning, { duration: 9000 })
      else if (res.ok) toast.success('Đã gửi mã kích hoạt mới')
      else toast.error(res.error ?? 'Không gửi được')
      setBusyId(null)
    })
  }

  const sendZns = (id: string) => {
    setBusyId(id)
    startTransition(async () => {
      const res = await sendAccountZns(id)
      if (res.ok) {
        toast.success(
          res.simulated
            ? 'ZNS ghi nhận ở chế độ MÔ PHỎNG (ZALO_LIVE chưa bật) — tin KHÔNG thực sự rời hệ thống'
            : 'Đã gửi ZNS báo cấp tài khoản',
        )
      } else toast.error(res.error ?? 'Gửi ZNS thất bại')
      setBusyId(null)
    })
  }

  const sendBulk = () => {
    startTransition(async () => {
      const res = await sendAccountZnsBulk()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      // "còn lại" (vượt cap 100/lượt) tách khỏi "đã nhận trước đó" — gộp chung
      // làm người vận hành tưởng đã phủ hết, không bấm gửi tiếp.
      toast[res.failed > 0 || res.remaining > 0 ? 'warning' : 'success'](
        `ZNS hàng loạt: ${res.sent} gửi · ${res.failed} lỗi · ${res.skipped} đã nhận trước đó${
          res.remaining > 0 ? ` · CÒN ${res.remaining} CHƯA GỬI — bấm lại để gửi tiếp` : ''
        }${res.simulated ? ' — CHẾ ĐỘ MÔ PHỎNG (ZALO_LIVE chưa bật)' : ''}`,
        { duration: 12000 },
      )
    })
  }

  const exportCsv = () => {
    const header = 'Ten phu huynh,SDT,Email,Co so,Trang thai,Ngay tao,Hoc vien'
    const lines = rows.map((p) =>
      [
        csv(p.name ?? ''),
        csv(p.phone ?? ''),
        csv(p.email ?? ''),
        csv(p.center),
        p.status === 'PENDING_ACTIVATION' ? 'Cho kich hoat' : p.status,
        p.createdAt,
        csv(p.students.map((s) => `${s.name}${s.code ? ` (${s.code})` : ''}`).join(' | ')),
      ].join(','),
    )
    const blob = new Blob(['﻿' + [header, ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tai-khoan-phu-huynh-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên PH / SĐT / tên học viên…"
          className="w-72 rounded-md border border-border px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-sm text-muted-foreground">{rows.length} tài khoản</span>
        <div className="ml-auto flex gap-2">
          {xuatDuoc && (
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Xuất CSV
            </button>
          )}
          <button
            type="button"
            onClick={sendBulk}
            disabled={!znsConfigured || pending}
            title={
              znsConfigured
                ? 'Gửi ZNS báo cấp TK cho mọi tài khoản chờ kích hoạt CHƯA từng nhận (tối đa 100/lượt)'
                : 'Chưa cấu hình mẫu ZNS (chờ 616899 duyệt)'
            }
            className="rounded-lg bg-primary-dark px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-darker disabled:opacity-50"
          >
            Gửi ZNS tất cả chưa nhận
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <PhanTrangBang cuonNgang>
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Phụ huynh</th>
                <th className="px-3 py-2">Học viên</th>
                <th className="w-20 px-3 py-2">Cơ sở</th>
                <th className="w-28 px-3 py-2">Trạng thái</th>
                <th className="w-44 px-3 py-2">ZNS báo cấp TK</th>
                <th className="w-64 px-3 py-2">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Không có tài khoản nào.
                  </td>
                </tr>
              )}
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-foreground">{p.name ?? '(chưa có tên)'}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.phone ?? 'không SĐT'}
                      {p.email ? ` · ${p.email}` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">Tạo: {p.createdAt}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {p.students.length === 0 ? (
                      <span className="inline-flex rounded-full bg-state-warning-soft px-2 py-0.5 text-xs font-medium text-state-warning-ink">
                        Chưa gắn học viên
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {p.students.map((s) => (
                          <Link
                            key={s.id}
                            href={`/students/${s.id}/edit`}
                            className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-muted"
                          >
                            {s.name}
                            {s.code ? ` · ${s.code}` : ''}
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-muted-foreground">{p.center}</td>
                  <td className="px-3 py-2 align-top">
                    {p.status === 'PENDING_ACTIVATION' ? (
                      <span className="inline-flex rounded-full bg-state-warning-soft px-2 py-0.5 text-xs font-medium text-state-warning-ink">
                        Chờ kích hoạt
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-state-success-soft px-2 py-0.5 text-xs font-medium text-state-success-ink">
                        Đã kích hoạt
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    <ZnsBadge zns={p.zns} configured={znsConfigured} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    {p.status === 'PENDING_ACTIVATION' && (
                      <div className="flex flex-wrap gap-1.5">
                        {/* Khoá TẤT CẢ nút khi đang có transition (không chỉ dòng busy):
                            busyId reset sớm hơn transition → double-click/bấm dòng khác
                            khi đang gửi sẽ bắn trùng OTP/ZNS cho phụ huynh (review 02/08). */}
                        <button
                          type="button"
                          onClick={() => resendOtp(p.id)}
                          disabled={pending}
                          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          {pending && busyId === p.id ? 'Đang gửi…' : 'Gửi lại OTP'}
                        </button>
                        <button
                          type="button"
                          onClick={() => sendZns(p.id)}
                          disabled={!znsConfigured || !p.phone || pending}
                          title={znsConfigured ? undefined : 'Chưa cấu hình mẫu ZNS (chờ 616899 duyệt)'}
                          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          Gửi ZNS báo cấp TK
                        </button>
                        {p.students[0] && (
                          <Link
                            href={`/students/${p.students[0].id}/edit`}
                            className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                            title="Cấp mã kích hoạt đọc qua điện thoại (khi ZNS không tới được)"
                          >
                            Cấp mã tại quầy
                          </Link>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  )
}

function ZnsBadge({ zns, configured }: { zns: ZnsInfo; configured: boolean }) {
  if (!configured) return <span className="text-muted-foreground">Mẫu chưa cấu hình</span>
  if (!zns) return <span className="text-muted-foreground">Chưa gửi</span>
  if (zns.status === 'SENT' && zns.simulated)
    return (
      <span className="inline-flex rounded-full bg-state-info-soft px-2 py-0.5 font-medium text-state-info-ink" title={zns.at}>
        Mô phỏng (chưa live)
      </span>
    )
  if (zns.status === 'SENT')
    return (
      <span className="inline-flex rounded-full bg-state-success-soft px-2 py-0.5 font-medium text-state-success-ink" title={zns.at}>
        Đã gửi {zns.at}
      </span>
    )
  if (zns.status === 'FAILED')
    return (
      <span
        className="inline-flex rounded-full bg-state-danger-soft px-2 py-0.5 font-medium text-state-danger-ink"
        title={zns.error ?? undefined}
      >
        Lỗi gửi — rê chuột xem
      </span>
    )
  return (
    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-muted-foreground" title={zns.error ?? undefined}>
      {zns.status}
    </span>
  )
}

/** Escape 1 ô CSV (bọc ngoặc kép khi có dấu phẩy/xuống dòng/ngoặc kép). */
function csv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
