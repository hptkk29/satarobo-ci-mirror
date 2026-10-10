'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { hasRole } from '@/lib/auth/permissions'
import { canViewLeadPii } from '@/lib/auth/check-permission'
import { checkPermission } from '@/lib/auth/check-permission'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { phoneVn } from '@/lib/validators/phone'
import { phoneVariants } from '@/lib/phone'
import { Gender } from '@prisma/client'
import type { LeadChildStatus, Prisma } from '@prisma/client'
import { logLeadAudit, getAuditActor } from '@/lib/audit/log'
import { recordLeadStatusChange } from '@/lib/lead/status-trail-write'
import { recordLeadActivity } from '@/lib/lead/activity-write'
import { SYSTEM_ACTIVITY_META } from '@/lib/lead/activity-clock'
import { QUYEN_DIEU_PHOI_LEAD, duocLamMoiDongHoChamSoc } from '@/lib/lead/sla-clock'
import { resolveActor } from '@/lib/auth/actor'
import { passesScope, scopedDb } from '@/lib/db-scope'
import { getLeadPaymentSummary } from '@/lib/payments/summary'
import { autoAssignLead, reassignOpenLeads } from '@/lib/lead/assign'
import { leadSharingEnabled } from '@/lib/lead/sharing'
import { validateTransferRecipient, validateTransferTarget } from '@/lib/crm/transfer-validate'
import { autoAssignNewLead, manualAssignLead, reassignForCenter } from '@/lib/lead/auto-assign'
import {
  chiaChoLead,
  baoSaleCoLeadMoi,
  baoPoolRong,
  thuHoiChuongLeadCu,
} from '@/lib/lead/assign-lead'
import { assignmentWrite } from '@/lib/lead/assignment'
import { centerIdForOrgUnit } from '@/lib/org/org-service'
import { rejectHeadOffice } from '@/lib/enrollment-flow'
import { normalizeFacebookUrl } from '@/lib/lead/intake/normalize'
import { mergeLeadNote, splitLeadNote } from '@/lib/lead/note-view'
import { loiOKhoa, noiThemGhiChu, oKhoaBiDung } from '@/lib/lead/quyen-sua-lead'
import {
  khoaConDaDoi,
  khoaLeadDaDoi,
  syncLeadCourseFromChildren,
} from '@/lib/lead/khoa-quan-tam-con'
import { ghiTuongTacLead, ghiTuongTacLeadBoQuaLoi } from '@/lib/lead/tuong-tac/ghi'
import {
  NHAN_TRUONG_CON,
  NHAN_TRUONG_LEAD,
  truongDaDoi,
} from '@/lib/lead/tuong-tac/truong-doi'
import {
  LEAD_DROP_STATUSES,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_VALUES,
  canTransitionLeadStatus,
} from '@/lib/leads/status'
import { setLeadStatus } from '@/lib/leads/set-status'
import { leadChildSchema } from '@/lib/validators/lead'
import {
  decideLeadLostFields,
  markChildLostSchema,
  unmarkChildLostSchema,
} from '@/lib/lead/lost-status'
import { syncLeadChildNameToStudents } from '@/lib/students/sync-name'
import { dongBoTuCon, dongBoTuLead } from '@/lib/students/dong-bo-lead-db'
import {
  chiOConLead,
  chiOPhLead,
  conCuaLead,
  phCuaLead,
  type PhLead,
} from '@/lib/students/dong-bo-lead'
import { checkCampaignNameForLead } from '@/lib/ads/campaign-code'
import { laQuanLyNguonBat } from '@/lib/nguon/feature'
import { KHONG_CO_TIN_HIEU_NGUON } from '@/lib/nguon/tin-hieu'
import { chuanBiQuyNguon, ghiQuyNguonLeadMoi } from '@/lib/nguon/noi-day'
import { loadKnownCenterCodes } from '@/lib/ads/center-codes'
import {
  getPriorHistoryByPhone,
  summarizePriorHistory,
} from '@/lib/students/prior-history'

// GĐ0 — tuple lấy từ nguồn duy nhất @/lib/leads/status (trước đây chép tay 15 chuỗi
// ở đây và một bản nữa trong lib/validators/lead.ts, hai bản lệch thứ tự nhau).
const statusSchema = z.enum(LEAD_STATUS_VALUES)

// ─── #11 T1 (câu 10 BGĐ, Kiệt ký spec 10/07) — lead "dùng chung" ────────────
/**
 * Mọi mutator (status/fields/note/loại đơn/task/nhật ký) đòi OWNER (assignee)
 * hoặc actor view-all (QL/Admin). KHÔNG export ('use server': export async =
 * public endpoint). Cũng vá lỗ pre-existing: Sale A gọi action với leadId của
 * Sale B cùng cơ sở.
 *
 * ~~Q2: lead chia sẻ → người khác chỉ XEM + GHI CHÚ (addLeadActivity).~~
 * ~~[ĐẢO — S-6, 27/08/2026] Ngoại lệ "ghi chú" đã gỡ khỏi `addLeadActivity`.~~
 *
 * [ĐẢO LẦN HAI — S-9, 27/08/2026, chốt của chủ dự án] `addLeadActivity` KHÔNG
 * còn đi qua cổng này. Ghi chú được phép; thứ bị chốt là ĐỒNG HỒ CHĂM SÓC —
 * ghi chú của người không phụ trách vẫn lưu nhưng không làm mới mốc SLA
 * (`duocLamMoiDongHoChamSoc`, lib/lead/sla-clock.ts). S-6 đã bịt đúng lỗ nhưng
 * bịt bằng cái chốt to quá: cấm cả việc ghi lại điều khách vừa nói.
 *
 * Cổng này vẫn giữ nguyên cho các mutator CÒN LẠI (status/fields/note/loại
 * đơn/task/hoàn tất việc) — chúng SỬA phiếu chứ không kể lại một cuộc gọi.
 */
async function actorMayMutateLead(
  sessionUserId: string,
  assignedToId: string | null,
): Promise<boolean> {
  if (assignedToId === sessionUserId) return true
  return checkPermission('leads:view-all')
}

const MUTATE_DENIED =
  'Chỉ người phụ trách lead được sửa — lead dùng chung chỉ xem + ghi chú'

/**
 * Q1/Q3: bật/tắt "dùng chung" — chỉ OWNER (assignee) hoặc QL cơ sở (leads:assign).
 * Q4: phạm vi chia sẻ = trong cơ sở (scopedDb cách ly, không nới). Ghi audit.
 */
export async function toggleLeadShareAction(
  leadId: string,
  share: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  // Đợt E (22/08) — chính sách "dùng chung lead" đã TẮT (Q8: lead độc quyền).
  // Chặn ở action, không chỉ ẩn nút: UI cũ còn nằm trong cache trình duyệt và
  // Server Action là một endpoint gọi thẳng được.
  if (!leadSharingEnabled()) {
    return { ok: false, error: 'Tính năng dùng chung lead đã ngừng — mỗi lead do một người phụ trách' }
  }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Không có quyền' }

  const before = await db.lead.findUnique({
    where: { id: leadId },
    select: { assignedToId: true, centerId: true, isSharedWithTeam: true },
  })
  const actor = await resolveActor(session.user.id)
  if (!before || !passesScope('Lead', before, actor)) {
    return { ok: false, error: 'Lead không tồn tại' }
  }

  const isOwner = before.assignedToId === session.user.id
  // QL cơ sở: leads:assign (điều phối lead) — có ở cả v1 matrix lẫn v2 seed (không lệch shadow).
  if (!isOwner && !(await checkPermission('leads:assign', { centerId: before.centerId }))) {
    return { ok: false, error: 'Chỉ người phụ trách hoặc Quản lý cơ sở được bật/tắt dùng chung' }
  }
  if (before.isSharedWithTeam === share) return { ok: true }

  const { actorId, actorName } = getAuditActor(session)
  await db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: {
        isSharedWithTeam: share,
        sharedAt: share ? new Date() : null,
        sharedById: share ? session.user.id : null,
      },
    })
    await logLeadAudit({
      leadId,
      action: 'UPDATE',
      actorId,
      actorName,
      oldValues: { isSharedWithTeam: before.isSharedWithTeam },
      newValues: { isSharedWithTeam: share },
      changedFields: ['isSharedWithTeam'],
      tx,
    })
    await recordLeadActivity({
      tx,
      leadId,
      actorId,
      actorName,
      type: 'NOTE',
      content: share
        ? 'Bật "dùng chung" — CSKH cùng cơ sở xem được lead này'
        : 'Tắt "dùng chung"',
      // S-3 — DÒNG MÁY: bật/tắt cờ chia sẻ là việc nội bộ, không phải một lần gọi
      // phụ huynh. Thiếu dấu này thì cú bật "dùng chung" tự tay đóng mốc "đã liên
      // hệ lần đầu" và tắt cảnh báo SLA-3 hộ người.
      metadata: SYSTEM_ACTIVITY_META,
    })
  })

  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/leads')
  return { ok: true }
}

/**
 * Đổi trạng thái lead bằng TAY (kéo thẻ Kanban / chọn ở bảng).
 *
 * `reason` BẮT BUỘC khi chuyển vào một bậc rơi (`LEAD_DROP_STATUSES`). Ép ở đây chứ
 * không ở `setLeadStatus` vì phần lớn đường vào cửa ghi là MÁY chạy (điểm danh học
 * thử, webhook tiền, nhập tệp) — không có ai để hỏi. Chỉ đường người bấm mới hỏi được,
 * và nếu không hỏi thì `Lead.lostNote` vĩnh viễn NULL: báo cáo biết lead rụng ở bậc
 * nào nhưng không bao giờ biết vì sao, tức là biết một nửa thì không hành động được.
 */
export async function updateLeadStatus(
  leadId: string,
  rawStatus: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chua dang nhap' }
  // 27/08/2026 — gác bằng `leads:change-status`, KHÔNG phải `leads:edit`. Chủ dự án chốt
  // chỉ Sale được đẩy lead trên phễu; Quản lý cơ sở và Marketing vẫn sửa hồ sơ lead bình
  // thường (những đường đó vẫn gác `leads:edit`). Đây là ENDPOINT — ẩn nút ở bảng/Kanban
  // là tiện nghi cho người dùng, không phải hàng rào: POST thẳng vào action vẫn phải chặn.
  if (!(await checkPermission('leads:change-status'))) {
    return { ok: false, error: 'Chỉ Tư vấn viên (Sale) được đổi trạng thái lead' }
  }

  const parsed = statusSchema.safeParse(rawStatus)
  if (!parsed.success) return { ok: false, error: 'Trang thai khong hop le' }

  // Cắt cả khoảng trắng: "   " không phải là một lý do.
  const lyDo = reason?.trim() || null
  if (LEAD_DROP_STATUSES.includes(parsed.data) && (lyDo === null || lyDo.length < 3)) {
    return {
      ok: false,
      error: `Cần ghi lý do khi chuyển sang "${LEAD_STATUS_LABEL[parsed.data]}"`,
    }
  }
  if (lyDo !== null && lyDo.length > 500) {
    return { ok: false, error: 'Lý do quá dài (tối đa 500 ký tự)' }
  }

  const before = await db.lead.findUnique({
    where: { id: leadId },
    select: { status: true, centerId: true, assignedToId: true },
  })
  const actor = await resolveActor(session.user.id)
  if (!before || !passesScope('Lead', before, actor)) {
    return { ok: false, error: 'Lead khong ton tai' }
  }
  if (!(await actorMayMutateLead(session.user.id, before.assignedToId))) {
    return { ok: false, error: MUTATE_DENIED }
  }

  // R7-01 — chỉ cho phép chuyển trạng thái hợp lệ theo pipeline.
  // S3 — đọc khoản Sale ghi nhận THỰC qua getLeadPaymentSummary (cùng reader với card +
  //      guard convert) → AWAITING_DECISION→REGISTERED mở khoá khi đã có Payment(RECORDED).
  //      (Bình thường lead tự lên REGISTERED khi ghi Payment; đây là đường chuyển TAY.)
  const summary = await getLeadPaymentSummary(scopedDb(actor), leadId)
  const hasRecordedPayment = summary.recordedCount > 0
  const transition = canTransitionLeadStatus(before.status, parsed.data, {
    hasRecordedPayment,
  })
  if (!transition.ok) {
    return { ok: false, error: transition.reason }
  }

  const { actorId, actorName } = getAuditActor(session)

  await db.$transaction(async (tx) => {
    // GĐ1 — đi qua cửa chung: ngoài việc đổi cột, nó ghi LeadStatusHistory và dời
    // `statusChangedAt` (mốc mà nhắc việc đọc, thay cho `updatedAt` vốn bị mọi thao
    // tác chạm lead dời đi). `LeadActivity` bên dưới vẫn giữ — đó là dòng thời gian
    // cho người đọc, khác mục đích với sổ trạng thái dùng để tính tỷ lệ chuyển đổi.
    await setLeadStatus({
      tx,
      leadId,
      to: parsed.data,
      source: 'admin',
      actorId,
      actorName,
      reason: lyDo,
    })

    // C-07 — vết đổi trạng thái đi qua ĐÚNG MỘT đường cho mọi lối đổi (tay, tự
    // chia, học thử, thanh toán, chốt ghi danh). Trước đây mỗi chỗ tự ghi một
    // kiểu nên mục "Lịch sử thay đổi" thiếu mốc mà không ai thấy là thiếu.
    await recordLeadStatusChange({
      tx,
      leadId,
      actorId,
      actorName,
      from: before.status,
      to: parsed.data,
      source: 'MANUAL',
    })

    // 🔴 KHÔNG ghi dòng thời gian ở đây nữa. `recordLeadStatusChange` ngay trên đã ghi
    // CẢ HAI sổ (AuditLog + `LeadActivity` type STATUS_CHANGE), và nội dung nó dựng còn
    // đầy đủ hơn bản cũ: nhãn tiếng Việt + nguồn đổi + lý do (`leadStatusTrailContent`).
    // Bản trên `main` giữ nếp cũ "Phase T1.2 tự sinh timeline"; hợp nhất 16/09/2026 thoạt
    // tiên giữ CẢ HAI ⇒ mỗi lượt đổi trạng thái đẻ HAI dòng trong "Lịch sử tương tác".

    // 25/08 — lead MẤT ⇒ đóng sổ học thử của mọi con: `LeadTrialHistory.outcome = "LOST"`.
    //
    // Cột `outcome` có từ FL-R2 với 3 giá trị ENROLLED | LOST | PENDING, nhưng tới trước
    // 25/08 KHÔNG chỗ nào ghi gì ngoài "PENDING" — nên cờ "đã nhập học" ở roster Sale
    // (lib/trial/sale-roster.ts) vĩnh viễn tắt, và bảng Trial của site GV không có cách
    // nào biết suất nào "bị rớt". Nhánh ENROLLED nằm trong transaction convert
    // (lib/crm/convert-lead-v2.ts); đây là nhánh còn lại.
    //
    // Chỉ đụng dòng đang PENDING: con đã nhập học khoá khác rồi thì lead mất không xoá
    // được thành tích đó.
    if (parsed.data === 'DA_MAT' && before.status !== 'DA_MAT') {
      await tx.leadTrialHistory.updateMany({
        where: { leadChild: { leadId }, outcome: 'PENDING' },
        data: { outcome: 'LOST' },
      })
    }

    // 26/08 — GỘP hai hệ Trial: KHÔNG còn đẻ bản ghi `TrialClass` (V1) nữa.
    //
    // Nếp cũ (Phase T1.4) tạo sẵn một lịch học thử "ngày mai cùng giờ" làm chỗ giữ chân.
    // Cái đó nằm ở hệ V1, mà bảng Trial của site giáo viên chỉ đọc V2 — nên lịch giữ chân
    // ấy giáo viên KHÔNG BAO GIỜ thấy, và nó còn đẻ ra một ngày giả trong báo cáo.
    // Nay chỉ ghi việc cần làm vào dòng thời gian; Sale xếp buổi thật ở "Lớp trải nghiệm".
    if (
      parsed.data === 'DA_HEN_HOC_THU' &&
      before.status !== 'DA_HEN_HOC_THU'
    ) {
      await recordLeadActivity({
        tx,
        leadId,
        actorId,
        actorName,
        type: 'NOTE',
        content:
          '[Trải nghiệm] Lead đã hẹn học thử — vào màn "Lớp Trial" xếp con vào buổi cụ thể để giáo viên thấy trên lịch dạy.',
        // S-3 — dòng nhắc việc do MÁY sinh kèm lượt đổi trạng thái, không phải vết
        // của một lần chạm khách.
        metadata: SYSTEM_ACTIVITY_META,
      })
    }
  })

  revalidatePath('/leads')
  revalidatePath(`/leads/${leadId}`)
  // 28/08 — tab "Lịch hẹn học thử" đã gỡ khỏi hệ thống; màn còn lại là danh sách lớp.
  revalidatePath('/lop-trial')
  revalidatePath('/dashboard')
  return { ok: true }
}

// 30/08/2026 — GỠ "Loại đơn dự kiến" (chủ dự án chốt).
// `Lead.orderKind` / `expectedCourseId` / `expectedProductId` chỉ có MỘT nơi ghi (ô
// này) và KHÔNG nơi nào đọc — kể cả màn tạo đơn, nơi nó lẽ ra dùng để gợi ý. Ô này
// bắt người trực lead khai một thứ không đi tới đâu.
// Ba cột vẫn nằm trong DB: không drop cột đang có dữ liệu PROD (luật cứng #4).

// ─── Phase T1.2 — Activity + Task ────────────────────────────────────────────

const activityTypeSchema = z.enum(['CALL', 'MESSAGE', 'NOTE', 'EMAIL'])

export async function addLeadActivity(input: {
  leadId: string
  type: string
  content: string
  // LD4 — metadata JSON tuỳ theo loại (CALL/MESSAGE/EMAIL/NOTE). Optional →
  // backward compatible: caller cũ chỉ truyền { leadId, type, content } vẫn chạy.
  metadata?: Prisma.InputJsonValue | null
  // S-9 — `dongHoKhongDoi` chỉ có mặt khi ghi chú ĐÃ LƯU nhưng mốc SLA không
  // đổi (người ghi không phụ trách phiếu và không có quyền điều phối). Để tầng
  // giao diện nói ra được, thay vì báo "Đã ghi nhận" trơn rồi người ghi tưởng
  // mình vừa xử lý xong phiếu.
}): Promise<{ ok: boolean; error?: string; dongHoKhongDoi?: true }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Không có quyền' }

  const parsedType = activityTypeSchema.safeParse(input.type)
  if (!parsedType.success) return { ok: false, error: 'Loại hoạt động không hợp lệ' }
  const content = input.content?.trim()
  if (!content) return { ok: false, error: 'Vui lòng nhập nội dung' }

  const lead = await db.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, assignedToId: true, centerId: true },
  })
  const actor = await resolveActor(session.user.id)
  if (!lead || !passesScope('Lead', lead, actor)) {
    return { ok: false, error: 'Lead không tồn tại' }
  }
  // S-9 (27/08/2026) — GHI CHÚ KHÔNG BỊ CẤM; thứ bị chốt là ĐỒNG HỒ.
  //
  // Đảo chiều có chủ đích so với S-6 (đợt 1, cùng ngày): lần đó lỗ hổng "đồng
  // nghiệp tắt hộ đồng hồ SLA" được bịt bằng cách chặn luôn hàm này với người
  // không phụ trách. Cách ấy đóng được lỗ nhưng đóng cả một việc hợp lệ —
  // người trực máy, người nghe hộ cuộc gọi nhỡ, Sale Hội sở vừa nhập phiếu.
  //
  // Cái nguy hiểm không phải dòng chữ họ ghi, mà là hai cú ghi phụ đi kèm trong
  // `recordLeadActivity`: bump `Lead.lastActivityAt` (tắt SLA-4 + cột "số ngày
  // chưa tiếp cận lại") và đóng `Lead.firstContactAt` (tắt SLA-3 VĨNH VIỄN —
  // mốc chỉ ghi một lần, không có đường undo). Nên nay tách hẳn hai thứ.
  //
  // Quyết định nằm ở `duocLamMoiDongHoChamSoc`, KHÔNG gõ điều kiện tại chỗ; và
  // "cấp quản lý" hỏi `leads:assign` (điều phối lead) chứ không phải
  // `leads:view-all` — quyền đọc đó đang cấp cho cả Marketing.
  const lamMoiDongHo = duocLamMoiDongHoChamSoc({
    userId: session.user.id,
    assignedToId: lead.assignedToId,
    coQuyenDieuPhoi: await checkPermission(QUYEN_DIEU_PHOI_LEAD, { centerId: lead.centerId }),
  })

  const { actorId, actorName } = getAuditActor(session)
  // AC4 — ghi hoạt động + reset đồng hồ SLA idle (lastActivityAt) trong 1 tx.
  // N-4 — cú bump nay nằm TRONG `recordLeadActivity` chứ không viết tay ở đây:
  // đây từng là 1 trong 3 chỗ duy nhất nhớ bump, và chính sự "nhớ bằng tay" đó
  // là lý do 10 chỗ còn lại quên.
  await db.$transaction(async (tx) => {
    await recordLeadActivity({
      tx,
      leadId: input.leadId,
      actorId,
      actorName,
      type: parsedType.data,
      content,
      metadata: input.metadata ?? null,
      lamMoiDongHo,
    })
  })

  revalidatePath(`/leads/${input.leadId}`)
  return lamMoiDongHo ? { ok: true } : { ok: true, dongHoKhongDoi: true }
}

export async function addLeadTask(input: {
  leadId: string
  title: string
  description?: string
  dueAt: string
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Không có quyền' }

  const title = input.title?.trim()
  if (!title) return { ok: false, error: 'Vui lòng nhập tiêu đề việc' }
  const due = new Date(input.dueAt)
  if (Number.isNaN(due.getTime())) return { ok: false, error: 'Hạn không hợp lệ' }

  const lead = await db.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, assignedToId: true, centerId: true },
  })
  const actor = await resolveActor(session.user.id)
  if (!lead || !passesScope('Lead', lead, actor)) {
    return { ok: false, error: 'Lead không tồn tại' }
  }
  if (!(await actorMayMutateLead(session.user.id, lead.assignedToId))) {
    return { ok: false, error: MUTATE_DENIED }
  }

  const { actorId, actorName } = getAuditActor(session)
  // AC4 — tạo việc cũng là hoạt động → reset đồng hồ SLA idle trong 1 tx.
  await db.$transaction(async (tx) => {
    await tx.leadTask.create({
      data: {
        leadId: input.leadId,
        // Giao cho sale phụ trách lead nếu có, mặc định người tạo.
        assignedToId: lead.assignedToId ?? actorId,
        assignedToName: actorName,
        title,
        description: input.description?.trim() || null,
        dueAt: due,
      },
    })
    // 18/09 — dòng lịch sử tương tác. Trong CÙNG tx vì đây là dữ liệu của chính lead,
    // không chạm tiền: lịch sử lệch với việc vừa tạo thì tệ hơn là cuộn lại cả hai.
    // `ghiTuongTacLead` tự đẩy `lastActivityAt` nên không cần `lead.update` riêng nữa.
    await ghiTuongTacLead(tx, {
      leadId: input.leadId,
      actorId,
      actorName,
      moc: new Date(),
      sk: { viec: 'viec.tao', tieuDe: title, hanChot: due },
    })
  })

  revalidatePath(`/leads/${input.leadId}`)
  revalidatePath('/dashboard')
  return { ok: true }
}

export async function completeLeadTask(
  taskId: string,
  done = true,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Không có quyền' }

  const task = await db.leadTask.findUnique({
    where: { id: taskId },
    // `title` cho dòng lịch sử ("Hoàn thành việc \"…\"") — không có nó thì câu chỉ còn
    // "Hoàn thành việc" và người đọc không biết việc nào.
    select: { leadId: true, title: true, lead: { select: { centerId: true, assignedToId: true } } },
  })
  const actor = await resolveActor(session.user.id)
  if (!task || !passesScope('Lead', { centerId: task.lead?.centerId ?? null }, actor)) {
    return { ok: false, error: 'Việc không tồn tại' }
  }
  if (!(await actorMayMutateLead(session.user.id, task.lead?.assignedToId ?? null))) {
    return { ok: false, error: MUTATE_DENIED }
  }

  const { actorId, actorName } = getAuditActor(session)
  await db.$transaction(async (tx) => {
    await tx.leadTask.update({
      where: { id: taskId },
      data: done
        ? { status: 'DONE', completedAt: new Date() }
        : { status: 'OPEN', completedAt: null },
    })
    // AC4 — hoàn tất việc là hoạt động → reset đồng hồ SLA idle (nay `ghiTuongTacLead`
    // đẩy hộ). Chỉ ghi lịch sử khi ĐÁNH XONG: bỏ tick là sửa lại một lượt ghi nhầm, ghi
    // nó vào lịch sử chỉ làm dày dòng mà không thêm thông tin nào.
    if (done) {
      await ghiTuongTacLead(tx, {
        leadId: task.leadId,
        actorId,
        actorName,
        moc: new Date(),
        sk: { viec: 'viec.xong', tieuDe: task.title },
      })
    } else {
      await tx.lead.update({ where: { id: task.leadId }, data: { lastActivityAt: new Date() } })
    }
  })

  revalidatePath(`/leads/${task.leadId}`)
  revalidatePath('/dashboard')
  return { ok: true }
}

export async function updateLeadNote(
  leadId: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chua dang nhap' }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Khong co quyen' }

  const before = await db.lead.findUnique({
    where: { id: leadId },
    select: { note: true, centerId: true, assignedToId: true },
  })
  const actor = await resolveActor(session.user.id)
  if (!before || !passesScope('Lead', before, actor)) {
    return { ok: false, error: 'Lead khong ton tai' }
  }
  if (!(await actorMayMutateLead(session.user.id, before.assignedToId))) {
    return { ok: false, error: MUTATE_DENIED }
  }

  // 24/08 — ô ghi chú trên UI chỉ chứa phần NGƯỜI GÕ (dòng máy ghi đã bị bốc ra
  // khi hiển thị). Ghi thẳng chuỗi đó xuống là xoá mất dấu vết người nhập + cảnh
  // báo chia lead của phiếu cũ, nên phải ráp lại từ bản đang lưu.
  //
  // 17/09 — ai KHÔNG có `leads:overwrite` thì ghi chú chỉ được NỐI THÊM: chủ dự án chốt
  // "sửa ghi chú thì ghi bổ sung ở phía sau". Ô nhập nạp sẵn ghi chú cũ rồi gửi lại cả
  // chuỗi, nên bôi đen xoá một đoạn của đồng nghiệp rồi bấm Lưu là mất vĩnh viễn mà không
  // màn hình nào cảnh báo — nối ở SERVER là cách duy nhất chắc chắn.
  const duocDe = await checkPermission('leads:overwrite')
  const nguoiGoCu = splitLeadNote(before.note).human
  const phanNguoi = duocDe ? note : (noiThemGhiChu(nguoiGoCu, note) ?? nguoiGoCu)
  const newNote = mergeLeadNote(phanNguoi, before.note)
  const { actorId, actorName } = getAuditActor(session)

  await db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      // ⚠️ `lastActivityAt` PHẢI nhảy theo. Chốt 16/09/2026 của chủ dự án: "lần gần nhất
      // tương tác lead tính cả ghi chú lead luôn".
      //
      // Trước bản vá: Sale mở lead ra gõ ghi chú rồi lưu ⇒ chỉ cột `note` đổi, không dòng
      // hoạt động nào sinh ra, `lastActivityAt` đứng im. Hệ quả đo được ở hai chỗ:
      //   · `/lead-nguoi` chấm lead đó là "chưa ai chăm" dù vừa có người ghi chú xong, và
      //     màn đó có nút PHÂN BỔ HÀNG LOẠT — tức giật lead khỏi tay người đang làm;
      //   · `isLeadIdle` (`lib/crm/sla.ts`) cũng đọc đúng cột này nên cảnh báo SLA nổ nhầm.
      // Chỉ nhảy khi ghi chú THỰC SỰ đổi — lưu lại y nguyên không phải một lần chăm.
      data: newNote !== before.note ? { note: newNote, lastActivityAt: new Date() } : { note: newNote },
    })

    await logLeadAudit({
      leadId,
      action: 'UPDATE',
      actorId,
      actorName,
      oldValues: { note: before.note },
      newValues: { note: newNote },
      changedFields: before.note !== newNote ? ['note'] : [],
      tx,
    })
  })

  revalidatePath('/leads')
  revalidatePath('/dashboard')
  return { ok: true }
}

export async function deleteLead(
  leadId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chua dang nhap' }
  if (!(await checkPermission('leads:delete'))) {
    return { ok: false, error: 'Khong co quyen xoa lead' }
  }

  const before = await db.lead.findUnique({
    where: { id: leadId, deletedAt: null },
    select: { parentName: true, phone: true, status: true, centerId: true, assignedToId: true },
  })
  const actor = await resolveActor(session.user.id)
  if (!before || !passesScope('Lead', before, actor)) {
    return { ok: false, error: 'Lead khong ton tai hoac da bi xoa' }
  }

  const { actorId, actorName } = getAuditActor(session)

  try {
    await db.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: leadId, deletedAt: null },
        data: { deletedAt: new Date() },
      })

      // 25/08 — đóng luôn sổ học thử, cùng luật với nhánh LOST của updateLeadStatus.
      // Xoá mềm lead mà bỏ sổ lại ở "PENDING" thì bảng Trial của site GV còn in suất đó
      // là "Chờ đánh giá" mãi mãi — tệ hơn ca chuyển LOST, vì lead đã biến khỏi /admin/leads
      // nên không ai còn đường đi tới mà đóng lại. Chỉ đụng dòng còn PENDING: bé đã nhập
      // học ở lớp khác thì thành tích đó không bị xoá theo.
      await tx.leadTrialHistory.updateMany({
        where: { leadChild: { leadId }, outcome: 'PENDING' },
        data: { outcome: 'LOST' },
      })

      await logLeadAudit({
        leadId,
        action: 'DELETE',
        actorId,
        actorName,
        oldValues: before,
        tx,
      })
    })
  } catch {
    return { ok: false, error: 'Lead khong ton tai hoac da bi xoa' }
  }

  // 15/09/2026 — THU HỒI chuông "Bạn có lead mới" của người đang giữ lead.
  //
  // Sự cố có thật: một tư vấn viên báo nhận được thông báo lead mới nhưng mở ra không thấy
  // lead nào, và tra dữ liệu thì lead ĐÃ KHÔNG CÒN. Chuông vẫn nằm đó vì đường xoá mềm này
  // chưa từng gọi thu hồi — `deletedAt` che lead khỏi mọi truy vấn, nhưng `StaffNotification`
  // là bảng riêng, không ai dọn hộ.
  //
  // Triệu chứng dễ chẩn nhầm thành "chuông của người khác nhảy sang": người đó nhận ĐÚNG
  // chuông của mình, vào lúc họ còn giữ lead. Đường đọc chuông lọc `userId` nên không có rò
  // chéo — thiếu là ở nửa THU HỒI.
  //
  // Đặt NGOÀI transaction và nuốt lỗi (`thuHoiChuongLeadCu` tự lo): thu hồi hỏng thì lead vẫn
  // phải xoá được. `chuMoiId: null` = không ai tiếp quản.
  await thuHoiChuongLeadCu({ chuCuId: before.assignedToId, chuMoiId: null, leadId })

  revalidatePath('/leads')
  revalidatePath('/dashboard')
  return { ok: true }
}

// ─── Phase T1.3 — Auto-assign actions ────────────────────────────────────────

export async function autoAssignLeadAction(
  leadId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:assign'))) return { ok: false, error: 'Không có quyền' }

  const { actorId, actorName } = getAuditActor(session)
  const res = await autoAssignLead(leadId, { actorId, actorName })
  if (!res.ok) return { ok: false, error: res.error }

  revalidatePath('/leads')
  revalidatePath(`/leads/${leadId}`)
  return { ok: true }
}

export async function reassignLeadsFromAction(
  userId: string,
): Promise<{ ok: boolean; reassigned?: number; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:assign'))) return { ok: false, error: 'Không có quyền' }

  const { actorId, actorName } = getAuditActor(session)
  const res = await reassignOpenLeads(userId, { actorId, actorName })
  if (!res.ok) return { ok: false, error: res.error }

  revalidatePath('/leads')
  revalidatePath('/dashboard')
  return { ok: true, reassigned: res.reassigned }
}

// ─── Module CRM & Lead PHẦN 1 — CRUD lead thủ công ───────────────────────────

const manualLeadSchema = z.object({
  parentName: z.string().trim().min(2, 'Tên phụ huynh tối thiểu 2 ký tự').max(100),
  phone: phoneVn,
  email: z.string().trim().email('Email không hợp lệ').optional().or(z.literal('')),
  childName: z.string().trim().max(100).optional().or(z.literal('')),
  childAge: z.coerce.number().int().min(3).max(18).optional().nullable(),
  centerId: z.string().trim().optional().or(z.literal('')),
  orgUnitId: z.string().trim().optional().or(z.literal('')), // PR-C: đơn vị (OrgUnit) — nguồn chính; centerId suy ra (HO→null)
  courseId: z.string().trim().optional().or(z.literal('')),
  source: z.string().trim().min(1).max(100).optional().or(z.literal('')),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
  // Ô "Link Facebook" của biểu mẫu nhập khách (23/08). Đi qua CÙNG bộ chuẩn hoá
  // với đường nhập — nếu không, cùng một người gõ "minh.nguyen.549" ở hai màn sẽ
  // ra hai giá trị khác nhau, và đối khớp lead theo link Facebook sẽ trượt.
  //
  // ⚠️ Chuẩn hoá ở đây KHÔNG phải cho đẹp: nó chặn `javascript:`/`data:` — giá
  // trị này được render thành `<a href>` trong màn admin (xem normalize.ts).
  // Chuỗi không phải link thì thành '' chứ không ném lỗi: người sửa đang gõ dở
  // không đáng bị chặn cả phiếu, và cảnh báo đã có ở đường nhập.
  facebookUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? (normalizeFacebookUrl(v).url ?? '') : v)),

  // ─── G-01 (26/08/2026) — 5 ô còn thiếu ở CẤP PHỤ HUYNH ───────────────────
  //
  // ⚠️ Cả 5 phải giữ được `undefined` khi người gọi KHÔNG gửi khoá, vì
  // `updateLeadFields` phân biệt "không đụng" (bỏ qua) với "xoá trắng" (ghi
  // null) đúng bằng phép `!== undefined`. Đó là lý do KHÔNG dùng
  // `.transform(v => v ?? null)` ở đây: transform chạy cả khi khoá vắng mặt và
  // biến `undefined` thành `null`, tức mọi lượt sửa một ô sẽ ĐÈ TRẮNG bốn ô kia.
  parentGender: z.nativeEnum(Gender).optional().or(z.literal('')),
  // Ngày sinh: nhận chuỗi 'yyyy-mm-dd' từ ô <input type="date">. Chặn tương lai —
  // ngày sinh ở mai sau chỉ có thể là gõ nhầm, và nó lặng lẽ làm hỏng mọi phép
  // tính tuổi về sau. `.refine` (không phải `.max(new Date())`) để mốc "bây giờ"
  // tính lúc PHÂN TÍCH chứ không phải lúc nạp module.
  parentDob: z
    .union([z.literal(''), z.coerce.date()])
    .optional()
    .refine((v) => !(v instanceof Date) || v <= new Date(), {
      message: 'Ngày sinh phụ huynh không được ở tương lai',
    }),
  // Địa chỉ 3 ô — lưu TÊN, danh mục 2 cấp 2025 (xem lib/address/vn-address.ts).
  city: z.string().trim().max(100).optional().or(z.literal('')),
  ward: z.string().trim().max(100).optional().or(z.literal('')),
  addressLine: z.string().trim().max(255).optional().or(z.literal('')),

  // ─── G-06 (26/08/2026) — mã campaign + ngày hẹn kế tiếp, cấp PHỤ HUYNH ────
  //
  // Cùng luật `undefined` với khối G-01 ngay trên: khoá VẮNG MẶT = "không đụng",
  // chuỗi RỖNG = "xoá trắng về null". Đừng thêm `.transform(v => v ?? null)`.
  //
  // `campaignName` KHÔNG kiểm khuôn ở đây: khuôn SR.QD.232 cần danh mục mã cơ sở
  // (đọc DB), mà zod schema phải giữ THUẦN. Kiểm bằng `checkCampaignNameForLead`
  // trong chính Server Action — cùng một hàm khuôn của D-06, không có bản thứ hai.
  campaignName: z.string().trim().max(255).optional().or(z.literal('')),
  campaignId: z.string().trim().max(64).optional().or(z.literal('')),
  adsetId: z.string().trim().max(64).optional().or(z.literal('')),
  adId: z.string().trim().max(64).optional().or(z.literal('')),
  // Ngày hẹn liên hệ lại. Cố ý KHÔNG chặn ngày quá khứ: Sale mở phiếu cũ ra sửa ô
  // khác vẫn phải lưu được, và một cái hẹn đã lỡ chính là thứ C-05 cần nhìn thấy.
  nextFollowUpAt: z.union([z.literal(''), z.coerce.date()]).optional(),
})

/**
 * G-06 — kiểm ô "mã campaign" của phiếu bằng CHÍNH khuôn của D-06.
 *
 * Danh mục mã cơ sở đọc từ DB (`Center.code`) và CHỈ đọc khi người dùng thực sự gõ gì
 * đó — mở cơ sở mới là thêm dữ liệu, không sửa mã, nên không được chôn danh sách vào
 * đây. Không gõ gì ⇒ `null`, không tốn câu truy vấn nào.
 */
async function checkLeadCampaignName(
  raw: string | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false; message: string }> {
  if (!raw || !raw.trim()) return { ok: true, value: null }
  const codes = await loadKnownCenterCodes()
  return checkCampaignNameForLead(raw, codes)
}

/** Tạo 1 lead thủ công (thu ở sự kiện/trung tâm). Chống trùng theo SĐT. */
export async function createLeadManual(
  input: unknown,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:create'))) return { ok: false, error: 'Không có quyền' }

  const parsed = manualLeadSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' }
  }
  const d = parsed.data

  // P2-2: trùng SĐT → báo lỗi RÕ (không fail thầm lặng). Kèm trạng thái + người
  // phụ trách nếu nhân viên có quyền xem (view-all hoặc cùng cơ sở).
  const dup = await db.lead.findFirst({
    // Đợt G — tra theo BIẾN THỂ SĐT. DB chứa song song `0…` (cũ) và `84…`
    // (canonical); so đúng-bằng nên nhập `84905…` khi đã có `0905…` là đẻ hồ sơ
    // thứ hai — và từ Đợt D mỗi hồ sơ thừa còn tiêu một lượt sai trong sổ.
    // `lib/lead/dedup.ts` đã làm đúng từ lâu; hai màn tay này bị bỏ quên.
    where: { phone: { in: phoneVariants(d.phone) }, deletedAt: null },
    select: {
      id: true,
      status: true,
      centerId: true,
      assignedTo: { select: { name: true } },
    },
  })
  if (dup) {
    // #11 T2 — chi tiết trùng (trạng thái + tên sale phụ trách) là dữ liệu tư vấn/PII:
    // chỉ lộ khi VỪA trong scope (view-all theo cơ sở HOẶC cùng cơ sở) VỪA có quyền
    // leads:view-pii. Non-holder (vd MARKETING) chỉ nhận thông báo chung, không chi tiết.
    const canSeeDetail =
      (await canViewLeadPii()) &&
      ((await checkPermission('leads:view-all', { centerId: dup.centerId })) ||
        (!!dup.centerId && dup.centerId === session.user.centerId))
    if (canSeeDetail) {
      const who = dup.assignedTo?.name ? `, phụ trách: ${dup.assignedTo.name}` : ''
      return {
        ok: false,
        error: `SĐT đã tồn tại trong CRM (trạng thái: ${LEAD_STATUS_LABEL[dup.status] ?? dup.status}${who}). Mở lead hiện có thay vì tạo mới.`,
      }
    }
    // 21/08 — hồ sơ cũ nằm ở CƠ SỞ KHÁC: `Lead` ∈ SCOPED_MODELS nên sale ở đây không mở
    // được nó, và câu báo cụt "báo quản lý cơ sở kiểm tra" khiến họ đứng hình. Nói thêm
    // MỘT tầng không-PII: khách đã từng đăng ký / học ở cơ sở nào, khi nào. Không lộ tên
    // phụ huynh, ghi chú tư vấn hay sale phụ trách — muốn xem vẫn phải qua đúng cơ sở.
    const actorForLookup = await resolveActor(session.user.id!)
    const prior = await getPriorHistoryByPhone(actorForLookup, d.phone)
    const summary = summarizePriorHistory(prior)
    return {
      ok: false,
      error:
        'SĐT đã tồn tại trong CRM. Vui lòng báo quản lý cơ sở kiểm tra.' +
        (summary ? ` ${summary}` : ''),
    }
  }

  const { actorId, actorName } = getAuditActor(session)

  // PR-C: orgUnitId là nguồn chính; centerId suy ra (HO→null) để dual-write/scopedDb cũ.
  const orgUnitId = d.orgUnitId || null
  const centerId = await centerIdForOrgUnit(orgUnitId)

  // Hội sở không nhận lead — chặn ngay lúc nhập, không để tới lúc chốt mới báo.
  const hoErr = await rejectHeadOffice('lead', { orgUnitId, centerId })
  if (hoErr) return { ok: false, error: hoErr }

  // G-06 — mã campaign đi qua ĐÚNG khuôn SR.QD.232 của D-06, không có luật thứ hai.
  const campaignCheck = await checkLeadCampaignName(d.campaignName)
  if (!campaignCheck.ok) return { ok: false, error: campaignCheck.message }
  const campaignName = campaignCheck.value

  // ── QUY NGUỒN (PR2) — TRƯỚC transaction, tra bằng `db` không scope (T11). Cờ master TẮT ⇒ `{ bat: false }`.
  // Action này KHÔNG có giao diện tạo (`/leads/new` chuyển hướng) nhưng vẫn export và gọi được ⇒ là một đường ghi SỐNG,
  // phải nối (03 §5.1 C). Nhãn mặc định 'Nhập tay' (#22) sau 06/10 ⇒ MANUAL_REVIEW, KHÔNG UNKNOWN (H21).
  const nhanNguon = d.source || 'Nhập tay'
  const [nguon] = await chuanBiQuyNguon(db, [
    {
      bayGio: new Date(),
      duongVao: 'nhap-tay',
      conversionEntry: nhanNguon,
      nhanKhai: nhanNguon,
      laNhapExcel: false,
      sdtKhach: d.phone,
      maNvNguoiNhap: null,
      nguoiNhapUserId: session.user.id ?? null,
      nhanSuGioiThieuEmployeeId: null,
      phuHuynhGioiThieu: null,
      ref: null,
      refSau: [],
      quangCao: {
        ...KHONG_CO_TIN_HIEU_NGUON.quangCao,
        campaignName,
        campaignId: d.campaignId || null,
        adsetId: d.adsetId || null,
        adId: d.adId || null,
      },
      utm: KHONG_CO_TIN_HIEU_NGUON.utm,
      pageId: null,
      orgUnitId,
      centerId,
    },
  ])
  // Cơ sở đã ÉP CHỌN nguồn mà người nhập gõ nhãn lạ ⇒ chặn TRƯỚC transaction (đường NGƯỜI NHẬP, T4).
  if (nguon!.bat && nguon!.chanNhap) return { ok: false, error: nguon!.chanNhap }

  const lead = await db.$transaction(async (tx) => {
    const created = await tx.lead.create({
    data: {
      parentName: d.parentName,
      phone: d.phone,
      email: d.email || null,
      childName: d.childName || null,
      childAge: d.childAge ?? null,
      centerId,
      orgUnitId,
      // 15/09/2026 — BẮT BUỘC. Danh sách /leads sắp theo `lastInboundAt` với
      // `nulls: 'last'`, nên lead tạo mà bỏ trống cột này bị đẩy xuống CUỐI mọi trang —
      // người dùng báo "nhập xong không thấy lead đâu", nhưng tìm theo SĐT/nguồn thì
      // lại ra (tập kết quả nhỏ nên nó lọt trang 1).
      // Quy ước: lúc tạo, `lastInboundAt` = `createdAt`; `laNhapLai()` chỉ đúng khi nó
      // LỚN HƠN `createdAt`. Xem `lib/tables/lead-columns.ts`.
      lastInboundAt: new Date(),
      courseId: d.courseId || null,
      source: d.source || 'Nhập tay',
      note: d.note || null,
      // 25/08 — nửa còn thiếu của bản vá 23/08 ("thêm cho cả hai đường"): đường
      // SỬA đã ghi được ô này, đường TẠO thì chưa. Schema nhận + chuẩn hoá rồi
      // BỎ, nên người gọi gửi link lên vẫn nhận `{ ok: true }` còn giá trị thì
      // bốc hơi — không lỗi, không nhật ký. Với lead Messenger-first (chưa có
      // SĐT) đây là thứ duy nhất nối lead ↔ hội thoại, mất là không dựng lại được.
      facebookUrl: d.facebookUrl || null,
      // G-01 — 5 ô mới. `|| null` chứ không `?? null`: chuỗi rỗng (người dùng mở
      // ô ra rồi bỏ trống) phải thành NULL, không thành ''. Chuỗi rỗng làm hỏng
      // mọi phép `if (lead.city)` và mọi truy vấn `city: { not: null }` — trong
      // đó có đúng câu dùng để đo "địa chỉ đã ra khỏi `note` chưa".
      parentGender: d.parentGender || null,
      parentDob: d.parentDob || null,
      city: d.city || null,
      ward: d.ward || null,
      addressLine: d.addressLine || null,
      // G-06 — mã campaign (đã kiểm khuôn SR.QD.232 ở trên) + ngày hẹn kế tiếp.
      campaignName,
      campaignId: d.campaignId || null,
      adsetId: d.adsetId || null,
      adId: d.adId || null,
      nextFollowUpAt: d.nextFollowUpAt || null,
      // 'MOI' chứ không phải 'NEW': GĐ5 rút enum LeadStatus còn 10 giá trị tiếng Việt.
      status: 'MOI',
      // NGƯỜI NHẬP (23/08) — cùng nghĩa với biểu mẫu /nhap-khach-hang. Đường
      // nhập tay này cũng phải ghi, không thì "phiếu tôi nhập" thủng một nửa.
      createdById: session.user.id,
      activities: {
        create: {
          actorId,
          actorName,
          type: 'NOTE',
          content: 'Tạo lead thủ công',
          // S-3 — cùng MỘT dấu với mọi dòng máy khác. Đường này ghi lồng trong
          // `lead.create` nên không qua `recordLeadActivity` được; dấu thì vẫn phải
          // đúng, không thì lead vừa tạo đã mang mốc "đã liên hệ lần đầu".
          metadata: SYSTEM_ACTIVITY_META,
        },
      },
    },
    select: { id: true },
    })
    // Lead và nguồn của nó CÙNG một transaction (T5).
    await ghiQuyNguonLeadMoi(tx, created.id, nguon!, session.user.id ?? null)
    return created
  })

  // P2-1: ghi nhật ký kiểm toán tạo lead.
  await logLeadAudit({
    leadId: lead.id,
    action: 'CREATE',
    actorId,
    actorName,
    newValues: {
      parentName: d.parentName,
      phone: d.phone,
      childName: d.childName ?? null,
      centerId,
      orgUnitId,
      source: d.source || 'Nhập tay',
      // Đường SỬA đã ghi ô này vào nhật ký; đường TẠO bỏ trống thì lịch sử một
      // lead có link Facebook bắt đầu bằng khoảng trắng — không truy được ai điền.
      facebookUrl: d.facebookUrl || null,
      // G-01 — địa chỉ vào nhật ký (dữ liệu địa bàn, không phải PII). Ngày sinh và
      // giới tính PH thì KHÔNG: `parentDob` là PII, và nhật ký kiểm toán được đọc
      // ở màn lịch sử với một cổng quyền khác cổng `leads:view-pii` — chép giá trị
      // thô vào đây là mở một cửa sau cho đúng thứ tầng che đang giấu.
      city: d.city || null,
      ward: d.ward || null,
      addressLine: d.addressLine || null,
    },
  }).catch(() => {})

  // Auto-chia theo cơ sở → chế độ cơ sở (PHẦN 2).
  await autoAssignNewLead(lead.id, { actorId, actorName }).catch(() => {})

  revalidatePath('/leads')
  return { ok: true, id: lead.id }
}

const updateLeadFieldsSchema = manualLeadSchema.partial()

/**
 * Bộ ô người NHẬP phiếu được sửa — đúng bằng biểu mẫu `/nhap-khach-hang`
 * (chủ dự án chốt 23/08/2026: "chỉ được sửa các trường có ở form nhap-khach-hang,
 * còn các trường khác thì không được sửa, Sale cs được toàn quyền sửa").
 *
 * Danh sách này là ALLOWLIST, không phải blocklist: thêm ô mới vào biểu mẫu mà
 * quên khai ở đây thì người nhập KHÔNG sửa được ô đó — hỏng theo chiều an toàn.
 * Ngược lại (blocklist) thì mỗi cột mới của `Lead` tự động mở toang.
 *
 * `email` / `childAge` / `courseId` KHÔNG có trong biểu mẫu ⇒ không nằm đây.
 */
const INTAKE_EDITABLE_FIELDS = [
  'parentName',
  'phone',
  'childName',
  'source',
  'note',
  'orgUnitId', // ô "Cơ sở phụ huynh chọn" (centerId suy ra từ đây)
  'facebookUrl',
] as const

const INTAKE_FIELD_DENIED =
  'Bạn chỉ sửa được các ô có trong biểu mẫu nhập khách hàng của phiếu do mình nhập.'

/** Sửa thông tin cơ bản của 1 lead. */
export async function updateLeadFields(
  leadId: string,
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  // Hai đường vào, KHÔNG cùng quyền hạn:
  //   · `leads:edit` — Sale cơ sở / quản lý: toàn quyền, y như trước.
  //   · `leads:edit-own-intake` — người NHẬP phiếu (Sale Hội sở): chỉ bộ ô của
  //     biểu mẫu, và chỉ trên phiếu mình nhập.
  //
  // ⚠️ Đường thứ hai CỐ Ý không kiểm ở đây mà kiểm sau khi đọc lead: nó mang
  // scope OWN, mà OWN gọi TRẦN (không kèm `createdById`) thì luôn false — kiểm
  // sớm là chặn nhầm đúng người được phép. Bất biến R1 (lib/auth/rbac-scope.test.ts)
  // quét call-site để bắt lại đúng lỗi này.
  const canEditAll = await checkPermission('leads:edit')

  const parsed = updateLeadFieldsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' }
  }
  const d = parsed.data

  const before = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      parentName: true,
      phone: true,
      email: true,
      childName: true,
      childAge: true,
      centerId: true,
      orgUnitId: true,
      courseId: true,
      source: true,
      note: true,
      facebookUrl: true,
      // G-01 — 5 ô mới PHẢI có mặt ở `select` hẹp này. Thiếu một ô thì phép
      // so-lệch bên dưới thấy `undefined !== <giá trị mới>` ở MỌI lượt lưu, tức
      // nhật ký kiểm toán đẻ ra một dòng "đã đổi địa chỉ" cho cả những lần không
      // ai đụng vào ô đó — và một nhật ký hay bịa thì không làm chứng được nữa.
      parentGender: true,
      parentDob: true,
      city: true,
      ward: true,
      addressLine: true,
      // G-06 — 5 ô mới, cùng lý do với khối G-01 ngay trên: thiếu ở `select` hẹp
      // này thì phép so-lệch thấy `undefined !== <giá trị>` ở MỌI lượt lưu và nhật
      // ký kiểm toán bịa ra một dòng "đã đổi mã campaign" cho cả lần không ai đụng.
      campaignName: true,
      campaignId: true,
      adsetId: true,
      adId: true,
      nextFollowUpAt: true,
      assignedToId: true,
      createdById: true,
    },
  })
  // Cách ly cơ sở (chống IDOR ghi): Lead phải thuộc tầm nhìn cơ sở actor —
  // đồng bộ với updateLeadStatus/updateLeadNote/deleteLead.
  const actor = await resolveActor(session.user.id)
  if (!before || !passesScope('Lead', before, actor)) {
    return { ok: false, error: 'Lead không tồn tại' }
  }
  // PR2 / SRC-21a — cờ `nguon.enabled` BẬT ⇒ `Lead.source` chỉ còn là ĐƯỜNG VÀO (T1, D6): nguồn nghiệp vụ nằm ở
  // attribution và chỉ đổi qua `doiNguonLeadAction` (lý do ≥ 10 ký tự, audit, chặn gian lận). Biểu mẫu gửi cả phiếu nên
  // `source` luôn có mặt dù không ai sờ tới: chỉ TỪ CHỐI khi giá trị THỰC SỰ khác, còn bằng nhau thì lặng lẽ bỏ qua.
  // Từ chối thay vì bỏ qua im lặng: nhận `{ ok: true }` mà giá trị không đổi là lời hứa suông (luật 12).
  const nguonBat = await laQuanLyNguonBat()
  if (nguonBat && d.source !== undefined && (d.source || null) !== (before.source || null)) {
    return {
      ok: false,
      error: 'Nguồn lead không sửa trực tiếp ở biểu mẫu này — dùng chức năng "Đổi nguồn" (có lý do và nhật ký).',
    }
  }
  const duocDe = await checkPermission('leads:overwrite')
  if (canEditAll) {
    if (!(await actorMayMutateLead(session.user.id, before.assignedToId))) {
      return { ok: false, error: MUTATE_DENIED }
    }
    // 17/09/2026 — BA Ô KHOÁ (SĐT · đơn vị · nguồn) cần thêm `leads:overwrite`.
    //
    // Chủ dự án: "nguồn lead mặc định là nguồn đầu tiên khi vào hệ thống […] chỉ quản lý
    // cơ sở hoặc admin mới có quyền đè […] các trường khác: sđt, đơn vị, nguồn, không
    // được sửa nhé". Sale vẫn giữ `leads:edit` nên sửa được tên PH / email / tên con /
    // tuổi con / khoá quan tâm / ghi chú — chỉ ba ô này là khoá.
    //
    // ⚠️ Chỉ chặn ô THỰC SỰ ĐỔI, không chặn theo "có mặt trong phiếu": biểu mẫu gửi cả
    // phiếu nên `source` luôn có mặt dù người dùng không sờ tới. Chặn theo có-mặt là Sale
    // không lưu nổi một lượt sửa tên con — đúng luật mà sai việc, và họ sẽ báo là màn
    // hình hỏng chứ không báo là bị chặn. Phép so nằm ở `oKhoaBiDung` (hàm thuần, có test).
    if (!duocDe) {
      const viPham = oKhoaBiDung({ oGui: d as Record<string, unknown>, dangLuu: before })
      if (viPham.length > 0) return { ok: false, error: loiOKhoa(viPham) }
    }
  } else {
    // Đường HẸP (người nhập). `actorMayMutateLead` không dùng được ở đây: nó cho
    // qua khi là assignee HOẶC có `leads:view-all` — vai này không có cả hai.
    //
    // Kiểm bằng `can()` KÈM TARGET để scope OWN có tác dụng thật, thay vì tự so
    // `createdById` tại chỗ (luật cứng Nền Hệ thống #1: mọi kiểm quyền đi qua
    // `can()`; so tay ở Server Action là thứ lint `no-inline-authz` cấm).
    const mayEditOwn = await checkPermission('leads:edit-own-intake', {
      createdById: before.createdById ?? undefined,
    })
    if (!mayEditOwn) return { ok: false, error: 'Không có quyền' }

    // Bộ ô: ALLOWLIST. Gửi kèm ô ngoài danh sách là TỪ CHỐI CẢ PHIẾU, không
    // lặng lẽ bỏ qua — im lặng thì người sửa tưởng đã lưu, và bên kia thì không.
    const viPham = Object.keys(d).filter(
      (k) => !(INTAKE_EDITABLE_FIELDS as readonly string[]).includes(k),
    )
    if (viPham.length > 0) {
      return { ok: false, error: `${INTAKE_FIELD_DENIED} (${viPham.join(', ')})` }
    }
  }

  // Đổi SĐT → kiểm tra trùng.
  if (d.phone && d.phone !== before.phone) {
    const dup = await db.lead.findFirst({
      // Đợt G — như trên: tra theo biến thể, không so đúng-bằng.
      where: { phone: { in: phoneVariants(d.phone) }, deletedAt: null, id: { not: leadId } },
      select: { id: true },
    })
    if (dup) return { ok: false, error: 'SĐT đã tồn tại ở lead khác' }
  }

  // PR-C dual-write: đổi đơn vị → orgUnitId là nguồn chính, suy centerId (HO→null).
  let centerId: string | null | undefined
  if (d.orgUnitId !== undefined) {
    centerId = await centerIdForOrgUnit(d.orgUnitId || null)
    const hoErr = await rejectHeadOffice('lead', { orgUnitId: d.orgUnitId || null, centerId })
    if (hoErr) return { ok: false, error: hoErr }
  }

  // G-06 — mã campaign đi qua ĐÚNG khuôn SR.QD.232 của D-06 (không luật thứ hai).
  // Chỉ kiểm khi khoá CÓ MẶT: lượt sửa ô khác không được vấp lỗi vì ô này.
  let campaignName: string | null | undefined
  if (d.campaignName !== undefined) {
    const c = await checkLeadCampaignName(d.campaignName)
    if (!c.ok) return { ok: false, error: c.message }
    campaignName = c.value
  }

  const updateData = {
    ...(d.parentName !== undefined ? { parentName: d.parentName } : {}),
    ...(d.phone !== undefined ? { phone: d.phone } : {}),
    ...(d.email !== undefined ? { email: d.email || null } : {}),
    ...(d.childName !== undefined ? { childName: d.childName || null } : {}),
    ...(d.childAge !== undefined ? { childAge: d.childAge ?? null } : {}),
    ...(d.orgUnitId !== undefined ? { orgUnitId: d.orgUnitId || null, centerId } : {}),
    ...(d.courseId !== undefined ? { courseId: d.courseId || null } : {}),
    // Cờ nguồn BẬT ⇒ không ghi `source` (xem SRC-21a ở trên); cờ TẮT ⇒ như hôm nay.
    ...(d.source !== undefined && !nguonBat ? { source: d.source || null } : {}),
    // 24/08 — xem ghi chú ở updateLeadNote: ráp lại phần máy ghi, đừng đè trắng.
    // Ghi chú: người không có `leads:overwrite` chỉ được NỐI THÊM — xem `noiThemGhiChu`.
    ...(d.note !== undefined
      ? {
          note: mergeLeadNote(
            duocDe
              ? d.note
              : (noiThemGhiChu(splitLeadNote(before.note).human, d.note) ??
                 splitLeadNote(before.note).human),
            before.note,
          ),
        }
      : {}),
    // 23/08 — ô "Link Facebook" CÓ trong biểu mẫu nhập khách nhưng action này
    // chưa bao giờ ghi được: sửa xong là mất im lặng. Thêm cho cả hai đường.
    ...(d.facebookUrl !== undefined ? { facebookUrl: d.facebookUrl || null } : {}),
    // G-01 — 5 ô mới. `!== undefined` phân biệt "không gửi khoá" (giữ nguyên) với
    // "gửi khoá rỗng" (xoá trắng về null): không có ô nào bị kẹt giá trị sai vĩnh
    // viễn, và cũng không ô nào bị đè trắng vì một lượt sửa ô khác.
    ...(d.parentGender !== undefined ? { parentGender: d.parentGender || null } : {}),
    ...(d.parentDob !== undefined ? { parentDob: d.parentDob || null } : {}),
    ...(d.city !== undefined ? { city: d.city || null } : {}),
    ...(d.ward !== undefined ? { ward: d.ward || null } : {}),
    ...(d.addressLine !== undefined ? { addressLine: d.addressLine || null } : {}),
    // G-06 — 5 ô mới, cùng luật `!== undefined` với khối G-01.
    ...(d.campaignName !== undefined ? { campaignName: campaignName ?? null } : {}),
    ...(d.campaignId !== undefined ? { campaignId: d.campaignId || null } : {}),
    ...(d.adsetId !== undefined ? { adsetId: d.adsetId || null } : {}),
    ...(d.adId !== undefined ? { adId: d.adId || null } : {}),
    ...(d.nextFollowUpAt !== undefined ? { nextFollowUpAt: d.nextFollowUpAt || null } : {}),
  }
  // Ghi chú đổi qua đường biểu mẫu đầy đủ cũng là một lần chăm — xem chú thích dài ở
  // `updateLeadNote`. Hai đường ghi `note`, cả hai phải nhảy đồng hồ, nếu không lỗ chỉ
  // chuyển chỗ chứ không mất.
  const noteDoi = d.note !== undefined && updateData.note !== before.note
  // 🔴 KHÔNG ghi ở đây. Bản trên `main` gọi `db.lead.update` TRẦN ngay chỗ này, còn bản
  // `test` (vá V-6 · G-02, 25/08) đã dời lượt ghi vào TRONG giao dịch cùng nhật ký kiểm
  // toán. Hợp nhất 16/09 thoạt tiên giữ CẢ HAI ⇒ ghi hai lần, và lượt ghi trần lại nằm
  // ngoài giao dịch — đúng cái lỗi mà V-6 sinh ra để bịt. Giữ phép tính `noteDoi`, đưa
  // `lastActivityAt` vào đúng lượt ghi bên dưới.

  // Dòng lịch sử tương tác — chỉ khi CÓ ô thật sự đổi.
  //
  // Dùng `truongDaDoi` chứ không dùng `changedFields` ngay dưới: cái đó so bằng `!==`
  // trần nên `null` (DB) khác `""` (biểu mẫu), và một lượt bấm Lưu suông trên hồ sơ có ô
  // trống sẽ hiện ra như một lượt sửa. Hai phép so cùng tồn tại là có chủ đích — nhật ký
  // kiểm toán cần ĐÚNG TỪNG BYTE, còn lịch sử cần ĐÚNG VIỆC NGƯỜI LÀM.
  const oDaDoi = truongDaDoi(
    before as Record<string, unknown>,
    updateData as Record<string, unknown>,
    NHAN_TRUONG_LEAD,
  )
  if (oDaDoi.length > 0) {
    const { actorId, actorName } = getAuditActor(session)
    // BỎ QUA LỖI: phép ghi chính (`lead.update` ở trên) đã commit. Ném ở đây là báo lỗi
    // cho một lượt lưu ĐÃ THÀNH CÔNG, và người dùng sẽ bấm lưu lại.
    await ghiTuongTacLeadBoQuaLoi({
      leadId,
      actorId,
      actorName,
      moc: new Date(),
      sk: { viec: 'ho-so.sua', truong: oDaDoi },
    })
  }

  // P2-1: ghi nhật ký kiểm toán — chỉ field thực sự đổi.
  //
  // G-01 — `Date` phải so theo MỐC THỜI GIAN, không theo tham chiếu. Từ khi có
  // `parentDob`, `updateData` mang đối tượng `Date` do zod dựng, còn `before`
  // mang `Date` do Prisma dựng: `!==` luôn đúng kể cả hai bên cùng một ngày, nên
  // mỗi lần bấm Lưu lại đẻ một bản ghi kiểm toán rỗng ruột (giá trị cũ = giá trị
  // mới). Nhật ký hay bịa thì không ai còn tin nó khi cần truy trách nhiệm.
  const khacNhau = (a: unknown, b: unknown): boolean =>
    a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b
  const changedFields = (Object.keys(updateData) as (keyof typeof updateData)[]).filter((k) =>
    khacNhau((before as Record<string, unknown>)[k], (updateData as Record<string, unknown>)[k]),
  )
  const { actorId, actorName } = getAuditActor(session)
  const pick = (obj: Record<string, unknown>) =>
    Object.fromEntries(changedFields.map((k) => [k, obj[k]]))

  // V-6 · G-02 — lượt ghi và VẾT của nó đi CHUNG một giao dịch.
  //
  // Trước 25/08 hai lệnh này rời nhau: `db.lead.update` trần, rồi
  // `logLeadAudit(...).catch(() => {})` ở ngoài. Hỏng theo đúng chiều tệ nhất —
  // ghi vết chết thì bản ghi VẪN lưu và lỗi bị nuốt sạch, tức tên/SĐT khách đổi
  // mà không còn dấu vết nào, và cũng không ai biết là đã mất dấu. Spec G-02 nói
  // ngược lại: 3 ô định danh (Tên PH · SĐT PH · Tên HS) sửa được NHƯNG "bắt buộc
  // ghi audit log" — bắt buộc thì vết hỏng phải kéo cả lượt sửa đổ theo.
  // `updateLeadChild` cùng file đã làm đúng vậy từ 08/08; đây là chỗ bị bỏ sót.
  let hocVienDongBo: string[] = []
  try {
    await db.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient
      await tx.lead.update({
        where: { id: leadId },
        // Ghi chú đổi qua biểu mẫu đầy đủ cũng là một lần chăm (theo `main`) — xem chú
        // thích dài ở `updateLeadNote`. Hai đường ghi `note`, cả hai phải nhảy đồng hồ,
        // nếu không lỗ chỉ chuyển chỗ chứ không mất.
        data: noteDoi ? { ...updateData, lastActivityAt: new Date() } : updateData,
      })
      // 26/09/2026 — khoá quan tâm của LEAD đổi ⇒ dội xuống các bé (bé chưa có khoá + bé
      // đang mang đúng khoá cũ của lead), để khoá trial ở lớp trial và cột Khoá học trên
      // site giáo viên đổi theo. Luật: `conTheoLeadDoi`. Cùng giao dịch với lượt ghi lead:
      // lead đổi mà bé không đổi là đúng kiểu lệch mà chủ dự án cấm.
      if (d.courseId !== undefined) {
        await khoaLeadDaDoi(tx, {
          leadId,
          khoaLeadCu: before.courseId,
          khoaLeadMoi: updateData.courseId ?? null,
        })
      }
      // 26/09/2026 — ô phụ huynh / địa chỉ của phiếu đổi ⇒ dội sang MỌI học viên đang nối
      // phiếu này (chủ dự án: "đổi 1 nơi thì các nơi khác phải đổi hết"). Cùng giao dịch:
      // phiếu đổi mà hồ sơ học viên giữ số cũ là đúng kiểu lệch bị cấm. Luật + bảng ô chung:
      // `lib/students/dong-bo-lead.ts`. Client ở đây là `db` trần ⇒ thấy cả HV ở cơ sở khác.
      const dongBo = await dongBoTuLead({
        tx,
        leadId,
        truoc: phCuaLead(before as PhLead),
        sau: chiOPhLead(updateData as Record<string, unknown>),
        actor: { id: actorId, name: actorName },
      })
      hocVienDongBo = dongBo.studentIds
      if (changedFields.length > 0) {
        await logLeadAudit({
          leadId,
          action: 'UPDATE',
          actorId,
          actorName,
          oldValues: pick(before as Record<string, unknown>),
          newValues: pick(updateData as Record<string, unknown>),
          changedFields: changedFields as string[],
          tx,
        })
      }
    })
  } catch {
    // Câu chữ cố ý KHÔNG đổ tại nhật ký: lệnh ghi lead cũng nằm trong giao dịch
    // này, hỏng bên nào thì cả hai cùng hoàn tác. Nói sai chỗ hỏng là đẩy người
    // trực đi tìm nhầm hướng.
    return { ok: false, error: 'Không lưu được thay đổi — đã hoàn tác, thử lại' }
  }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/leads')
  if (hocVienDongBo.length > 0) {
    revalidatePath('/students')
    for (const sid of hocVienDongBo) revalidatePath(`/students/${sid}/edit`)
  }
  return { ok: true }
}

// ─── Module CRM & Lead PHẦN 2 — gán tay + auto-chia + cấu hình chế độ ─────────

/**
 * Auto-chia 1 lead theo cơ sở → chế độ (tôn trọng khoá khi đã tương tác).
 *
 * ⚠️ S-2b (25/08/2026) — HẾT BÁO THÀNH CÔNG GIẢ. Bản cũ vứt bỏ toàn bộ kết quả
 * của `autoAssignNewLead` (`skipped`, `assignedToId`, `mode`) và luôn trả
 * `{ ok: true }`, nên nút "Chia lại lead" lần nào bấm cũng bắn toast xanh "Đã
 * chia lại lead theo cấu hình cơ sở" — kể cả 5 đường KHÔNG LÀM GÌ của tầng dưới.
 *
 * Đường thường gặp nhất là tệ nhất: `autoAssignNewLead` **bỏ qua lead đã có người
 * phụ trách**, mà nút thì nằm trên trang chi tiết lead — nơi lead gần như luôn đã
 * được phân công. Nghĩa là cái nút tên "Chia LẠI" về bản chất không bao giờ chia
 * lại được, nhưng quản lý bấm xong tin là đã đổi người.
 *
 * KHÔNG đổi luật chia ở đây: khoá-khi-đã-tương-tác và bỏ-fallback-xuyên-cơ-sở là
 * quyết định có chủ đích của Đợt D, đổi chúng là việc của chủ dự án. Việc của
 * action chỉ là **nói đúng chuyện đã xảy ra**: `ok: true` chỉ khi thật sự ghi
 * được người nhận mới, còn lại trả lý do cụ thể kèm chỗ phải làm tiếp.
 */
export async function autoAssignNewLeadAction(
  leadId: string,
): Promise<{ ok: true; assignedToId: string } | { ok: false; error: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:assign'))) return { ok: false, error: 'Không có quyền' }

  const { actorId, actorName } = getAuditActor(session)
  const res = await autoAssignNewLead(leadId, { actorId, actorName })
  if (!res.ok) return { ok: false, error: res.error ?? 'Không chia được lead' }

  // Tầng dưới trả `ok: true` cho cả những lần nó CỐ Ý không làm gì. Dịch từng
  // đường đó thành một câu người bấm hiểu được, thay vì nuốt hết thành màu xanh.
  if (res.skipped) {
    return res.assignedToId
      ? {
          ok: false,
          error:
            'Lead đã có người phụ trách — nút này chỉ chia lead CHƯA phân công. ' +
            'Muốn đổi người, dùng ô "Gán tay" hoặc "Chuyển cơ sở" bên cạnh.',
        }
      : {
          ok: false,
          error:
            'Lead đã có tương tác của tư vấn viên nên hệ thống khoá tự chia lại. ' +
            'Muốn đổi người, dùng ô "Gán tay".',
        }
  }

  if (!res.assignedToId) {
    if (!res.centerId) {
      return { ok: false, error: 'Lead chưa thuộc cơ sở nào — chọn cơ sở trước khi chia.' }
    }
    if (res.mode === 'MANUAL') {
      return {
        ok: false,
        error:
          'Cơ sở đang đặt chế độ "Gán tay" nên hệ thống không tự chia. ' +
          'Chọn người ở ô "Gán tay".',
      }
    }
    return {
      ok: false,
      error:
        'Cơ sở chưa có tư vấn viên đang hoạt động để nhận lead — lead vẫn ở trạng thái chưa phân công.',
    }
  }

  revalidatePath('/leads')
  revalidatePath(`/leads/${leadId}`)
  return { ok: true, assignedToId: res.assignedToId }
}

/**
 * CHIA LẠI một lead ĐÃ CÓ theo cấu hình cơ sở — nút "Chia lại lead".
 *
 * ⚠️ KHÔNG dùng `autoAssignNewLead` cho việc này. Hàm đó dành cho lead MỚI và cố ý
 * bỏ qua lead đã có chủ (`auto-assign.ts:174` — `if (lead.assignedToId) return
 * { ok: true, skipped: true }`). Nút cũ gọi đúng vào đó rồi coi `ok: true` là
 * thành công, nên báo "Đã chia lại lead theo cấu hình cơ sở" trong khi lead không
 * đổi tay — đúng lỗi chủ dự án gặp 03/09/2026.
 *
 * Đường đúng là `chiaChoLead`: cửa duy nhất tiêu lượt của vòng, có ghi
 * `LeadAssignmentLog` nên lượt chia lại hiện ra trong sổ chia.
 */
export async function chiaLaiLeadAction(
  leadId: string,
): Promise<{ ok: boolean; error?: string; assignedToId?: string | null }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:assign'))) return { ok: false, error: 'Không có quyền' }

  const actor = await resolveActor(session.user.id)
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { centerId: true, assignedToId: true },
  })
  if (!lead || !passesScope('Lead', lead, actor)) {
    return { ok: false, error: 'Lead không tồn tại' }
  }
  // Không có cơ sở thì không có vòng chia nào để rút — nói thẳng thay vì im lặng
  // không đổi gì rồi báo thành công (đúng kiểu hỏng vừa phải vá).
  if (!lead.centerId) {
    return { ok: false, error: 'Lead chưa gắn cơ sở — chọn cơ sở trước khi chia lại' }
  }

  const res = await chiaChoLead(leadId, {
    targetCenterId: lead.centerId,
    createdById: session.user.id,
    entryPoint: 'RESHUFFLE',
  })
  if (!res.ok) return { ok: false, error: res.error ?? 'Không chia lại được' }
  if (!res.assignedToId) {
    return { ok: false, error: 'Cơ sở này chưa có sale nào đang bật trong vòng chia' }
  }

  revalidatePath('/leads')
  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/quan-ly-chia-lead')
  return { ok: true, assignedToId: res.assignedToId }
}

/** Quản lý gán tay 1 lead cho 1 sale cụ thể. */
export async function assignLeadToSaleAction(
  leadId: string,
  saleId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:assign'))) return { ok: false, error: 'Không có quyền' }

  // Đợt G — người gán ở cấp Hội sở được gán xuyên cơ sở (điều phối liên cơ sở là
  // nghiệp vụ có thật, xem màn "Chuyển lead liên CS"). Người cấp cơ sở thì không:
  // đó là vế đã thiếu và đã gây sự cố 21/08.
  const assignActor = await resolveActor(session.user.id)
  const { actorId, actorName } = getAuditActor(session)
  const res = await manualAssignLead(leadId, saleId, { actorId, actorName }, {
    actorIsHoLevel: assignActor.isHoLevel,
  })
  if (!res.ok) return res

  revalidatePath('/leads')
  revalidatePath(`/leads/${leadId}`)
  return { ok: true }
}

const ASSIGN_MODES = ['ROUND_ROBIN', 'CLOSE_RATE', 'MANUAL'] as const

/**
 * Đặt chế độ chia lead cho một cơ sở.
 *
 * ⚠️ Đợt G (23/08/2026) — SIẾT CỔNG. Trước đó action này chỉ đòi `leads:assign`
 * trong khi TRANG gác `leads:assign-config` (chốt 03/08: tách riêng màn cấu hình
 * khỏi quyền điều phối lead). Cổng action lỏng hơn cổng trang là lỗ hổng vô hình:
 * màn hình trông như đã khoá mà endpoint thì không — và `leads:assign` thì
 * CENTER_MANAGER có.
 *
 * Cụ thể mất gì: gọi thẳng action là đổi được chế độ của cả cơ sở sang
 * `CLOSE_RATE`, tức thoát khỏi sổ lượt dựng ở Đợt D, lách đúng quyết định Q7
 * ("chia đều số lượt, tuyệt đối không được sai") mà không sinh một dòng quyết
 * định nào ai đọc được sau này.
 *
 * Nhánh CENTER_MANAGER bên dưới GIỮ NGUYÊN dù hiện là nhánh chết (v1 matrix cho
 * `leads:assign-config` chỉ SUPER_ADMIN): nếu sau này chủ dự án cấp quyền đó cho
 * Quản lý cơ sở (plan/14 Q5, CHƯA ký) thì giới hạn "chỉ cơ sở mình" phải sẵn ở
 * đây, chứ không phải nhớ ra lúc đó.
 */
export async function setCenterAssignModeAction(
  centerId: string,
  mode: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:assign-config', { centerId }))) {
    return { ok: false, error: 'Không có quyền' }
  }

  if (!ASSIGN_MODES.includes(mode as (typeof ASSIGN_MODES)[number])) {
    return { ok: false, error: 'Chế độ không hợp lệ' }
  }

  // CENTER_MANAGER (không kèm SUPER_ADMIN) chỉ đặt cơ sở mình.
  const isSuper = hasRole(session.user, 'SUPER_ADMIN')
  if (!isSuper && hasRole(session.user, 'CENTER_MANAGER') && session.user.centerId !== centerId) {
    return { ok: false, error: 'Chỉ đặt được cơ sở của bạn' }
  }

  await db.leadAssignmentConfig.upsert({
    where: { centerId },
    create: { centerId, mode: mode as (typeof ASSIGN_MODES)[number] },
    update: { mode: mode as (typeof ASSIGN_MODES)[number] },
  })

  revalidatePath('/leads/cau-hinh-chia')
  return { ok: true }
}

// ─── Module CRM & Lead PHẦN 3 — chuyển lead + note bàn giao bắt buộc ──────────

const transferSchema = z.object({
  leadId: z.string().min(1),
  toSaleId: z.string().trim().optional().or(z.literal('')),
  toCenterId: z.string().trim().optional().or(z.literal('')),
  handoverNote: z.string().trim().min(5, 'Bắt buộc ghi đã tư vấn gì cho khách (≥5 ký tự)').max(2000),
  reason: z.string().trim().max(500).optional().or(z.literal('')),
})

export async function transferLead(
  input: unknown,
): Promise<{ ok: boolean; error?: string; code?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Không có quyền' }

  const parsed = transferSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' }
  }
  const d = parsed.data

  const lead = await db.lead.findFirst({
    where: { id: d.leadId, deletedAt: null },
    // `parentName` chỉ để dựng nội dung chuông ở cuối hàm — thêm vào select đang có
    // thay vì mở một câu tra thứ hai.
    select: { id: true, assignedToId: true, centerId: true, status: true, parentName: true },
  })
  if (!lead) return { ok: false, error: 'Lead không tồn tại' }

  // Cách ly cơ sở (chống IDOR ghi): Lead nguồn phải thuộc tầm nhìn cơ sở actor —
  // đồng bộ với updateLeadFields. Guard assignedToId bên dưới CHƯA đủ (leads:view-all
  // bỏ qua guard → CENTER_MANAGER CS1 có thể chuyển lead CS2). Chuyển SANG cơ sở khác
  // (toCenterId) vẫn cho phép — đó là nghiệp vụ bàn giao liên cơ sở.
  const actor = await resolveActor(session.user.id)
  if (!passesScope('Lead', lead, actor)) {
    return { ok: false, error: 'Lead không tồn tại' }
  }

  // SALE (chỉ view-own) chỉ tự chuyển lead của mình.
  if (!(await checkPermission('leads:view-all', { centerId: lead.centerId })) && lead.assignedToId !== session.user.id) {
    return { ok: false, error: 'Chỉ chuyển được lead của bạn' }
  }

  const toCenterId = d.toCenterId || lead.centerId || null
  const centerChanged = !!toCenterId && toCenterId !== lead.centerId

  // Không bàn giao lead sang Hội sở (cùng luật với lúc tạo/sửa).
  const hoErrTransfer = await rejectHeadOffice('lead', { centerId: toCenterId })
  if (hoErrTransfer) return { ok: false, error: hoErrTransfer }

  // FL2-03 — chặn bàn giao "rỗng": cơ sở/sale đích trùng nguồn → báo lỗi rõ (code EN,
  // message VI). Validator thuần (Vitest) — xem lib/crm/transfer-validate.ts.
  const targetCheck = validateTransferTarget({
    fromCenterId: lead.centerId,
    fromSaleId: lead.assignedToId,
    toCenterId,
    toSaleId: d.toSaleId || null,
  })
  if (!targetCheck.ok) {
    return { ok: false, code: targetCheck.error.code, error: targetCheck.error.message }
  }

  // Xác định sale nhận.
  let toSaleId: string | null = null
  if (d.toSaleId) {
    const sale = await db.user.findFirst({
      where: { id: d.toSaleId, roles: { has: 'SALES_CSM' }, deletedAt: null },
      select: { id: true, isActive: true, centerId: true },
    })
    // 01/10/2026 — người nhận phải CÒN LÀM và thuộc ĐÚNG cơ sở đích (trước chỉ kiểm vai, nên
    // chuyển cho sale đã nghỉ / sale cơ sở khác vẫn lọt — lead thành vô chủ trong tầm nhìn).
    const nhan = validateTransferRecipient({ sale, toCenterId })
    if (!nhan.ok) return { ok: false, code: nhan.error.code, error: nhan.error.message }
    toSaleId = sale!.id
  } else if (centerChanged && toCenterId) {
    // Đổi cơ sở, không chỉ định người → chia theo chế độ cơ sở mới.
    toSaleId = await reassignForCenter(toCenterId, lead.assignedToId)
  } else {
    return { ok: false, error: 'Chọn sale mới hoặc cơ sở mới để chuyển' }
  }

  const { actorId, actorName } = getAuditActor(session)
  const [toSale, fromCenter, toCenter] = await Promise.all([
    toSaleId ? db.user.findUnique({ where: { id: toSaleId }, select: { name: true } }) : null,
    lead.centerId ? db.center.findUnique({ where: { id: lead.centerId }, select: { name: true } }) : null,
    toCenterId ? db.center.findUnique({ where: { id: toCenterId }, select: { name: true } }) : null,
  ])

  await db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        centerId: toCenterId,
        // Đợt A — kèm mốc phân công. Chuyển lead sang người khác thì người nhận
        // phải có cửa sổ SLA riêng, không thừa hưởng đồng hồ của người trước.
        ...assignmentWrite(toSaleId),
        handoverNote: d.handoverNote,
        // GĐ5 — ĐÃ GỠ nhánh tự đẩy MOI → ASSIGNED khi bàn giao. "Đã phân công" nay đọc
        // từ assignedToId/assignedAt (do assignmentWrite ở trên ghi), không phải một bậc
        // phễu, nên dịch thẳng theo bảng ánh xạ sẽ thành `MOI → MOI` — một phép gán rỗng
        // gây hiểu nhầm là còn logic. Trạng thái phễu giữ nguyên qua lượt bàn giao.
      },
    })

    await recordLeadActivity({
      tx,
      leadId: lead.id,
      actorId,
      actorName,
      type: 'HANDOVER',
      content: d.handoverNote,
      metadata: {
        fromSaleId: lead.assignedToId,
        toSaleId,
        fromCenterId: lead.centerId,
        toCenterId,
        reason: d.reason || null,
      },
    })

    await tx.leadTransfer.create({
      data: {
        leadId: lead.id,
        fromCenterId: lead.centerId,
        toCenterId,
        fromSaleId: lead.assignedToId,
        toSaleId,
        note: d.handoverNote,
        reason: d.reason || null,
        transferredById: actorId,
        transferredByName: actorName,
      },
    })

    await logLeadAudit({
      leadId: lead.id,
      action: 'ASSIGN',
      actorId,
      actorName,
      oldValues: { assignedToId: lead.assignedToId, centerId: lead.centerId },
      newValues: { assignedToId: toSaleId, centerId: toCenterId },
      changedFields: ['assignedToId', 'centerId'],
      tx,
    })
  })

  // BÁO CHO NGƯỜI NHẬN — vá 08/09/2026.
  //
  // Trước bản vá này chuyển lead là đường CÂM: sổ ghi đủ (LeadActivity HANDOVER, LeadTransfer,
  // audit) nhưng sale nhận KHÔNG biết gì. Tên người nhận thậm chí đã được tra rồi vứt đi bằng
  // `void toSale` ngay dòng này.
  //
  // NGOÀI transaction, sau dấu đóng ở trên: `notifyStaff` cố ý không nhận `tx`.
  // Dùng ĐÚNG khoá `lead.moi:<leadId>` sẵn có — `catalog.ts` phân loại theo tiền tố đó.
  if (toSaleId) {
    await baoSaleCoLeadMoi({
      ownerId: toSaleId,
      leadId: lead.id,
      parentName: lead.parentName,
      source: 'MANAGER',
    })
  } else if (toCenterId) {
    // `reassignForCenter` trả null khi cơ sở ĐÍCH không còn ai nhận lead. Lead vừa bị chuyển
    // sang đó và nay KHÔNG có chủ — im lặng ở đây là đúng kiểu hỏng đắt nhất của module này:
    // có khách đang chờ mà không ai được giao. Báo quản lý cơ sở đích, đúng khuôn pool rỗng.
    await baoPoolRong(toCenterId, lead.id, lead.parentName)
  }

  // Chuông của CHỦ CŨ trỏ tới lead họ không còn giữ — và chuyển XUYÊN CƠ SỞ thì scopedDb còn
  // lọc mất, bấm vào ra trang "không tồn tại". Thu hồi trong cùng lượt.
  await thuHoiChuongLeadCu({ chuCuId: lead.assignedToId, chuMoiId: toSaleId, leadId: lead.id })

  void toSale
  void fromCenter
  void toCenter
  revalidatePath('/leads')
  revalidatePath(`/leads/${lead.id}`)
  return { ok: true }
}

// ─── R7-01 — LeadChild (1 Lead có N con) ─────────────────────────────────────

/** Map dữ liệu đã validate → payload ghi LeadChild (chuẩn hoá rỗng → null). */
function leadChildData(parsed: unknown) {
  const d = parsed as {
    fullName: string
    dob?: string | Date | null
    ageYears?: number | null
    gender?: string | null
    schoolName?: string | null
    gradeLevel?: string | null
    interestedCourseId?: string | null
    interestedCenterId?: string | null
    classId?: string | null
    note?: string | null
    contractValue?: number | null
  }
  return {
    fullName: d.fullName,
    dob: d.dob ? new Date(d.dob) : null,
    ageYears: d.ageYears ?? null,
    gender: d.gender || null,
    schoolName: d.schoolName || null,
    gradeLevel: d.gradeLevel || null,
    interestedCourseId: d.interestedCourseId || null,
    interestedCenterId: d.interestedCenterId || null,
    // G-01 — LỚP ĐANG HỌC tại trung tâm. Khác `interestedCenterId` (cơ sở QUAN
    // TÂM, chưa học) và khác `Enrollment` (chỉ có sau khi convert).
    classId: d.classId || null,
    note: d.note || null,
    // G-06 — GIÁ TRỊ HỢP ĐỒNG ĐÃ KÝ, không phải tiền đã thu (xem
    // lib/lead/contract-value.ts). `?? null` chứ KHÔNG `|| null`: số 0 là giá trị
    // thật (học bổng toàn phần) và `||` sẽ biến nó thành "chưa nhập".
    contractValue: d.contractValue ?? null,
  }
}

// `syncLeadCourseFromChildren` dời sang `lib/lead/khoa-quan-tam-con.ts` (26/09/2026): màn
// lớp trial cũng ghi khoá quan tâm của con, và hai nơi ghi phải dùng CÙNG một luật đồng bộ.

/** Thêm 1 con vào lead. `input` gồm `leadId` + các field con (leadChildSchema). */
export async function addLeadChild(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Không có quyền' }

  const leadId = (input as { leadId?: unknown })?.leadId
  if (typeof leadId !== 'string' || !leadId) {
    return { ok: false, error: 'Thiếu lead' }
  }

  // LeadChild không có centerId riêng → scope theo lead cha.
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, centerId: true },
  })
  const actor = await resolveActor(session.user.id)
  if (!lead || !passesScope('Lead', lead, actor)) {
    return { ok: false, error: 'Lead không tồn tại' }
  }

  const parsed = leadChildSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' }
  }
  const data = leadChildData(parsed.data)

  const { actorId, actorName } = getAuditActor(session)
  const child = await db.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient
    const created = await tx.leadChild.create({
      data: { leadId, ...data },
      select: { id: true, fullName: true },
    })
    // Cùng transaction với lượt ghi con: nửa vời (có con, khoá của lead chưa đổi)
    // đúng là trạng thái mà người dùng báo lỗi. Con không chọn khoá thì KHÔNG đụng
    // đến khoá của lead (xem cảnh báo ở `syncLeadCourseFromChildren`).
    if (data.interestedCourseId) await syncLeadCourseFromChildren(tx, leadId)
    await ghiTuongTacLead(tx, {
      leadId,
      actorId,
      actorName,
      moc: new Date(),
      sk: { viec: 'con.them', tenCon: created.fullName },
    })
    return created
  })

  await logLeadAudit({
    leadId,
    action: 'UPDATE',
    actorId,
    actorName,
    newValues: { childAdded: child.fullName, leadChildId: child.id },
    changedFields: ['children'],
  }).catch(() => {})

  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/leads')
  return { ok: true }
}

/** Sửa thông tin 1 con. Scope theo lead cha của con. */
export async function updateLeadChild(
  childId: string,
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Không có quyền' }

  const child = await db.leadChild.findUnique({
    where: { id: childId },
    select: {
      id: true,
      leadId: true,
      fullName: true,
      interestedCourseId: true,
      // Đủ 9 ô mà `leadChildData` ghi — để dòng lịch sử kể ĐÚNG ô nào đổi. Thiếu ô nào
      // thì ô đó luôn bị coi là đã sửa (`truongDaDoi` so `undefined` với giá trị mới ⇒
      // luôn "khác"), nên phải lấy đủ chứ không lấy vài ô cho nhanh.
      dob: true,
      ageYears: true,
      gender: true,
      schoolName: true,
      gradeLevel: true,
      interestedCenterId: true,
      note: true,
      lead: { select: { centerId: true, courseId: true } },
    },
  })
  const actor = await resolveActor(session.user.id)
  if (!child || !passesScope('Lead', { centerId: child.lead?.centerId ?? null }, actor)) {
    return { ok: false, error: 'Không tìm thấy con của lead' }
  }

  const parsed = leadChildSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' }
  }
  const data = leadChildData(parsed.data)

  const { actorId, actorName } = getAuditActor(session)
  // 08/08 — đổi tên con Ở MÀN LEAD cũng phải dội sang hồ sơ học viên đã convert (và
  // các bản sao còn lại), cùng một transaction — đối xứng với chiều updateStudent.
  // Sửa một nơi mà nơi kia giữ tên cũ thì lần lưu sau sẽ ghi đè ngược, hai hồ sơ
  // giằng co nhau vô hạn.
  let syncedStudentIds: string[] = []
  await db.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient
    await tx.leadChild.update({ where: { id: childId }, data })
    // Khoá quan tâm — ĐỒNG BỘ HAI CHIỀU (chủ dự án 26/09/2026: "1 cái đổi thì đổi hết").
    // Khoá của bé ĐỔI sang khoá mới ⇒ lead nhận đúng khoá đó; gỡ trắng ⇒ tính lại theo luật
    // cũ; KHÔNG đổi (bấm Lưu để sửa tên…) ⇒ không đụng lead. Luật: `leadTheoConDoi`.
    await khoaConDaDoi(tx, {
      leadId: child.leadId,
      khoaConCu: child.interestedCourseId,
      khoaConMoi: data.interestedCourseId ?? null,
    })

    // KHÔNG .catch() nuốt lỗi ở đây nữa: query hỏng giữa transaction là tx đã toang,
    // nuốt đi chỉ đổi được thông báo lỗi khó hiểu hơn ở query kế tiếp.
    await logLeadAudit({
      leadId: child.leadId,
      action: 'UPDATE',
      actorId,
      actorName,
      oldValues: { childUpdated: child.fullName, leadChildId: childId },
      newValues: { fullName: data.fullName },
      changedFields: ['children'],
      tx,
    })

    if (child.fullName !== data.fullName) {
      const res = await syncLeadChildNameToStudents({
        tx,
        leadChildId: childId,
        oldName: child.fullName,
        newName: data.fullName,
        actor: { id: actorId, name: actorName },
      })
      syncedStudentIds = res.studentIds
    }
    // 26/09/2026 — ngày sinh / giới tính / trường / lớp của bé đổi ⇒ dội sang học viên đang
    // nối đúng bé này (chủ dự án: "đổi 1 nơi thì các nơi khác phải đổi hết"). Tên đi đường
    // riêng ngay trên. Luật dịch "Lớp 4" ↔ 4, "Nữ" ↔ FEMALE: `lib/students/dong-bo-lead.ts`.
    const dongBoCon = await dongBoTuCon({
      tx,
      leadChildId: childId,
      truoc: conCuaLead(child),
      sau: chiOConLead(data as Record<string, unknown>),
      actor: { id: actorId, name: actorName },
    })
    syncedStudentIds = [...new Set([...syncedStudentIds, ...dongBoCon.studentIds])]

    // Dòng lịch sử — chỉ ghi khi CÓ ô thật sự đổi. Form gửi lên toàn bộ ô mỗi lần lưu,
    // nên bấm Lưu suông cũng đi vào đây; ghi vô điều kiện là đẻ dòng "đã sửa" giả.
    // Tên con lấy tên MỚI: đó là tên mà người đọc lịch sử sẽ thấy ở hồ sơ.
    const daDoi = truongDaDoi(child, data, NHAN_TRUONG_CON)
    if (daDoi.length > 0) {
      await ghiTuongTacLead(tx, {
        leadId: child.leadId,
        actorId,
        actorName,
        moc: new Date(),
        sk: { viec: 'con.sua', tenCon: data.fullName, truong: daDoi },
      })
    }
  })

  revalidatePath(`/leads/${child.leadId}`)
  revalidatePath('/leads')
  if (syncedStudentIds.length > 0) {
    revalidatePath('/students')
    for (const sid of syncedStudentIds) revalidatePath(`/students/${sid}/edit`)
  }
  return { ok: true }
}

// ─── C-06 — đánh dấu RỚT theo TỪNG CON, lý do ghi ở cấp PHỤ HUYNH ────────────
//
// Chốt 24/08/2026: TRẠNG THÁI rớt ở `LeadChild.status` (B5), LÝ DO rớt là ô ghi chú
// TỰ DO bắt buộc ở `Lead.lostNote`/`lostAt` (B5 + 12(b) — không còn danh mục lý do).
//
// KHÔNG nhét vào `updateLeadStatus`: hàm đó nhận `(leadId, rawStatus)` và đổi trạng
// thái ở CẤP PHIẾU, còn đây đổi ở CẤP CON và bắt buộc thêm ô lý do. Cũng KHÔNG nhét
// lý do vào `note` — đó là ô ghi chú chung, không lọc/đọc lại được theo lượt rớt.

/** Đọc con + phiếu cha, đã qua cách ly cơ sở và quyền sửa. `scopedDb` không che WRITE. */
async function loadChildForLostChange(
  sessionUserId: string,
  leadChildId: string,
): Promise<
  | { ok: true; child: { id: string; fullName: string; leadId: string; status: LeadChildStatus | null } }
  | { ok: false; error: string }
> {
  const child = await db.leadChild.findUnique({
    where: { id: leadChildId },
    select: {
      id: true,
      fullName: true,
      leadId: true,
      status: true,
      lead: { select: { centerId: true, assignedToId: true } },
    },
  })
  const actor = await resolveActor(sessionUserId)
  // LeadChild không có centerId riêng → scope theo phiếu cha, y như addLeadChild/updateLeadChild.
  if (!child || !passesScope('Lead', { centerId: child.lead?.centerId ?? null }, actor)) {
    return { ok: false, error: 'Không tìm thấy con của lead' }
  }
  if (!(await actorMayMutateLead(sessionUserId, child.lead?.assignedToId ?? null))) {
    return { ok: false, error: MUTATE_DENIED }
  }
  return {
    ok: true,
    child: { id: child.id, fullName: child.fullName, leadId: child.leadId, status: child.status },
  }
}

/**
 * Đánh dấu MỘT con là RỚT. Ô lý do bắt buộc — action từ chối nếu để trống.
 *
 * Con rớt sau ĐÈ ghi chú của con trước (lý do là của cả phụ huynh). Đổi lại, mỗi lượt
 * đánh dấu ghi vết mang `leadChildId` + tên con + lý do vào AuditLog và timeline, nên
 * lý do của TỪNG con vẫn lần ra được — đó là điều kiện để chấp nhận việc ghi đè.
 */
export async function markLeadChildLostAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Không có quyền' }

  const parsed = markChildLostSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' }
  }

  const loaded = await loadChildForLostChange(session.user.id, parsed.data.leadChildId)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  const { child } = loaded

  const { actorId, actorName } = getAuditActor(session)
  try {
    await db.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient
      await tx.leadChild.update({ where: { id: child.id }, data: { status: 'LOST' } })

      const lostChildCount = await tx.leadChild.count({
        where: { leadId: child.leadId, status: 'LOST' },
      })
      const patch = decideLeadLostFields({
        intent: 'mark',
        lostChildCount,
        lostNote: parsed.data.lostNote,
        now: new Date(),
      })
      if (patch) await tx.lead.update({ where: { id: child.leadId }, data: patch })

      // Vết đi CÙNG giao dịch: ghi vết hỏng thì lượt đánh dấu cũng không lưu. Ghi vết
      // ngoài giao dịch rồi `.catch(() => {})` đúng bằng không có vết — lỗi đã phải vá
      // một lần ở `updateLeadFields` (V-6 · G-02).
      // C-07 — cùng một đường ghi với trạng thái phiếu; trạng thái CON đổi cũng
      // phải để lại mốc đọc được, không đẻ định dạng vết thứ hai.
      await recordLeadStatusChange({
        tx,
        leadId: child.leadId,
        actorId,
        actorName,
        from: child.status,
        to: 'LOST',
        source: 'MANUAL',
        child: { id: child.id, fullName: child.fullName },
        reason: parsed.data.lostNote,
        extra: { lostNote: parsed.data.lostNote },
        extraChangedFields: ['lostNote'],
      })
    })
  } catch {
    return { ok: false, error: 'Không lưu được lượt đánh dấu rớt' }
  }

  revalidatePath(`/leads/${child.leadId}`)
  revalidatePath('/leads')
  return { ok: true }
}

/**
 * Gỡ MỘT con khỏi trạng thái rớt, đưa về một bước phễu bình thường.
 *
 * 🔴 Chỉ xoá `Lead.lostNote`/`lostAt` khi KHÔNG CÒN con nào rớt — xoá vô điều kiện là
 * xoá mất lý do của đứa còn lại, và không có đường nào dựng lại.
 */
export async function unmarkLeadChildLostAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Không có quyền' }

  // Schema cố ý KHÔNG nhận 'LOST' làm đích: nhận là mở đường đánh dấu rớt đi vòng qua
  // ô lý do bắt buộc.
  const parsed = unmarkChildLostSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Trạng thái không hợp lệ' }
  }

  const loaded = await loadChildForLostChange(session.user.id, parsed.data.leadChildId)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  const { child } = loaded
  if (child.status !== 'LOST') {
    // Không phải chuyện vặt: chạy tiếp là có thể xoá lý do rớt của phiếu trong khi
    // người dùng chỉ định đổi trạng thái một đứa con không hề rớt.
    return { ok: false, error: 'Học sinh này không ở trạng thái rớt' }
  }

  const { actorId, actorName } = getAuditActor(session)
  try {
    await db.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient
      await tx.leadChild.update({
        where: { id: child.id },
        data: { status: parsed.data.status },
      })

      // Đếm SAU khi ghi và TRONG giao dịch: đếm trước thì chính đứa vừa gỡ vẫn bị tính
      // là đang rớt ⇒ lý do không bao giờ xoá được; đếm ngoài giao dịch thì hai người
      // bấm cùng lúc ra hai kết quả khác nhau.
      const lostChildCount = await tx.leadChild.count({
        where: { leadId: child.leadId, status: 'LOST' },
      })
      const patch = decideLeadLostFields({ intent: 'unmark', lostChildCount, now: new Date() })
      if (patch) await tx.lead.update({ where: { id: child.leadId }, data: patch })

      await recordLeadStatusChange({
        tx,
        leadId: child.leadId,
        actorId,
        actorName,
        from: 'LOST',
        to: parsed.data.status,
        source: 'MANUAL',
        child: { id: child.id, fullName: child.fullName },
        // Ghi rõ phiếu có bị xoá lý do hay không — người đọc nhật ký sau này cần
        // biết lý do biến mất vì lượt nào.
        extra: { leadLostCleared: patch !== null },
        extraChangedFields: patch ? ['lostNote'] : [],
      })
    })
  } catch {
    return { ok: false, error: 'Không lưu được lượt gỡ trạng thái rớt' }
  }

  revalidatePath(`/leads/${child.leadId}`)
  revalidatePath('/leads')
  return { ok: true }
}

/** Xoá 1 con khỏi lead. Scope theo lead cha của con. */
export async function deleteLeadChild(
  childId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  if (!(await checkPermission('leads:edit'))) return { ok: false, error: 'Không có quyền' }

  const child = await db.leadChild.findUnique({
    where: { id: childId },
    select: {
      id: true,
      leadId: true,
      fullName: true,
      interestedCourseId: true,
      lead: { select: { centerId: true, courseId: true } },
    },
  })
  const actor = await resolveActor(session.user.id)
  if (!child || !passesScope('Lead', { centerId: child.lead?.centerId ?? null }, actor)) {
    return { ok: false, error: 'Không tìm thấy con của lead' }
  }

  // R7-02 edge: con đang ở lớp trải nghiệm ACTIVE → CHẶN xoá (FK Cascade sẽ xoá luôn
  // TrialEnrollment/attendance — mất dữ liệu). Yêu cầu rút khỏi lớp trước.
  const activeTrials = await db.trialEnrollment.count({
    where: { leadChildId: childId, status: 'ACTIVE' },
  })
  if (activeTrials > 0) {
    return { ok: false, error: 'Học viên đang ở lớp trải nghiệm — rút khỏi lớp trước khi xoá' }
  }

  const { actorId, actorName } = getAuditActor(session)
  // Khoá quan tâm của lead có phải do CHÍNH đứa sắp xoá đặt không. Chỉ tính lại
  // khi đúng là của nó — lead nhập từ Excel/tay có khoá riêng, xoá một đứa con
  // không liên quan mà cũng xoá luôn khoá của phiếu là mất dữ liệu không ai gọi.
  const courseCameFromThisChild =
    !!child.interestedCourseId && child.lead?.courseId === child.interestedCourseId

  await db.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient
    await tx.leadChild.delete({ where: { id: childId } })
    if (courseCameFromThisChild)
      await syncLeadCourseFromChildren(tx, child.leadId, child.interestedCourseId)
    // Ghi TRƯỚC khi ra khỏi tx: xoá con là việc không lấy lại được, nên dòng lịch sử
    // phải sống hoặc chết cùng nó. Tên con đã cầm sẵn từ lượt đọc ở trên — sau khi
    // `delete` thì không còn chỗ nào tra ra tên nữa.
    await ghiTuongTacLead(tx, {
      leadId: child.leadId,
      actorId,
      actorName,
      moc: new Date(),
      sk: { viec: 'con.go', tenCon: child.fullName },
    })
  })

  await logLeadAudit({
    leadId: child.leadId,
    action: 'UPDATE',
    actorId,
    actorName,
    oldValues: { childRemoved: child.fullName, leadChildId: childId },
    changedFields: ['children'],
  }).catch(() => {})

  revalidatePath(`/leads/${child.leadId}`)
  revalidatePath('/leads')
  return { ok: true }
}
