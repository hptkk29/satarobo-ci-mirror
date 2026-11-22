import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { checkAnyPermission } from '@/lib/auth/check-permission'
import { PAGE_GATES } from '@/lib/auth/page-gates'
import { scopedDb } from '@/lib/db-scope'
import { resolveActor } from '@/lib/auth/actor'
import { CONVERTED_STATUSES } from '@/lib/reports/lead'
// GĐ0 — nhãn + màu trạng thái lead lấy từ nguồn duy nhất @/lib/leads/status.
// Hai bảng chép tay trước đó thiếu TRIAL_IN_PROGRESS (và màu thiếu cả REGISTERED)
// nên hai trạng thái này hiện ra biểu đồ dưới dạng raw enum + màu xám mặc định.
import { LEAD_STATUS_LABEL, LEAD_STATUS_DOT } from '@/lib/leads/status'
import type { LeadStatus } from '@prisma/client'

function pct(part: number, total: number) {
  if (total === 0) return '0%'
  return `${Math.round((part / total) * 100)}%`
}

export default async function MarketingPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!(await checkAnyPermission(PAGE_GATES['/marketing']))) redirect('/dashboard')

  // Cách ly cơ sở: Lead ∈ SCOPED_MODELS → scopedDb auto-inject centerId IN visible
  // cho count/groupBy. CENTER_MANAGER@CS1 chỉ thấy lead CS1; SUPER_ADMIN/HO = ALL.
  const actor = await resolveActor(session.user.id)
  const sdb = scopedDb(actor)

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [
    totalLeads,
    leadsByStatus,
    recentTrend,
  ] = await Promise.all([
    sdb.lead.count({ where: { deletedAt: null } }).catch(() => 0),
    sdb.lead.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    }).catch(() => []),
    sdb.lead.count({ where: { deletedAt: null, createdAt: { gte: thirtyDaysAgo } } }).catch(() => 0),
  ])

  // groupBy source — order client-side to avoid Prisma typing issue
  const [rawSource, rawUtmSource, rawUtmCampaign] = await Promise.all([
    sdb.lead.groupBy({
      by: ['source'],
      where: { deletedAt: null, source: { not: null } },
      _count: { _all: true },
    }).catch(() => []),
    sdb.lead.groupBy({
      by: ['utmSource'],
      where: { deletedAt: null, utmSource: { not: null } },
      _count: { _all: true },
    }).catch(() => []),
    sdb.lead.groupBy({
      by: ['utmCampaign'],
      where: { deletedAt: null, utmCampaign: { not: null } },
      _count: { _all: true },
    }).catch(() => []),
  ])

  const leadsBySource = [...rawSource].sort((a, b) => b._count._all - a._count._all).slice(0, 8)
  const leadsByUtmSource = [...rawUtmSource].sort((a, b) => b._count._all - a._count._all).slice(0, 8)
  const leadsByUtmCampaign = [...rawUtmCampaign].sort((a, b) => b._count._all - a._count._all).slice(0, 8)

  // Đã chuyển đổi = ENROLLED + REGISTERED (nguồn chung CONVERTED_STATUSES, khớp Báo cáo
  // Lead 92.2%). Trước đây chỉ đếm ENROLLED → bỏ sót REGISTERED → tỉ lệ 2% sai.
  const enrolledCount = leadsByStatus
    .filter((s) => CONVERTED_STATUSES.has(s.status))
    .reduce((sum, s) => sum + s._count._all, 0)
  const conversionRate = pct(enrolledCount, totalLeads)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Marketing Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Phân tích hiệu quả chiến dịch và tracking</p>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Tổng lead', value: totalLeads.toLocaleString('vi-VN'), sub: 'Tất cả thời gian' },
          { label: 'Lead 30 ngày qua', value: recentTrend.toLocaleString('vi-VN'), sub: 'Tháng gần nhất' },
          { label: 'Đã chuyển đổi', value: enrolledCount.toLocaleString('vi-VN'), sub: 'Đã đăng ký + ghi danh' },
          { label: 'Tỉ lệ chuyển đổi', value: conversionRate, sub: 'Đã chuyển đổi / Tổng lead' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
            <p className="mt-1 text-3xl font-bold text-foreground">{card.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Lead funnel */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-bold text-foreground">Phễu chuyển đổi Lead</h2>
        <div className="space-y-3">
          {leadsByStatus.map((row) => (
            <div key={row.status}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{LEAD_STATUS_LABEL[row.status as LeadStatus] ?? row.status}</span>
                <span className="tabular-nums text-muted-foreground">
                  {row._count._all} ({pct(row._count._all, totalLeads)})
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted">
                <div
                  className={`h-2.5 rounded-full ${LEAD_STATUS_DOT[row.status as LeadStatus] ?? 'bg-gray-400'}`}
                  style={{ width: pct(row._count._all, totalLeads) }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* By source */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-foreground">Theo nguồn khóa học</h2>
          {leadsBySource.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu</p>
          ) : (
            <ul className="space-y-2.5">
              {leadsBySource.map((row) => (
                <li key={row.source} className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-muted-foreground">{row.source ?? '(trực tiếp)'}</span>
                  <span className="shrink-0 text-sm font-bold text-foreground">{row._count._all}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* By UTM source */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-foreground">Theo UTM Source</h2>
          {leadsByUtmSource.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu UTM</p>
          ) : (
            <ul className="space-y-2.5">
              {leadsByUtmSource.map((row) => (
                <li key={row.utmSource} className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-muted-foreground">{row.utmSource ?? '(none)'}</span>
                  <span className="shrink-0 text-sm font-bold text-foreground">{row._count._all}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* By UTM campaign */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-foreground">Theo UTM Campaign</h2>
          {leadsByUtmCampaign.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có dữ liệu UTM</p>
          ) : (
            <ul className="space-y-2.5">
              {leadsByUtmCampaign.map((row) => (
                <li key={row.utmCampaign} className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-muted-foreground">{row.utmCampaign ?? '(none)'}</span>
                  <span className="shrink-0 text-sm font-bold text-foreground">{row._count._all}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Tracking config status */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-bold text-foreground">Trạng thái Tracking</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Meta Pixel (client)', envKey: 'NEXT_PUBLIC_META_PIXEL_ID' },
            { label: 'Meta CAPI (server)', envKey: 'META_CAPI_TOKEN' },
            { label: 'GA4 (client)', envKey: 'NEXT_PUBLIC_GA4_ID' },
            { label: 'GA4 MP (server)', envKey: 'GA4_API_SECRET' },
          ].map((item) => {
            const configured = !!(process.env[item.envKey])
            return (
              <div key={item.label} className="flex items-center gap-3 rounded-lg border border-border bg-muted px-4 py-3">
                <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${configured ? 'bg-state-success' : 'bg-state-danger'}`} />
                <div>
                  <p className="text-xs font-semibold text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{configured ? 'Đã cấu hình' : 'Chưa cấu hình'}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
