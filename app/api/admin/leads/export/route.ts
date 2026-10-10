import * as XLSX from 'xlsx'
import { buildLeadsWorkbook } from '@/lib/export/leads-xlsx'
import { requireLiveSession } from '@/lib/auth/live-session'
import { canViewLeadPii } from '@/lib/auth/check-permission'
import { chanXuat } from '@/lib/export/chan-xuat'
import { resolveActor } from '@/lib/auth/actor'
import { scopedDb } from '@/lib/db-scope'
import { maskPhone, maskEmail, maskPersonName, maskFreeText } from '@/lib/lead/pii'
import { writeAudit } from '@/lib/audit/audit-log'
import { getAuditActor } from '@/lib/audit/log'
import { exportWatermark } from '@/lib/export/watermark'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { LeadStatus } from '@prisma/client'
import { ALL_LEAD_STATUSES } from '@/lib/leads/status'
import { phoneSearchTerm } from '@/lib/phone'

const VALID_STATUSES: LeadStatus[] = ALL_LEAD_STATUSES

export async function GET(req: NextRequest) {
  const session = await requireLiveSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // ⚠️ 31/08/2026 — cổng đổi `leads:view-all` → `leads:export`.
  //
  // Hai quyền này KHÁC nhau và trước đây dùng nhầm: `leads:view-all` là "xem được lead
  // của người khác", còn xuất cả danh sách khách hàng ra một file mang đi được là việc
  // riêng — permission `leads:export` vốn đã có nhưng route này chưa từng dùng.
  // Chốt của chủ dự án: chỉ Quản lý cơ sở + Quản trị tối cao (đã gỡ MARKETING khỏi
  // `leads:export` ở cả v1 `lib/auth/permissions.ts` lẫn v2 `prisma/seed-roles.ts`).
  // Cổng xuất: vai được giao ở Cấu hình vận hành → Quyền xuất dữ liệu, CỘNG với quyền đọc
  // dữ liệu (`leads:export`). Xem `lib/export/quyen-xuat.ts`.
  const chan = await chanXuat("lead", session)
  if (chan) return chan

  const { searchParams } = req.nextUrl
  const statusParam = searchParams.get('status') as LeadStatus | null
  const q = searchParams.get('q')?.trim()
  // SĐT lưu 2 dạng (0… cũ / 84… mới) — tìm theo phần lõi để không sót.
  const qPhone = q ? (phoneSearchTerm(q) ?? q) : q

  const statusFilter = statusParam && VALID_STATUSES.includes(statusParam) ? statusParam : undefined

  const where = {
    deletedAt: null as null,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(q ? {
      OR: [
        { parentName: { contains: q, mode: 'insensitive' as const } },
        { phone: { contains: qPhone } },
        { childName: { contains: q, mode: 'insensitive' as const } },
      ],
    } : {}),
  }

  // #11 T2 — export CÁCH LY CƠ SỞ: Lead ∈ SCOPED_MODELS → sdb.lead tự inject
  // `centerId IN visible` (CM/Sale CS1 không export được lead CS2; SUPER_ADMIN/HO = ALL).
  const actor = await resolveActor(session.user.id)
  const leads = await scopedDb(actor).lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5000,
    select: {
      id: true,
      parentName: true,
      phone: true,
      email: true,
      childName: true,
      childAge: true,
      status: true,
      source: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      note: true,
      consentMarketing: true,
      createdAt: true,
      center: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  })

  // #11 T2 — mask PII lead (SĐT/email/tên PH-HS/note) NGAY TẠI SERVER trước khi
  // ghi CSV cho actor không có quyền leads:view-pii (vd MARKETING).
  const canViewPii = await canViewLeadPii()

  const headers = [
    'ID', 'Phụ huynh', 'SĐT', 'Email', 'Tên con', 'Tuổi',
    'Trạng thái', 'Nguồn', 'UTM Source', 'UTM Medium', 'UTM Campaign',
    'Cơ sở', 'Phụ trách', 'Ghi chú', 'Ngày đăng ký',
  ]

  const rows = leads.map((lead) => [
    lead.id,
    canViewPii ? lead.parentName : maskPersonName(lead.parentName),
    canViewPii ? lead.phone : maskPhone(lead.phone),
    canViewPii ? (lead.email ?? '') : lead.email ? maskEmail(lead.email) : '',
    canViewPii ? (lead.childName ?? '') : maskPersonName(lead.childName),
    lead.childAge != null ? String(lead.childAge) : '',
    lead.status,
    lead.source ?? '',
    lead.utmSource ?? '',
    lead.utmMedium ?? '',
    lead.utmCampaign ?? '',
    lead.center?.name ?? '',
    lead.assignedTo?.name ?? '',
    canViewPii ? (lead.note ?? '') : (maskFreeText(lead.note) ?? ''),
    lead.createdAt.toLocaleDateString('vi-VN'),
  ])

  const now = new Date()
  const { actorId, actorName } = getAuditActor(session)
  // SEC-M05: watermark dòng cuối (truy vết) + audit EXPORT.
  const watermark = exportWatermark(actorName, actorId, leads.length, now)
  // 31/08/2026 — xuất XLSX thay cho CSV. Việc dựng workbook (và phần dễ sai nhất: ép
  // cột SĐT thành CHUỖI để Excel không nuốt số 0 đầu) tách sang `lib/export/leads-xlsx`
  // để test được — route này cần session + permission nên Vitest không gọi thẳng vào đây.
  const wb = buildLeadsWorkbook({
    headers,
    rows,
    watermark,
    phoneColumnIndex: headers.indexOf('SĐT'),
  })
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const date = now.toISOString().slice(0, 10)

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: 'leads',
    entityType: 'Lead',
    entityId: 'export',
    action: 'EXPORT',
    newValues: {
      count: leads.length,
      status: statusFilter ?? 'ALL',
      q: q ?? null,
      piiMasked: !canViewPii,
    },
  })

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="leads-${date}.xlsx"`,
    },
  })
}
