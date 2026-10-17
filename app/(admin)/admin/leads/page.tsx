import Link from 'next/link'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { scopedDb } from '@/lib/db-scope'
import { resolveActor } from '@/lib/auth/actor'
import { checkPermission, checkPermissionDetail } from '@/lib/auth/check-permission'
import { maskLeadPiiFields } from '@/lib/lead/pii'
import { leadSharingEnabled } from '@/lib/lead/sharing'
import { splitLeadNote } from '@/lib/lead/note-view'
import { canViewLeadPii } from '@/lib/auth/check-permission'
import { LeadsTable } from './_components/leads-table'
import { LeadsRefreshButton } from './_components/refresh-button'
import type { LeadRow } from './_components/leads-table'
import { LeadsKanban, type KanbanLead } from './_components/leads-kanban'
import { ALL_LEAD_STATUSES } from '@/lib/leads/status'
import type { LeadStatus, Prisma } from '@prisma/client'
import { phoneSearchTerm } from '@/lib/phone'
import { getNonEnrollableCenterIds } from '@/lib/enrollment-flow'
import { docSoDong, docSoTheMoiCot } from '@/lib/ui/phan-trang'
import { leadOwnershipWhere } from "@/lib/lead/ownership";

const KANBAN_LIMIT = 500

type SP = {
  page?: string
  size?: string
  status?: string
  q?: string
  view?: string
  centerId?: string
  assignedToId?: string
  source?: string
  dateFrom?: string
  dateTo?: string
  /** 29/08 — 'moi_nhat' (mặc định) | 'nhap_lai' (theo lần nhập gần nhất). */
  sort?: string
}

export const metadata = { title: 'Leads | Admin' }

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SP>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const canViewAll = (await checkPermission('leads:view-all'))
  const canCreate = (await checkPermission('leads:create'))
  const canViewOwn = (await checkPermission('leads:view-own'))
  if (!canViewAll && !canViewOwn) redirect('/dashboard')

  // SALES_CSM (chỉ view-own) → scope về lead của chính mình.
  const scopeToSelf = !canViewAll && canViewOwn
  // Đợt E — chính sách "dùng chung lead": mặc định TẮT (lead độc quyền).
  const sharingOn = leadSharingEnabled()

  // Cách ly cơ sở: Lead ∈ SCOPED_MODELS → sdb.lead tự inject `centerId IN visible`.
  // CENTER_MANAGER@CS1 không thấy lead CS2 (kể cả khi tự set filterCenter=CS2 → giao
  // tập rỗng). SUPER_ADMIN/HO bypass (ALL). Center/User không scoped — sdb = db.
  const actor = await resolveActor(session.user.id)
  const sdb = scopedDb(actor)

  const params = await searchParams
  const view = params.view === 'kanban' ? 'kanban' : 'table'
  const page = Math.max(1, Number(params.page ?? 1))
  const soDong = docSoDong(params.size)
  const statusParam = params.status as LeadStatus | undefined
  const q = params.q?.trim()
  // SĐT lưu 2 dạng (0… cũ / 84… mới) — tìm theo phần lõi để không sót. Xem lib/phone.ts.
  const qPhone = q ? (phoneSearchTerm(q) ?? q) : q
  const statusFilter =
    statusParam && ALL_LEAD_STATUSES.includes(statusParam)
      ? statusParam
      : undefined

  const filterCenter = params.centerId?.trim() || undefined
  const filterAssignedTo = params.assignedToId?.trim() || undefined
  const filterSource = params.source?.trim() || undefined
  const dateFrom = params.dateFrom?.trim() || undefined
  const dateTo = params.dateTo?.trim() || undefined

  const createdAt: Prisma.DateTimeFilter | undefined =
    dateFrom || dateTo
      ? {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59`) } : {}),
        }
      : undefined

  // #11 T2 — mask PII lead (SĐT/email/tên PH-HS/note) ở SERVER cho actor không có
  // quyền leads:view-pii — chặn leak qua RSC payload, không chỉ che UI.
  // ⚠️ Không lấy MARKETING làm ví dụ nữa: từ 21/07 MARKETING CÓ leads:view-pii.
  // Hiện mọi vai vào được trang này đều có quyền, nên nhánh mask chỉ chạy khi
  // admin thu quyền của một người cụ thể qua UserPermissionGrant (DENY).
  const canViewPii = await canViewLeadPii()
  // NỢ #11 (search-oracle): chỉ cho tìm theo SĐT khi actor thấy được SĐT thật —
  // PII lead do leads:view-pii cai quản (canViewPii VÀ không bị DENY cấp trường
  // "phone" TS-02). Thiếu quyền mà vẫn filter theo SĐT = dò được số qua kết quả.
  const { fieldMask: leadPiiMask } = await checkPermissionDetail('leads:view-pii')
  const canSearchPhone = canViewPii && !leadPiiMask.includes('phone')

  // Base filter (không kèm status) — dùng cho query chính (thêm status tuỳ view)
  // + đếm badge tab "Đã đăng ký" (luôn đếm trên scope hiện tại, bất kể view/status filter).
  const baseWhere: Prisma.LeadWhereInput = {
    deletedAt: null,
    // SHARE T1 — sale view-own thấy lead của mình HOẶC lead team đã bật "dùng chung".
    // Gói trong AND để không đè key OR của search q bên dưới (2 OR sống chung).
    // Cách ly cơ sở vẫn do scopedDb inject centerId — share không xuyên cơ sở.
    ...(scopeToSelf
      ? {
          AND: [
            // S-8 — "khách của tôi" có ĐÚNG MỘT định nghĩa, ở `lib/lead/ownership.ts`.
            // Chép tay mệnh đề này ra từng màn là cách chắc chắn để hai màn trả hai
            // danh sách khác nhau cho cùng một người, và không ai phát hiện cho tới lúc
            // đếm KPI. Site Sale (`/sale/khach-cua-toi`) gọi đúng hàm này.
            //
            // Nội dung nó gói lại: phiếu được GIAO cho mình, phiếu mình NHẬP (Sale Hội
            // sở không bao giờ là assignee — thiếu vế này thì danh sách của họ trắng),
            // và mệnh đề "dùng chung" vốn RỖNG theo mặc định từ Đợt E (22/08); đường
            // quay lui là env `LEAD_SHARING_ENABLED="true"`.
            leadOwnershipWhere(session.user.id),
          ],
        }
      : {}),
    ...(filterAssignedTo && canViewAll
      ? { assignedToId: filterAssignedTo }
      : {}),
    ...(filterCenter ? { centerId: filterCenter } : {}),
    ...(filterSource ? { source: { contains: filterSource, mode: 'insensitive' } } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(q
      ? {
          OR: [
            { parentName: { contains: q, mode: 'insensitive' as const } },
            // Lead.phone = SĐT PH — chỉ tìm được khi thấy SĐT thật (NỢ #11).
            ...(canSearchPhone ? [{ phone: { contains: qPhone } }] : []),
            { childName: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const where: Prisma.LeadWhereInput = {
    ...baseWhere,
    // Kanban hiển thị mọi cột → bỏ qua status filter ở view kanban.
    ...(statusFilter && view === 'table' ? { status: statusFilter } : {}),
  }

  // NHÓM 03 — Việc 2: đếm lead "Đã đăng ký" cho tab preset.
  // GĐ5 — con số này nay đếm CẢ lead đã convert, vì DA_DANG_KY gộp REGISTERED lẫn
  // ENROLLED. Cố ý để badge khớp đúng thứ tab lọc ra (ô lọc chỉ nhận `status`, không
  // diễn tả được `convertedAt`); danh sách "đã đăng ký mà CHƯA convert" nằm ở màn
  // /leads/bulk-convert, nơi có lọc thêm convertedAt.
  const registeredCount = await sdb.lead.count({
    where: { ...baseWhere, status: 'DA_DANG_KY' },
  })

  const canCloseDeal =
    (await checkPermission('students:create')) && (await checkPermission('enrollments:create'))
  const canAssign = (await checkPermission('leads:assign'))

  // Filter dropdown data (chỉ cần cho role view-all).
  // Hội sở KHÔNG bao giờ có lead (chốt 04/08) → để trong ô lọc là lựa chọn luôn ra
  // rỗng, người dùng tưởng mất dữ liệu. Nhận diện qua cây OrgUnit, không hardcode.
  const nonEnrollable = await getNonEnrollableCenterIds()
  const [centers, sales] = canViewAll
    ? await Promise.all([
        sdb.center
          .findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { displayOrder: 'asc' },
          })
          .then((cs) => cs.filter((c) => !nonEnrollable.includes(c.id))),
        sdb.user.findMany({
          where: { isActive: true, deletedAt: null, roles: { has: 'SALES_CSM' } },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ])
    : [[], []]

  if (view === 'kanban') {
    const nowTs = new Date()
    const rawLeads = await sdb.lead.findMany({
      where,
      include: {
        course: { select: { name: true } },
        assignedTo: { select: { name: true } },
        // T1.2 — phát hiện quá hạn: có task OPEN dueAt < now.
        tasks: {
          where: { status: 'OPEN', dueAt: { lt: nowTs } },
          select: { id: true },
          take: 1,
        },
        // FL-R2 (item 6/TR-4) — lần học thử gần nhất (giữ kể cả khi lead quay lại pipeline).
        children: {
          select: {
            trialHistory: {
              where: { attendedCount: { gt: 0 } },
              select: { lastAttendedAt: true },
              orderBy: { lastAttendedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: KANBAN_LIMIT,
    })

    // Tổng thật để nhãn "Tổng N lead" khớp với view bảng. Chỉ đếm thêm khi đã chạm trần
    // (dưới trần thì số card hiển thị = tổng, khỏi query dư).
    const kanbanTotal =
      rawLeads.length < KANBAN_LIMIT ? rawLeads.length : await sdb.lead.count({ where })

    // Kanban CHỈ làm một việc: kéo thẻ = đổi trạng thái ⇒ gác bằng quyền đổi trạng
    // thái, không phải `leads:edit`. Không có quyền thì thẻ vẫn xem được, chỉ không kéo.
    const canUpdate = (await checkPermission('leads:change-status'))
    const kanbanLeads: KanbanLead[] = rawLeads.map((raw) => {
      // #11 T2 — mask PII (tên PH/SĐT/tên con) trước khi build payload client.
      const l = maskLeadPiiFields(raw, canViewPii)
      // ngày học thử gần nhất across mọi con.
      const trialDates = l.children
        .flatMap((c) => c.trialHistory.map((h) => h.lastAttendedAt))
        .filter((d): d is Date => d != null)
        .sort((a, b) => b.getTime() - a.getTime())
      return {
        id: l.id,
        parentName: l.parentName,
        phone: l.phone,
        childName: l.childName,
        status: l.status,
        source: l.source,
        courseName: l.course?.name ?? null,
        assignedToName: l.assignedTo?.name ?? null,
        createdAt: l.createdAt.toISOString(),
        overdue: l.tasks.length > 0,
        lastTrialDate: trialDates[0]?.toISOString() ?? null,
        // SHARE T1 — badge "Dùng chung" trên card. Đợt E: chính sách tắt thì
        // badge tắt theo (client không đọc được env, nên cắt ngay ở server).
        isSharedWithTeam: sharingOn && l.isSharedWithTeam,
        assignedToId: l.assignedToId,
      }
    })

    return (
      <div>
        <Header
          total={kanbanTotal}
          shown={rawLeads.length}
          view={view}
          params={params}
          canCreate={canCreate}
          canBulkConvert={canViewAll && canCreate}
        />
        <StatusTabs params={params} view={view} registeredCount={registeredCount} />
        <FilterBar
          params={params}
          centers={centers}
          sales={sales}
          canViewAll={canViewAll}
          view={view}
        />
        <LeadsKanban
          leads={kanbanLeads}
          // Cùng tham số `?size=` với bảng, chỉ khác giá trị mặc định (5 thẻ/cột).
          soTheMoiCot={docSoTheMoiCot(params.size)}
          canUpdate={canUpdate}
          canCloseDeal={canCloseDeal}
          canAssign={canAssign}
          currentUserId={session.user.id}
        />
      </div>
    )
  }

  // ── Table view ──
  // 29/08 — SẮP XẾP theo LẦN NHẬP GẦN NHẤT.
  //
  // Vì sao đáng có: khách gọi lại / điền form lần nữa thì hệ thống KHÔNG đẻ lead mới
  // (trùng SĐT), nó nâng `lastInboundAt`. Sắp theo `createdAt` thì phiếu vừa nóng lại
  // nằm lẫn dưới đáy cùng phiếu nguội ba tháng — Sale không có cách nào biết để gọi trước.
  //
  // `nulls: "last"` bắt buộc: lead có TRƯỚC 29/08 mang `lastInboundAt` do migration
  // backfill = `createdAt`, nhưng lead tạo bằng đường SQL thô thì vẫn null. Không khai
  // thì Postgres xếp NULL lên đầu ở chiều `desc` — đúng nhóm cũ nhất lại nằm trên cùng.
  const sapXep = params.sort === 'nhap_lai' ? 'nhap_lai' : 'moi_nhat'
  // ⚠️ 07/09/2026 — MẶC ĐỊNH cũng sắp theo lần nhập gần nhất.
  //
  // Từ nay cột "Ngày nhận lead" IN ngày nhận hiệu lực (xem `leads-table.tsx`). Sắp
  // theo `createdAt` trong khi in `lastInboundAt` là để phiếu hiện ngày hôm nay nằm
  // ở vị trí của ba tháng trước — mũi tên sắp xếp ngay trên đầu cột nói dối. Hai thứ
  // này phải đổi CÙNG NHAU.
  //
  // `nhap_lai` giữ lại cho đường dẫn ai đó đã lưu; nay nó cho ra CÙNG thứ tự.
  const thuTuLead: Prisma.LeadOrderByWithRelationInput = {
    lastInboundAt: { sort: 'desc', nulls: 'last' },
  }

  const [rawLeads, total] = await Promise.all([
    sdb.lead.findMany({
      where,
      include: {
        center: { select: { name: true } },
        course: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: thuTuLead,
      skip: (page - 1) * soDong,
      take: soDong,
    }),
    sdb.lead.count({ where }),
  ])

  // 30/08 — bảng KHÔNG còn sửa gì tại chỗ (ngăn kéo đã gỡ, ô trạng thái thành nhãn),
  // nên `leads:edit` / `leads:change-status` không còn cần ở đây. Hai quyền đó nay hỏi
  // ở TRANG CHI TIẾT, đúng nơi thao tác thật xảy ra.
  const canDelete = (await checkPermission('leads:delete'))

  const leads: LeadRow[] = rawLeads.map((raw) => {
    // #11 T2 — mask PII (tên PH/SĐT/email/tên con/note) trước khi build payload client.
    const lead = maskLeadPiiFields(raw, canViewPii)
    return {
      id: lead.id,
      parentName: lead.parentName,
      phone: lead.phone,
      email: lead.email,
      childName: lead.childName,
      childAge: lead.childAge,
      status: lead.status,
      source: lead.source,
      // 24/08 — ô ghi chú ở ngăn kéo chỉ hiện phần NGƯỜI GÕ; updateLeadNote ráp
      // lại dòng máy ghi lúc lưu (lib/lead/note-view.ts).
      note: splitLeadNote(lead.note).human,
      utmSource: lead.utmSource,
      utmMedium: lead.utmMedium,
      utmCampaign: lead.utmCampaign,
      eventId: lead.eventId,
      landingPage: lead.landingPage,
      referrer: lead.referrer,
      ipAddress: lead.ipAddress,
      userAgent: lead.userAgent,
      consentMarketing: lead.consentMarketing,
      createdAt: lead.createdAt.toISOString(),
      lastInboundAt: lead.lastInboundAt?.toISOString() ?? null,
      inboundCount: lead.inboundCount,
      center: lead.center,
      courseName: lead.course?.name ?? null,
      assignedTo: lead.assignedTo,
      // SHARE T1 — badge "Dùng chung" trên bảng. Đợt E: xem ghi chú ở kanban.
      isSharedWithTeam: sharingOn && lead.isSharedWithTeam,
      assignedToId: lead.assignedToId,
    }
  })

  return (
    <div>
      <Header total={total} view={view} params={params} canCreate={canCreate} canBulkConvert={canViewAll && canCreate} />
      <StatusTabs params={params} view={view} registeredCount={registeredCount} />
      <FilterBar
        params={params}
        centers={centers}
        sales={sales}
        canViewAll={canViewAll}
        view={view}
      />
      <LeadsTable
        leads={leads}
        total={total}
        page={page}
        pageSize={soDong}
        sapXep={sapXep}
        canDelete={canDelete}
        canExport={await checkPermission('leads:export')}
        currentStatus={statusFilter}
        currentQ={q}
        currentUserId={session.user.id}
      />
    </div>
  )
}

// ─── Header + view toggle ────────────────────────────────────────────────────
function Header({
  total,
  shown,
  view,
  params,
  canCreate,
  canBulkConvert,
}: {
  total: number
  /** Số card thực sự hiển thị ở kanban (để chú thích khi đã chạm trần). */
  shown?: number
  view: string
  params: SP
  canCreate?: boolean
  /** Nút "Chốt hàng loạt" chỉ cho manager (leads:view-all) — màn đó thấy mọi lead cơ sở. */
  canBulkConvert?: boolean
}) {
  const qs = (v: 'table' | 'kanban') => {
    const u = new URLSearchParams()
    if (params.q) u.set('q', params.q)
    if (params.centerId) u.set('centerId', params.centerId)
    if (params.assignedToId) u.set('assignedToId', params.assignedToId)
    if (params.source) u.set('source', params.source)
    if (params.dateFrom) u.set('dateFrom', params.dateFrom)
    if (params.dateTo) u.set('dateTo', params.dateTo)
    u.set('view', v)
    return `/leads?${u.toString()}`
  }
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Danh sách Lead</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total > 0
            ? `Tổng ${total} lead${
                view === 'kanban' && shown != null && shown < total
                  ? ` (hiển thị ${shown} mới nhất)`
                  : ''
              }`
            : 'Chưa có lead nào'}
        </p>
      </div>
      {/* 31/08/2026 — nạp lại NGAY TRÊN TRANG để thấy lead mới, khỏi F5. CHỈ vẽ ở
          Kanban: chế độ Bảng đã có nút này trong hàng công cụ của bảng (cạnh "Cột hiển
          thị" — chốt của chủ dự án), mà Kanban thì không có hàng công cụ đó. Vẽ cả hai
          chỗ là màn Bảng mọc hai nút giống hệt nhau. */}
      {view === 'kanban' && <LeadsRefreshButton />}
      <div className="inline-flex overflow-hidden rounded-lg border border-border">
        {/* `scroll={false}`: đổi khung nhìn là ĐỔI THAM SỐ của chính trang này, không
            phải sang trang khác — để Next tự cuộn lên đầu là người dùng mất chỗ đang xem. */}
        <Link
          href={qs('table')}
          scroll={false}
          className={`px-3 py-1.5 text-sm font-medium ${ view === 'table' ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:bg-muted' }`}
        >
          Bảng
        </Link>
        <Link
          href={qs('kanban')}
          scroll={false}
          className={`px-3 py-1.5 text-sm font-medium ${ view === 'kanban' ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:bg-muted' }`}
        >
          Kanban
        </Link>
      </div>
      {canCreate && (
        <div className="flex items-center gap-2">
          <a
            href="/api/admin/templates/leads"
            download="mau-lead.xlsx"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            Tải file mẫu
          </a>
          <Link
            href="/leads/import"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            Import Excel
          </Link>
          {canBulkConvert && (
            <Link
              href="/leads/bulk-convert"
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Chốt hàng loạt
            </Link>
          )}
          {/* 03/09/2026 — trỏ sang "Nhập khách hàng" thay vì `/leads/new` (chủ dự án chốt).
              Không chỉ là đổi chỗ: `/nhap-khach-hang` đi qua đường nhận lead chung
              (`ingestIntakeLead`) nên có sẵn CHỐNG TRÙNG SĐT và TỰ CHIA cho sale theo
              vòng — hai thứ `/leads/new` không có, nên lead gõ tay ở đó nằm im không ai
              nhận, và gõ trùng số thì đẻ phiếu thứ hai.
              Cùng một quyền `leads:create` gác cả nút này lẫn trang đích
              (`PAGE_GATES["/nhap-khach-hang"]`) ⇒ ai thấy nút là mở được trang. */}
          <Link
            href="/nhap-khach-hang"
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
          >
            + Thêm lead
          </Link>
        </div>
      )}
    </div>
  )
}

// ─── NHÓM 03 (Việc 2) — tab preset "Đã đăng ký" (?status=DA_DANG_KY) ─────────
function StatusTabs({
  params,
  view,
  registeredCount,
}: {
  params: SP
  view: string
  registeredCount: number
}) {
  const qs = (status?: string) => {
    const u = new URLSearchParams()
    if (params.q) u.set('q', params.q)
    if (params.centerId) u.set('centerId', params.centerId)
    if (params.assignedToId) u.set('assignedToId', params.assignedToId)
    if (params.source) u.set('source', params.source)
    if (params.dateFrom) u.set('dateFrom', params.dateFrom)
    if (params.dateTo) u.set('dateTo', params.dateTo)
    // Tab preset chỉ có ý nghĩa ở view bảng (kanban hiện mọi cột, bỏ qua status filter).
    u.set('view', 'table')
    if (status) u.set('status', status)
    return `/leads?${u.toString()}`
  }
  const isRegistered = view === 'table' && params.status === 'DA_DANG_KY'
  const tabCls = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${
      // Tab ĐANG CHỌN là trạng thái điều hướng, không phải "thành công" — dùng màu
      // thương hiệu. Trước đây nó xanh lục, tranh nghĩa với badge trạng thái ngay
      // cạnh (DESIGN.md §1: màu ngữ nghĩa là thang RIÊNG, không mượn lẫn nhau).
      active ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
    } border border-border`

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {/* `scroll={false}`: tab preset chỉ đổi `?status=` của chính trang này. */}
      <Link href={qs(undefined)} scroll={false} className={tabCls(view === 'table' && !params.status)}>
        Tất cả
      </Link>
      <Link href={qs('DA_DANG_KY')} scroll={false} className={tabCls(isRegistered)}>
        Đã đăng ký{' '}
        <span
          className={`ml-1 rounded-full px-1.5 py-0.5 text-xs font-semibold ${ isRegistered ? 'bg-white/20' : 'bg-primary-soft text-primary' }`}
        >
          {registeredCount}
        </span>
      </Link>
    </div>
  )
}

// ─── Filter bar (GET form) ─────────────────────────────────────────────────────
function FilterBar({
  params,
  centers,
  sales,
  canViewAll,
  view,
}: {
  params: SP
  centers: { id: string; name: string }[]
  sales: { id: string; name: string | null }[]
  canViewAll: boolean
  view: string
}) {
  // Các input dùng `defaultValue` (uncontrolled) → React KHÔNG reset value khi điều hướng
  // client-side (vd bấm "Xoá lọc"). Đặt `key` theo bộ lọc hiện tại để form remount →
  // mọi ô nhập trả về defaultValue mới (rỗng khi đã xoá lọc). (bug: Xoá lọc còn chữ cũ)
  const filterKey = [
    params.q,
    params.centerId,
    params.assignedToId,
    params.source,
    params.dateFrom,
    params.dateTo,
  ]
    .map((v) => v ?? '')
    .join('|')
  return (
    <form
      key={filterKey}
      method="GET"
      className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-muted p-3"
    >
      <input type="hidden" name="view" value={view} />
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Tìm</label>
        <input
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Tên / SĐT / tên con"
          className="w-48 rounded border px-2 py-1.5 text-sm"
        />
      </div>
      {canViewAll && (
        <>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Cơ sở</label>
            <select
              name="centerId"
              defaultValue={params.centerId ?? ''}
              className="rounded border px-2 py-1.5 text-sm"
            >
              <option value="">Tất cả</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Sale</label>
            <select
              name="assignedToId"
              defaultValue={params.assignedToId ?? ''}
              className="rounded border px-2 py-1.5 text-sm"
            >
              <option value="">Tất cả</option>
              {sales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ?? '(chưa đặt tên)'}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Nguồn</label>
        <input
          name="source"
          defaultValue={params.source ?? ''}
          placeholder="vd: sata1, sale-form, quatang"
          className="w-36 rounded border px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Từ ngày</label>
        <input
          type="date"
          name="dateFrom"
          defaultValue={params.dateFrom ?? ''}
          className="rounded border px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Đến ngày</label>
        <input
          type="date"
          name="dateTo"
          defaultValue={params.dateTo ?? ''}
          className="rounded border px-2 py-1.5 text-sm"
        />
      </div>
      <button className="rounded bg-gray-800 px-3 py-1.5 text-sm font-medium text-white">
        Lọc
      </button>
      {/* `scroll={false}`: xoá lọc = quay về chính trang này không tham số. */}
      <Link
        href={`/leads?view=${view}`}
        scroll={false}
        className="rounded border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
      >
        Xoá lọc
      </Link>
    </form>
  )
}
