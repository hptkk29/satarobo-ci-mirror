'use server'

// Màn "Tài khoản phụ huynh" — actions vận hành danh sách TK chờ kích hoạt:
//  - Gửi lại OTP kích hoạt theo USER (màn students chỉ có nút theo studentId —
//    TK mồ côi từ đường đơn hàng không có studentId thì không UI nào với tới).
//  - Gửi ZNS "báo đã cấp TK" (mẫu 616899) per-user + hàng loạt: KHÔNG nuốt lỗi
//    như provision.ts (.catch(()=>{})) — kết quả SENT/FAILED trả thẳng về UI.
// Quyền: students:edit (cùng quyền với đường cấp TK per-student hiện có).
// Cách ly cơ sở: User KHÔNG thuộc SCOPED_MODELS → tự lọc theo actor.visibleCenterIds
// (parentCenterWhere — mẫu /admin/centers).

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/auth/check-permission'
import { resolveActor, type Actor } from '@/lib/auth/actor'
import { scopedDb } from '@/lib/db-scope'
import type { ScopedDb } from '@/lib/actions/factory'
import { requestOtp } from '@/lib/otp/service'
import { describeOtpSendError } from '@/lib/otp/messages'
import { sendZaloNotification } from '@/lib/zalo/service'
import { buildAccountZnsParams } from '@/lib/zalo/templates'
import { writeAudit } from '@/lib/audit/audit-log'
import { getAuditActor } from '@/lib/audit/log'

const ZNS_ACCOUNT_TEMPLATE = process.env.ZALO_ZNS_TEMPLATE_ACCOUNT || null

/**
 * User ∉ SCOPED_MODELS (scopedDb pass-through) → cách ly cơ sở TAY theo
 * actor.visibleCenterIds (mẫu /admin/centers). Review 02/08: bản đầu chỉ chặn
 * đúng role CENTER_MANAGER qua session.user.centerId — Sale/role khác fail-open
 * thấy + thao tác TK phụ huynh MỌI cơ sở, và CM thiếu cột legacy centerId cũng
 * lọt. visibleCenterIds đi từ UserOrgRole nên phủ cả hai lỗ.
 */
function parentCenterWhere(actor: Actor): { centerId?: { in: string[] } } {
  return actor.isSuperAdmin || actor.isHoLevel ? {} : { centerId: { in: actor.visibleCenterIds } }
}

async function loadPendingParent(sdb: ScopedDb, userId: string, actor: Actor) {
  const parent = await sdb.user.findFirst({
    where: {
      id: userId,
      role: 'PARENT',
      deletedAt: null,
      ...parentCenterWhere(actor),
    },
    select: { id: true, name: true, phone: true, email: true, accountStatus: true, centerId: true },
  })
  if (!parent) return { parent: null, error: 'Không tìm thấy tài khoản phụ huynh trong phạm vi của bạn' }
  if (parent.accountStatus !== 'PENDING_ACTIVATION') {
    return { parent: null, error: 'Tài khoản đã kích hoạt — không cần thao tác' }
  }
  return { parent, error: null }
}

/** Gửi lại OTP kích hoạt — theo userId (phủ cả TK mồ côi không gắn học viên). */
export async function resendActivationOtpByUser(
  userId: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('students:edit'))) return { ok: false, error: 'Không có quyền' }

  const actor = await resolveActor(session.user.id)
  const sdb = scopedDb(actor)
  const { parent, error } = await loadPendingParent(sdb, userId, actor)
  if (!parent) return { ok: false, error: error ?? 'Không tìm thấy tài khoản' }

  const target = parent.phone ?? parent.email
  if (!target) return { ok: false, error: 'Tài khoản chưa có SĐT lẫn email — cập nhật hồ sơ trước' }

  const res = await requestOtp({ target, purpose: 'ACTIVATION' })
  if (!res.ok) {
    if (res.deliveryFailed) {
      // P6-D — lỗi vĩnh viễn (chưa có Zalo / tắt nhận tin OA / chạm giới hạn)
      // thì "gửi lại" vô ích: nói thẳng + chỉ đường cấp mã tại quầy.
      const advice = describeOtpSendError(res.error)
      return {
        ok: true,
        warning: advice.permanent
          ? `Đã tạo mã nhưng KHÔNG gửi được và gửi lại cũng vô ích: ${advice.message} Dùng "Cấp mã tại quầy" ở trang học viên.`
          : `Đã tạo mã mới nhưng chưa gửi được. ${advice.message}`,
      }
    }
    return { ok: false, error: res.error ?? 'Không gửi được mã (thử lại sau ít phút)' }
  }
  return { ok: true }
}

export type SendZnsResult = {
  ok: boolean
  status?: 'SENT' | 'SKIPPED' | 'FAILED'
  simulated?: boolean
  error?: string
}

async function sendAccountZnsTo(
  sdb: ScopedDb,
  parent: { id: string; name: string | null; phone: string | null },
): Promise<SendZnsResult> {
  if (!parent.phone) return { ok: false, error: 'Tài khoản không có SĐT' }
  const res = await sendZaloNotification({
    toPhone: parent.phone,
    templateKey: ZNS_ACCOUNT_TEMPLATE,
    params: buildAccountZnsParams({ customerName: parent.name, phone: parent.phone }),
    fallbackEmail: null,
  })
  // Không live (ZALO_LIVE!=true) → provider trả SIMULATED-…: log ghi SENT nhưng
  // KHÔNG tin nào rời hệ thống — phải nói rõ cho người vận hành, đừng để tưởng đã gửi.
  const log = await sdb.zaloMessageLog.findUnique({
    where: { id: res.logId },
    select: { providerMessageId: true, errorMessage: true },
  })
  const simulated = Boolean(log?.providerMessageId?.startsWith('SIMULATED-'))
  if (res.status === 'SENT') return { ok: true, status: 'SENT', simulated }
  return {
    ok: false,
    status: res.status,
    error:
      res.status === 'SKIPPED'
        ? 'Zalo chưa cấu hình credential (chỉ có ở Production)'
        : (log?.errorMessage ?? 'Gửi ZNS thất bại'),
  }
}

/** Gửi ZNS "đã cấp tài khoản" cho 1 phụ huynh chờ kích hoạt. */
export async function sendAccountZns(userId: string): Promise<SendZnsResult> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('students:edit'))) return { ok: false, error: 'Không có quyền' }
  if (!ZNS_ACCOUNT_TEMPLATE) {
    return { ok: false, error: 'Chưa cấu hình mẫu ZNS cấp tài khoản (ZALO_ZNS_TEMPLATE_ACCOUNT — chờ mẫu 616899 được duyệt)' }
  }

  const actor = await resolveActor(session.user.id)
  const sdb = scopedDb(actor)
  const { parent, error } = await loadPendingParent(sdb, userId, actor)
  if (!parent) return { ok: false, error: error ?? 'Không tìm thấy tài khoản' }

  const result = await sendAccountZnsTo(sdb, parent)
  revalidatePath('/students/tai-khoan')
  return result
}

/**
 * Gửi ZNS "đã cấp tài khoản" HÀNG LOẠT cho mọi TK chờ kích hoạt CHƯA từng nhận
 * (chưa có ZaloMessageLog SENT với mẫu này). Cap 100/lượt — bấm lại để gửi tiếp.
 */
export async function sendAccountZnsBulk(): Promise<
  | { ok: true; sent: number; failed: number; skipped: number; remaining: number; simulated: boolean }
  | { ok: false; error: string }
> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('students:edit'))) return { ok: false, error: 'Không có quyền' }
  if (!ZNS_ACCOUNT_TEMPLATE) {
    return { ok: false, error: 'Chưa cấu hình mẫu ZNS cấp tài khoản (ZALO_ZNS_TEMPLATE_ACCOUNT — chờ mẫu 616899 được duyệt)' }
  }

  const actor = await resolveActor(session.user.id)
  const sdb = scopedDb(actor)
  const pending = await sdb.user.findMany({
    where: {
      role: 'PARENT',
      accountStatus: 'PENDING_ACTIVATION',
      deletedAt: null,
      phone: { not: null },
      ...parentCenterWhere(actor),
    },
    select: { id: true, name: true, phone: true },
    orderBy: { createdAt: 'asc' },
    take: 300,
  })

  // Đã nhận SENT THẬT với mẫu này rồi → bỏ qua (không spam phụ huynh).
  // ⚠️ LOẠI bản ghi mô phỏng (providerMessageId "SIMULATED-…" khi ZALO_LIVE chưa
  // bật): tin đó chưa từng rời hệ thống — đếm nó là "đã gửi" thì sau khi bật live
  // phụ huynh bị bỏ qua vĩnh viễn (review 02/08).
  const phones = pending.map((p) => p.phone!).filter(Boolean)
  const alreadySent = phones.length
    ? await sdb.zaloMessageLog.findMany({
        where: {
          templateKey: ZNS_ACCOUNT_TEMPLATE,
          status: 'SENT',
          toPhone: { in: phones },
          NOT: { providerMessageId: { startsWith: 'SIMULATED-' } },
        },
        select: { toPhone: true },
      })
    : []
  const sentSet = new Set(alreadySent.map((l) => l.toPhone))

  // Tách 2 con số cho toast (review 02/08): "đã nhận trước đó" ≠ "bị cắt bởi cap
  // 100" — gộp chung làm người vận hành tưởng đã phủ hết, không bấm gửi tiếp.
  const eligible = pending.filter((p) => !sentSet.has(p.phone!))
  const targets = eligible.slice(0, 100)
  const remaining = eligible.length - targets.length
  let sent = 0
  let failed = 0
  let simulated = false
  for (const parent of targets) {
    const r = await sendAccountZnsTo(sdb, parent)
    if (r.ok) {
      sent++
      simulated = simulated || Boolean(r.simulated)
    } else {
      failed++
    }
  }

  const { actorId, actorName } = getAuditActor(session)
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: 'auth',
    entityType: 'User',
    entityId: 'bulk',
    action: 'ZNS_ACCOUNT_BULK_NOTIFY',
    newValues: {
      sent,
      failed,
      skipped: pending.length - eligible.length,
      remaining,
      template: ZNS_ACCOUNT_TEMPLATE,
    },
    orgUnitId: actor.isSuperAdmin || actor.isHoLevel ? null : (actor.visibleCenterIds[0] ?? null),
  }).catch(() => {})

  revalidatePath('/students/tai-khoan')
  return { ok: true, sent, failed, skipped: pending.length - eligible.length, remaining, simulated }
}
