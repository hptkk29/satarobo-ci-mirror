'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { scopedDb } from '@/lib/db-scope'
import { resolveActor } from '@/lib/auth/actor'
import { checkPermission } from '@/lib/auth/check-permission'
import { getAuditActor } from '@/lib/audit/log'
import { isConvertV2Enabled } from '@/lib/flags'
import { convertLeadV2, type ConvertV2Student } from '@/lib/crm/convert-lead-v2'
import { computeEnrollmentPrice } from '@/lib/finance/pricing'
// HTL-09 — cổng "ưu đãi có ăn tiền thật không" phải đo trên CÙNG con số mà
// `convertLeadV2` sắp ghi. Service nay lấy giá từ DÒNG ĐƠN; để chỗ này đo trên
// `Course.price` là hai bên nói hai chuyện, và ca `listPrice = 0` (khoá chưa khai giá)
// còn làm cổng BỎ QUA một suất học bổng có thật.
import { listPriceChoGhiDanh } from '@/lib/finance/gia-tu-dong-don'
import { dongDonCuaLead } from '@/lib/finance/dong-don-cua-lead'
import {
  canGrantFullScholarship,
  scholarshipAuditReason,
  SCHOLARSHIP_FORBIDDEN,
} from '@/lib/crm/scholarship'
import { phoneVn } from '@/lib/validators/phone'
import { ghiTuongTacLeadBoQuaLoi } from '@/lib/lead/tuong-tac/ghi'

// ─── R7-05 — wiring Convert v2 vào Server Action (UI → service đã có) ──────────
// KHÔNG nhân đôi logic convert: chỉ chuẩn hoá input từ form → gọi convertLeadV2.
// Giá (listPrice) đọc LẠI từ DB theo classId (không tin client).
// ⚠️ 27/08 — ĐẢO "C6 — bỏ ưu đãi": form nay gửi được ưu đãi/miễn phí từng em. Lý do
// đảo: bỏ ưu đãi khiến tổng phải thu luôn > 0 ⇒ lead miễn phí toàn phần kẹt cứng ở
// guard PAYMENT_REQUIRED, không có đường nào chốt (khoản 0đ cũng không ghi nhận được).

const studentSchema = z.object({
  leadChildId: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1, 'Tên học viên bắt buộc').max(120),
  dob: z.string().trim().optional().or(z.literal('')),
  classId: z.string().trim().min(1, 'Chọn lớp cho học viên'),
  consentMedia: z.boolean().optional(),
  // ⚠️ 31/08/2026 — THU HẸP còn ĐÚNG "học bổng toàn phần", và chỉ SUPER_ADMIN dùng được.
  //
  // Trước đó ô này nhận PERCENT / AMOUNT / PROGRAM với mức tuỳ ý, không vai nào bị chặn:
  // bất kỳ ai chốt được lead là giảm được học phí bao nhiêu tuỳ thích. Chủ dự án chốt
  // 31/08 gỡ hẳn khung "Ưu đãi học phí" khỏi màn chốt và chỉ giữ MỘT ô tick miễn phí
  // toàn phần cho quản trị.
  //
  // Thu hẹp ngay ở SCHEMA (không chỉ giấu ô trên giao diện): Server Action là endpoint
  // HTTP riêng, giấu ô mà vẫn nhận `PERCENT: 90` thì cổng chưa đóng. Vai được phép kiểm
  // ở thân hàm — schema không biết người gọi là ai.
  scholarship: z.boolean().optional(),
})

const convertSchema = z.object({
  parentName: z.string().trim().min(2, 'Tên phụ huynh tối thiểu 2 ký tự').max(120),
  // AUTH-SĐT P5 — email phụ huynh KHÔNG còn bắt buộc. Khoá định danh tài khoản
  // nay là `parentPhone` (canonical, @unique); email chỉ là kênh dự phòng (QĐ-3).
  // Ô trống gửi lên dạng `''` ⇒ chuẩn hoá về `null` ngay tại validator để đường
  // ghi bên dưới không phải phân biệt "" với null.
  parentEmail: z
    .string()
    .trim()
    .email('Email phụ huynh không hợp lệ')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v.toLowerCase() : null)),
  // AUTH-SĐT P1 (gom tồn dư 31/07) — dùng field dùng chung: TRANSFORM ra canonical
  // `84…` thay vì chỉ đo độ dài. Hai hệ quả có chủ đích:
  //   · `d.parentPhone` từ đây trở đi LUÔN canonical ⇒ đường ghi ở convert-lead-v2
  //     và khoá idempotency bên dưới không phải tự chuẩn hoá nữa;
  //   · "0905 123 456" (có khoảng trắng) nay ĐƯỢC nhận thay vì 400 — đúng lỗi
  //     "mất lead im lặng" mà P1 vá.
  // ⚠️ ĐỔI HÀNH VI: số CỐ ĐỊNH (02363…) nay bị TỪ CHỐI. Cố ý — `User.phone` là
  // định danh đăng nhập (@unique) và ZNS/OTP không gửi được vào số bàn, nên tài
  // khoản phụ huynh tạo bằng số cố định sẽ không bao giờ đăng nhập được.
  parentPhone: phoneVn,
  // C5 — CCCD + địa chỉ phụ huynh (lưu trên User, KHÔNG lưu trên Student). Optional/additive.
  parentCccd: z
    .string()
    .trim()
    .regex(/^\d{9}$|^\d{12}$/, 'CCCD/CMND phải có 9 hoặc 12 chữ số')
    .optional()
    .or(z.literal('')),
  parentAddress: z.string().trim().max(255).optional().or(z.literal('')),
  parentWard: z.string().trim().max(120).optional().or(z.literal('')),
  parentCity: z.string().trim().max(120).optional().or(z.literal('')),
  students: z.array(studentSchema).min(1, 'Cần ít nhất 1 học viên'),
  // Bắt buộc khi có ưu đãi (kiểm dưới, sau khi biết ưu đãi có ăn tiền thật không).
  // Đi vào `AuditLog.reason` của bản ghi STATUS_CHANGE lead → tra được về sau.
  // `discountReason` ĐÃ GỠ khỏi đầu vào: form không còn ô nhập (chốt 31/08 — "chỉ cần
  // ô tick"). Lý do ghi vào nhật ký nay do SERVER tự dựng, kèm tên người cấp — xem dưới.
  // Trách nhiệm không mất đi: cổng vai SUPER_ADMIN + nhật ký có tên là hai lớp thay cho
  // một ô chữ mà người cấp tự gõ.
})

export type SubmitConvertV2Result =
  | {
      ok: true
      studentIds: string[]
      enrollmentIds: string[]
      deduped: boolean
    }
  | { ok: false; code?: string; error: string }

export async function submitConvertV2(
  leadId: string,
  input: unknown,
): Promise<SubmitConvertV2Result> {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chưa đăng nhập' }
  // Flag-gate ở cả server (chống bypass khi flag OFF).
  if (!isConvertV2Enabled()) {
    return { ok: false, error: 'Convert v2 chưa được bật (CONVERT_V2_ENABLED)' }
  }
  // Convert = tạo học viên + đăng ký → cần cả 2 quyền (loại MARKETING ra).
  if (!(await checkPermission('students:create')) || !(await checkPermission('enrollments:create'))) {
    return { ok: false, error: 'Không có quyền chuyển đổi (tạo học viên + đăng ký)' }
  }

  const parsed = convertSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' }
  }
  const d = parsed.data

  const actor = await resolveActor(session.user.id)
  const sdb = scopedDb(actor)

  // ⚠️ CỔNG VAI cho học bổng toàn phần (chốt 31/08/2026): CHỈ SUPER_ADMIN.
  //
  // Giấu ô tick trên giao diện KHÔNG phải lớp bảo vệ — Server Action là endpoint HTTP
  // riêng, gọi thẳng với `scholarship: true` vẫn tới được đây. Học bổng toàn phần làm
  // học phí của một em bốc hơi khỏi công nợ và cho lead đi thẳng qua guard
  // PAYMENT_REQUIRED mà không cần một đồng nào ghi nhận — nên nó phải là cổng cứng.
  //
  // Hỏi `actor.isSuperAdmin` chứ không `checkPermission`: repo không có action nào cho
  // việc này, và đẻ một permission mới bắt buộc phải chạy tay `seed-prod-roles.yml` sau
  // khi merge — quên là màn chốt lead trắng với mọi vai trên prod.
  const wantsScholarship = d.students.some((s) => s.scholarship === true)
  if (wantsScholarship && !canGrantFullScholarship(actor)) {
    return { ok: false, error: SCHOLARSHIP_FORBIDDEN }
  }

  // Scope: lead phải tồn tại; SALE (chỉ view-own) chỉ chuyển lead của mình.
  const lead = await sdb.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: { id: true, assignedToId: true },
  })
  if (!lead) return { ok: false, error: 'Lead không tồn tại' }
  if (!(await checkPermission('leads:view-all')) && lead.assignedToId !== session.user.id) {
    return { ok: false, error: 'Chỉ chuyển được lead của bạn' }
  }

  // Đọc giá thật từ lớp ở DB (không tin client gửi giá lên). Client chỉ được gửi LOẠI
  // + MỨC ưu đãi; giá gốc và phép trừ đều làm ở server (`computeEnrollmentPrice`).
  const classIds = [...new Set(d.students.map((s) => s.classId))]
  const classes = await sdb.class.findMany({
    where: { id: { in: classIds }, deletedAt: null },
    select: { id: true, courseId: true, course: { select: { price: true } } },
  })
  const classMap = new Map(classes.map((c) => [c.id, c]))

  // ── KHOÁ QUAN TÂM ↔ LỚP PHẢI KHỚP (chủ dự án chốt 03/09/2026) ──────────────
  //
  // Ô chọn ở giao diện đã chỉ hiện lớp thuộc khoá quan tâm của từng em, nhưng ô
  // chọn KHÔNG PHẢI cổng: Server Action là một endpoint riêng, gửi thẳng payload
  // là bỏ qua nó. Mà sai ở đây ăn tiền thật — học phí ghi vào công nợ lấy theo
  // giá LỚP, nên chốt nhầm lớp là ghi cho phụ huynh một khoản của khoá không ai
  // đặt, và không có gì báo.
  //
  // Chỉ chặn khi em ĐÃ CÓ khoá quan tâm. Em chưa khai thì mọi lớp đều hợp lệ —
  // đúng như giao diện, và đó là phần lớn lead thật.
  //
  // Khoá của em suy theo cùng luật màn Chuyển đổi: khoá của CHÍNH EM, không có
  // thì rơi về khoá cấp lead. Hai nơi lệch luật là giao diện cho chọn còn server
  // từ chối — người dùng bấm Chốt và ăn lỗi mà không hiểu vì sao.
  const leadChildIds = d.students.map((s) => s.leadChildId).filter(Boolean) as string[]
  if (leadChildIds.length > 0) {
    const [conRows, leadRow] = await Promise.all([
      sdb.leadChild.findMany({
        where: { id: { in: leadChildIds } },
        select: { id: true, interestedCourseId: true },
      }),
      sdb.lead.findUnique({ where: { id: leadId }, select: { courseId: true } }),
    ])
    const khoaTheoCon = new Map(conRows.map((c) => [c.id, c.interestedCourseId]))
    const tenKhoa = new Map(
      (
        await sdb.course.findMany({
          where: {
            id: {
              in: [
                ...new Set(
                  [...khoaTheoCon.values(), leadRow?.courseId].filter(Boolean) as string[],
                ),
              ],
            },
          },
          select: { id: true, name: true },
        })
      ).map((c) => [c.id, c.name]),
    )

    for (const s of d.students) {
      if (!s.leadChildId) continue
      const khoaEm = khoaTheoCon.get(s.leadChildId) ?? leadRow?.courseId ?? null
      if (!khoaEm) continue
      const cls = classMap.get(s.classId)
      if (cls && cls.courseId !== khoaEm) {
        return {
          ok: false,
          error:
            `Lớp đã chọn cho "${s.name}" không thuộc khoá quan tâm ` +
            `"${tenKhoa.get(khoaEm) ?? khoaEm}". Chọn lại lớp, hoặc sửa khoá quan tâm ` +
            `của em trên phiếu lead trước khi chốt.`,
        }
      }
    }
  }

  const students: ConvertV2Student[] = []
  // Đọc MỘT lần cho cả lượt — xem chú thích ở `convertLeadV2`.
  const dongDon = await dongDonCuaLead(leadId)
  let totalDiscountAmount = 0
  for (const s of d.students) {
    const cls = classMap.get(s.classId)
    if (!cls) return { ok: false, error: `Lớp không tồn tại cho học viên "${s.name}"` }
    const listPrice = cls.course?.price ?? 0
    // Ô tick → học bổng 100%. `computeEnrollmentPrice` xử lý SCHOLARSHIP như PERCENT
    // (kẹp 0..100) nên học phí về đúng 0đ. Không tick → KHÔNG ưu đãi, để
    // `Enrollment.discountType` không bị đóng dấu "PERCENT 0%" gây nhiễu báo cáo.
    const discount: { type: 'SCHOLARSHIP'; value: number } | null = s.scholarship
      ? { type: 'SCHOLARSHIP', value: 100 }
      : null
    // Tính lại bằng ĐÚNG hàm mà convertLeadV2 dùng — chỉ để biết ưu đãi có ăn tiền thật
    // không (bắt lý do). Giá ghi vào DB vẫn do convertLeadV2 tự tính, không truyền sang.
    totalDiscountAmount += computeEnrollmentPrice({
      listPrice: listPriceChoGhiDanh(
        dongDon,
        { leadChildId: s.leadChildId || null, courseId: cls.courseId },
        listPrice,
      ),
      discount,
    }).discountAmount
    students.push({
      leadChildId: s.leadChildId || null,
      name: s.name,
      dob: s.dob ? new Date(s.dob) : null,
      courseId: cls.courseId,
      classId: s.classId,
      listPrice,
      discount,
      consentMedia: s.consentMedia === true,
    })
  }

  // Học phí bốc hơi khỏi công nợ ⇒ nhật ký phải trả lời được "ai cho". Trước 31/08 câu
  // trả lời là một ô chữ người dùng tự gõ; nay ô đó đã gỡ nên SERVER tự dựng, và tên
  // lấy từ phiên đăng nhập chứ không nhận từ client.
  const { actorId, actorName } = getAuditActor(session)
  const discountReason =
    totalDiscountAmount > 0 ? scholarshipAuditReason(actorName, new Date()) : ''

  // Idempotency key ổn định theo payload (chống double-submit / 2 sale song song).
  const fingerprint = JSON.stringify({
    // P5 — email có thể null; đã lowercase ở validator. `null` là một giá trị
    // fingerprint hợp lệ, KHÔNG được thay bằng "" (hai lần bấm "không email" và
    // "email rỗng" phải cho cùng khoá, mà cả hai nay đều về null).
    parentEmail: d.parentEmail,
    // Đã canonical từ `phoneVn` ở schema — KHÔNG chuẩn hoá lần hai.
    // Lợi thêm: hai lần bấm gõ "0905123456" và "+84 905 123 456" nay cho CÙNG một
    // khoá (digit-strip cũ cho hai khoá khác nhau ⇒ chống double-submit hụt).
    parentPhone: d.parentPhone,
    students: students.map((s) => ({
      name: s.name.trim().toLowerCase(),
      classId: s.classId,
      courseId: s.courseId,
      // 27/08 — ƯU ĐÃI VÀO KHOÁ. Không có nó thì: chốt hụt vì thiếu lý do → sửa ưu đãi
      // → bấm lại ⇒ khoá y hệt ⇒ idempotency trả kết quả CŨ (giá cũ) mà báo thành công.
      discount: s.discount ? `${s.discount.type}:${s.discount.value}` : null,
    })),
  })
  const idempotencyKey = `convert:${leadId}:${createHash('sha256')
    .update(fingerprint)
    .digest('hex')
    .slice(0, 16)}`

  const res = await convertLeadV2(
    { id: actorId, name: actorName },
    {
      leadId,
      parentName: d.parentName,
      parentEmail: d.parentEmail,
      parentPhone: d.parentPhone,
      // C5 — CCCD + địa chỉ phụ huynh (convertLeadV2 ghi vào User, bỏ qua field rỗng).
      parentCccd: d.parentCccd || null,
      parentAddress: d.parentAddress || null,
      parentWard: d.parentWard || null,
      parentCity: d.parentCity || null,
      students,
      idempotencyKey,
      discountReason: discountReason || null,
    },
  )

  if (!res.ok) {
    return { ok: false, code: res.error.code, error: res.error.message }
  }

  // ⚠️ 31/08/2026 — NHÁNH "chia 2 đợt" ĐÃ GỠ khỏi màn chốt.
  //
  // Chốt của chủ dự án: học phí chốt ở TRANG ĐƠN HÀNG, không hỏi lại ở đây. Gỡ cả ở
  // server chứ không chỉ giấu ô: để lại một đường ghi mà không giao diện nào gọi là để
  // dành một cửa ghi kế hoạch đợt THỨ HAI — đúng kiểu hai màn ghi đè nhau rồi không ai
  // biết bản nào thắng.
  //
  // Năng lực KHÔNG mất: `recordInstallmentPlan` (orders/_actions.ts:959) và
  // `requestInstallmentApproval` (orders/_components/_installment-request-actions.ts)
  // vẫn là đường chính thức, nay là đường DUY NHẤT.

  // Dòng lịch sử: chốt lead. SAU khi `convertLeadV2` đã commit, cửa BỎ QUA LỖI — đây là
  // đường chạm tiền (đơn + ghi danh + phiếu thu), lịch sử không được quyền làm nó đổ.
  await ghiTuongTacLeadBoQuaLoi({
    leadId,
    actorId,
    actorName,
    moc: new Date(),
    sk: { viec: 'chuyen-doi', tenCon: students.map((s) => s.name) },
  })

  revalidatePath('/leads')
  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/students')
  revalidatePath('/enrollments')
  revalidatePath('/convert-conflicts')
  revalidatePath('/dashboard')
  return {
    ok: true,
    studentIds: res.studentIds,
    enrollmentIds: res.enrollmentIds,
    deduped: res.deduped,
  }
}
