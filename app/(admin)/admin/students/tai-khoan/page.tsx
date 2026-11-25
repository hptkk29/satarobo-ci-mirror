import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/auth/check-permission'
import { resolveActor } from '@/lib/auth/actor'
import { scopedDb } from '@/lib/db-scope'
import { ParentAccountsClient } from './_components/parent-accounts-client'
import { duocXuatCuaPhienHienTai } from '@/lib/export/quyen-xuat'

export const metadata = { title: 'Tài khoản phụ huynh | Admin' }
export const dynamic = 'force-dynamic'

// Màn vận hành TK PHỤ HUYNH CHỜ KÍCH HOẠT — lỗ hổng vận hành trước đây: TK tạo từ
// convert/bulk-convert/đơn hàng nằm PENDING_ACTIVATION nhưng không màn nào liệt kê
// toàn cục; muốn biết ai chưa kích hoạt phải mò từng học viên. Ở đây: danh sách +
// trạng thái gửi ZNS báo cấp TK + gửi lại OTP + xuất CSV để gọi điện thủ công
// (đường thay thế khi mẫu ZNS 616899 chưa được Zalo duyệt).
export default async function ParentAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!(await checkPermission('students:edit'))) redirect('/students')

  const { status } = await searchParams
  const showAll = status === 'all'

  // User KHÔNG thuộc SCOPED_MODELS (scopedDb pass-through) → cách ly cơ sở TAY theo
  // actor.visibleCenterIds (mẫu /admin/centers). Review 02/08: bản đầu chỉ chặn đúng
  // role CENTER_MANAGER — Sale/role khác thấy TK phụ huynh mọi cơ sở (kèm CSV PII).
  const actor = await resolveActor(session.user.id)
  const centerWhere =
    actor.isSuperAdmin || actor.isHoLevel ? {} : { centerId: { in: actor.visibleCenterIds } }

  const sdb = scopedDb(actor)

  const parents = await sdb.user.findMany({
    where: {
      role: 'PARENT',
      deletedAt: null,
      ...(showAll ? {} : { accountStatus: 'PENDING_ACTIVATION' }),
      ...centerWhere,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      centerId: true,
      accountStatus: true,
      createdAt: true,
      children: {
        where: { deletedAt: null },
        select: { id: true, name: true, studentCode: true },
      },
    },
  })

  const [pendingCount, activeCount] = await Promise.all([
    sdb.user.count({
      where: {
        role: 'PARENT',
        deletedAt: null,
        accountStatus: 'PENDING_ACTIVATION',
        ...centerWhere,
      },
    }),
    sdb.user.count({
      where: {
        role: 'PARENT',
        deletedAt: null,
        accountStatus: 'ACTIVE',
        ...centerWhere,
      },
    }),
  ])

  // Trạng thái gửi ZNS "báo cấp TK": lần gửi GẦN NHẤT per SĐT với mẫu đang cấu hình.
  const znsTemplate = process.env.ZALO_ZNS_TEMPLATE_ACCOUNT || null
  const phones = parents.map((p) => p.phone).filter((p): p is string => Boolean(p))
  const znsLogs =
    znsTemplate && phones.length
      ? await sdb.zaloMessageLog.findMany({
          where: { templateKey: znsTemplate, toPhone: { in: phones } },
          orderBy: { createdAt: 'desc' },
          select: {
            toPhone: true,
            status: true,
            providerMessageId: true,
            errorMessage: true,
            createdAt: true,
          },
        })
      : []
  const latestZnsByPhone = new Map<
    string,
    { status: string; simulated: boolean; error: string | null; at: string }
  >()
  for (const log of znsLogs) {
    if (!log.toPhone || latestZnsByPhone.has(log.toPhone)) continue
    latestZnsByPhone.set(log.toPhone, {
      status: log.status,
      simulated: Boolean(log.providerMessageId?.startsWith('SIMULATED-')),
      error: log.errorMessage,
      at: log.createdAt.toISOString().slice(0, 16).replace('T', ' '),
    })
  }

  const centers = await sdb.center.findMany({ select: { id: true, name: true, code: true } })
  const centerName = new Map(centers.map((c) => [c.id, c.code || c.name]))

  return (
    <div className="p-6">
      <Link
        href="/students"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Học viên
      </Link>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tài khoản phụ huynh</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Theo dõi tài khoản chờ kích hoạt · gửi lại mã OTP · báo cấp tài khoản qua Zalo · xuất
            danh sách gọi điện. Phụ huynh tự kích hoạt tại{' '}
            <span className="font-mono">satarobo.vn/kich-hoat</span> (nhập SĐT → nhận OTP
            Zalo → đặt mật khẩu).
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/students/tai-khoan"
            className={`rounded-lg px-3 py-1.5 font-medium ${!showAll ? 'bg-primary-dark text-white' : 'border border-border text-foreground hover:bg-muted'}`}
          >
            Chờ kích hoạt ({pendingCount})
          </Link>
          <Link
            href="/students/tai-khoan?status=all"
            className={`rounded-lg px-3 py-1.5 font-medium ${showAll ? 'bg-primary-dark text-white' : 'border border-border text-foreground hover:bg-muted'}`}
          >
            Tất cả ({pendingCount + activeCount})
          </Link>
        </div>
      </div>

      {!znsTemplate && (
        <div className="mb-4 rounded-lg border border-state-warning bg-state-warning-soft p-3 text-sm text-state-warning-ink">
          <b>Mẫu ZNS &quot;báo cấp tài khoản&quot; chưa cấu hình</b> (env{' '}
          <span className="font-mono">ZALO_ZNS_TEMPLATE_ACCOUNT</span> — mẫu 616899 đang chờ Zalo
          duyệt). Trong lúc chờ: dùng nút <b>Xuất CSV</b> để gọi điện/nhắn Zalo OA thủ công hướng
          dẫn phụ huynh vào <span className="font-mono">/kich-hoat</span>, hoặc{' '}
          <b>Gửi lại OTP</b> khi phụ huynh đang thao tác trực tiếp.
        </div>
      )}

      <ParentAccountsClient
        xuatDuoc={await duocXuatCuaPhienHienTai('tai-khoan-phu-huynh')}
        znsConfigured={Boolean(znsTemplate)}
        parents={parents.map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone,
          email: p.email,
          center: (p.centerId && centerName.get(p.centerId)) || '—',
          status: p.accountStatus,
          createdAt: p.createdAt.toISOString().slice(0, 10),
          students: p.children.map((s) => ({
            id: s.id,
            name: s.name,
            code: s.studentCode,
          })),
          zns: p.phone ? (latestZnsByPhone.get(p.phone) ?? null) : null,
        }))}
      />
    </div>
  )
}
