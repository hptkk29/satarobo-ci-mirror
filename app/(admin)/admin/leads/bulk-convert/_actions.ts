'use server'

// Chốt hàng loạt lead ĐÃ ĐĂNG KÝ (nhập liệu ban đầu CS1/CS2) — wiring Server Action
// → lib/crm/bulk-convert. Quyền: leads:view-all (chặn Sale — màn này thấy MỌI lead
// của cơ sở + có nhánh bỏ qua guard tiền, review 02/08: leads:import một mình KHÔNG
// đủ vì Sale cũng có) + leads:import + students:create + enrollments:create.
// Cách ly cơ sở: đọc lô qua scopedDb (Lead ∈ SCOPED_MODELS).

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { resolveActor } from '@/lib/auth/actor'
import { checkPermission } from '@/lib/auth/check-permission'
import { computeEnrollmentPrice } from '@/lib/finance/pricing'
import {
  canGrantFullScholarship,
  isFullWaiver,
  SCHOLARSHIP_FORBIDDEN,
} from '@/lib/crm/scholarship'
import { scopedDb } from '@/lib/db-scope'
import { ghiTuongTacLeadBoQuaLoi } from '@/lib/lead/tuong-tac/ghi'
import { getAuditActor } from '@/lib/audit/log'
import {
  convertOneLeadBackfill,
  type BulkConvertLeadResult,
} from '@/lib/crm/bulk-convert'

const MAX_LEADS_PER_CALL = 20

const studentSchema = z.object({
  leadChildId: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1, 'Tên học viên bắt buộc').max(120),
  dob: z.string().trim().optional().or(z.literal('')),
  classId: z.string().trim().min(1, 'Chọn lớp cho học viên'),
  consentMedia: z.boolean().optional(),
  // 04/08 — khuyến mãi do màn xem thử import ghi vào ghi chú của con, client đọc lại.
  discount: z
    .object({
      type: z.enum(['AMOUNT', 'PERCENT']),
      value: z.number().int().positive(),
    })
    .optional()
    .nullable(),
})

const leadItemSchema = z.object({
  leadId: z.string().trim().min(1),
  students: z.array(studentSchema).min(1, 'Cần ít nhất 1 học viên').max(10),
  discountReason: z.string().trim().max(300).optional().nullable(),
  dueDate2: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Hạn đợt 2 không hợp lệ')
    .optional()
    .nullable(),
  paid: z
    .object({
      amount: z.number().int().positive('Số tiền phải > 0'),
      paidDate: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày đóng không hợp lệ'),
      note: z.string().trim().max(300).optional().or(z.literal('')),
    })
    .optional()
    .nullable(),
})

// Vỏ ngoài chỉ kiểm mảng — TỪNG item validate riêng bên dưới để 1 lead dữ liệu
// hỏng không đánh fail nhầm cả chunk (review 02/08).
const bulkSchema = z.object({
  items: z.array(z.unknown()).min(1).max(MAX_LEADS_PER_CALL),
})

export type BulkConvertActionResult =
  | { ok: true; results: BulkConvertLeadResult[] }
  | { ok: false; error: string }

export async function bulkConvertLeadsAction(input: unknown): Promise<BulkConvertActionResult> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }

  // leads:view-all chặn Sale (chỉ SUPER_ADMIN/CENTER_MANAGER/HO-level): màn bulk
  // liệt kê mọi lead của cơ sở và có nhánh bỏ qua guard tiền — Sale vẫn convert
  // lead CỦA MÌNH ở đường đơn lẻ /leads/[id]/convert (có guard ownership + tiền).
  if (
    !(await checkPermission('leads:view-all')) ||
    !(await checkPermission('leads:import')) ||
    !(await checkPermission('students:create')) ||
    !(await checkPermission('enrollments:create'))
  ) {
    return { ok: false, error: 'Không có quyền chốt hàng loạt (cần leads:view-all + leads:import + students:create + enrollments:create)' }
  }

  const parsed = bulkSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' }
  }

  const actor = await resolveActor(session.user.id)
  const { actorId, actorName } = getAuditActor(session)
  const auditActor = { id: actorId, name: actorName }

  // Validate TỪNG item riêng — item hỏng thành lỗi dòng, không kéo cả chunk.
  type ParsedItem = z.infer<typeof leadItemSchema>
  const itemStates = parsed.data.items.map((raw) => {
    const p = leadItemSchema.safeParse(raw)
    const rawLeadId =
      typeof raw === 'object' && raw !== null && 'leadId' in raw && typeof raw.leadId === 'string'
        ? raw.leadId
        : '(không rõ)'
    return p.success
      ? { leadId: p.data.leadId, item: p.data as ParsedItem, error: null }
      : { leadId: rawLeadId, item: null, error: p.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' }
  })

  // Cách ly cơ sở TRƯỚC khi ghi: đọc lô lead qua scopedDb (auto-scope) — lead ngoài
  // cơ sở của actor không hiện trong kết quả ⇒ chặn ngay tại đây, service không chạy.
  const sdb = scopedDb(actor)
  const leadIds = itemStates.filter((s) => s.item).map((s) => s.leadId)
  const visibleLeads = leadIds.length
    ? await sdb.lead.findMany({
        where: { id: { in: leadIds }, deletedAt: null },
        select: { id: true },
      })
    : []
  const visible = new Set(visibleLeads.map((l) => l.id))

  // ⚠️ CỬA THỨ HAI của "miễn phí học bổng toàn phần" — phải đóng cùng cổng với màn chốt
  // lẻ (chốt 31/08/2026: chỉ Quản trị tối cao được miễn 100%).
  //
  // Màn này nhận ưu đãi từ ghi chú do IMPORT ghi (`Giảm=100%` / `Giảm=9000000đ`), và
  // `leads:import` thuộc cả CENTER_MANAGER lẫn SALES_CSM. Không chặn ở đây thì khoá ở
  // màn chốt lẻ chỉ là hình thức: cùng một người, cùng kết quả (học phí về 0, guard
  // PAYMENT_REQUIRED tự thoả), chỉ khác đường đi.
  //
  // Chặn ĐÚNG ca miễn TOÀN PHẦN, không đụng ưu đãi một phần: import lịch sử có giảm
  // 10%/500k là dữ liệu thật của khách cũ, khoá luôn là chặn cả nghiệp vụ nhập liệu.
  // Tính bằng CHÍNH `computeEnrollmentPrice` mà service dùng — hai bên không thể lệch.
  const waiveBlocked = new Set<string>()
  if (!canGrantFullScholarship(actor)) {
    const classIds = [
      ...new Set(
        itemStates.flatMap((st) => (st.item ? st.item.students.map((s) => s.classId) : [])),
      ),
    ]
    const priceByClass = new Map<string, number>()
    if (classIds.length) {
      const classes = await sdb.class.findMany({
        where: { id: { in: classIds } },
        select: { id: true, course: { select: { price: true } } },
      })
      for (const c of classes) priceByClass.set(c.id, c.course?.price ?? 0)
    }
    for (const st of itemStates) {
      if (!st.item) continue
      const waives = st.item.students.some((s) => {
        if (!s.discount) return false
        const listPrice = priceByClass.get(s.classId) ?? 0
        const { finalPrice } = computeEnrollmentPrice({ listPrice, discount: s.discount })
        return isFullWaiver(listPrice, finalPrice)
      })
      if (waives) waiveBlocked.add(st.item.leadId)
    }
  }

  const results: BulkConvertLeadResult[] = []
  for (const state of itemStates) {
    if (!state.item) {
      results.push({ leadId: state.leadId, ok: false, code: 'INVALID', message: state.error ?? 'Dữ liệu không hợp lệ' })
      continue
    }
    const item = state.item
    if (waiveBlocked.has(item.leadId)) {
      results.push({
        leadId: item.leadId,
        ok: false,
        code: 'SCHOLARSHIP_FORBIDDEN',
        message: `${SCHOLARSHIP_FORBIDDEN} Lead này có mức giảm làm học phí về 0đ — bỏ tick lead này, hoặc nhờ Quản trị tối cao chốt.`,
      })
      continue
    }
    if (!visible.has(item.leadId)) {
      results.push({
        leadId: item.leadId,
        ok: false,
        code: 'OUT_OF_SCOPE',
        message: 'Lead không tồn tại hoặc thuộc cơ sở khác — ngoài phạm vi của bạn',
      })
      continue
    }

    try {
      const kq = await convertOneLeadBackfill(auditActor, {
        leadId: item.leadId,
          students: item.students.map((s) => ({
            leadChildId: s.leadChildId || null,
            name: s.name,
            dob: s.dob ? new Date(s.dob) : null,
            classId: s.classId,
            consentMedia: s.consentMedia === true,
            discount: s.discount ?? null,
          })),
          discountReason: item.discountReason || null,
          dueDate2: item.dueDate2 ? new Date(`${item.dueDate2}T12:00:00+07:00`) : null,
          paid:
            item.paid && item.paid.amount > 0
              ? {
                  amount: item.paid.amount,
                  paidDate: new Date(`${item.paid.paidDate}T12:00:00+07:00`),
                  note: item.paid.note || null,
                }
              : null,
      })
      results.push(kq)

      // Dòng lịch sử — CHỈ khi lead đó chốt thành công. Lô 50 lead thì mỗi lead nhận
      // dòng của riêng mình; một lead vỡ không được làm mất dòng của 49 lead còn lại,
      // nên cửa BỎ QUA LỖI (và cũng vì đây là đường chạm tiền, đã commit xong).
      if (kq.ok) {
        await ghiTuongTacLeadBoQuaLoi({
          leadId: item.leadId,
          actorId: auditActor.id,
          actorName: auditActor.name,
          moc: new Date(),
          sk: { viec: 'chuyen-doi', tenCon: item.students.map((s) => s.name) },
        })
      }
    } catch (err) {
      // 1 lead vỡ không được kéo cả lô — ghi lỗi dòng rồi đi tiếp.
      console.error('[bulk-convert] lead failed', item.leadId, err)
      results.push({
        leadId: item.leadId,
        ok: false,
        code: 'INTERNAL',
        message: err instanceof Error ? err.message : 'Lỗi không xác định',
      })
    }
  }

  revalidatePath('/leads')
  revalidatePath('/students')
  revalidatePath('/enrollments')
  revalidatePath('/orders')
  revalidatePath('/dashboard')

  return { ok: true, results }
}
