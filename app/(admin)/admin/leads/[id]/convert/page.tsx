import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { docConChuyenDoiDuoc } from '@/lib/crm/con-chua-chuyen-doi-db'
import { ChevronLeft } from 'lucide-react'
import { auth } from '@/lib/auth'
import { checkPermission, canViewLeadPii } from '@/lib/auth/check-permission'
import { maskLeadPiiFields } from '@/lib/lead/pii'
import { scopedDb } from '@/lib/db-scope'
import { resolveActor } from '@/lib/auth/actor'
import { canGrantFullScholarship } from '@/lib/crm/scholarship'
import { isConvertV2Enabled } from '@/lib/flags'
import { LEAD_STATUS_LABEL } from '@/lib/leads/status'
import { getLeadPaymentSummary } from '@/lib/payments/summary'
import { LeadPaymentCard } from '../../_components/lead-payment-card'
import { ConvertForm } from './convert-form'
import { formatPhoneVN } from "@/lib/phone";

export const metadata = { title: 'Chuyển đổi | Admin' }
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ConvertV2Page({ params }: Props) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const { id } = await params

  // Flag OFF → form v2 không khả dụng, quay lại flow cũ ở trang chi tiết lead.
  if (!isConvertV2Enabled()) redirect(`/leads/${id}`)

  const canConvert =
    (await checkPermission('students:create')) && (await checkPermission('enrollments:create'))
  if (!canConvert) redirect(`/leads/${id}`)

  const actor = await resolveActor(session.user.id)
  const sdb = scopedDb(actor)
  const lead = await sdb.lead.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      parentName: true,
      phone: true,
      email: true,
      status: true,
      convertedAt: true,
      centerId: true,
      assignedToId: true,
      childName: true,
      // Khoá quan tâm ở CẤP LEAD — dùng làm mặc định cho em chưa tự khai (xem
      // `khoaCuaEm` bên dưới).
      courseId: true,
      children: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, fullName: true, dob: true, interestedCourseId: true },
      },
    },
  })
  if (!lead) notFound()

  // 27/09/2026 — lead ĐÃ chuyển đổi: chỉ bày bé CHƯA thành học viên (bé thứ hai…). Bày cả
  // bé đã vào học là mời Sale chốt trùng — server cũng từ chối, nhưng đừng vẽ lời hứa suông.
  if (lead.convertedAt) {
    const duoc = new Set(await docConChuyenDoiDuoc(sdb, lead.id, lead.convertedAt))
    lead.children = lead.children.filter((c) => duoc.has(c.id))
    if (lead.children.length === 0) redirect(`/leads/${lead.id}`)
  }

  // Scope: SALE (chỉ view-own) chỉ thao tác lead của mình.
  if (!(await checkPermission('leads:view-all', { centerId: lead.centerId })) && lead.assignedToId !== session.user.id) {
    redirect('/leads?view=kanban')
  }

  // S-1 — che PII trước khi dựng giao diện. Cổng vào đây là `students:create` +
  // `enrollments:create`, mà Quản lý cơ sở có CẢ HAI trong khi KHÔNG còn
  // `leads:view-pii` (Q9) ⇒ trước S-1 màn này in nguyên tên + SĐT khách.
  const canViewPii = await canViewLeadPii()
  const piiLead = maskLeadPiiFields(lead, canViewPii)

  // ⚠️ Ô ĐIỀN SẴN thì để TRỐNG, KHÔNG điền bản che.
  //
  // Đây là chỗ dễ làm sai nhất của cả việc này. `submitConvertV2` nhận thẳng
  // `parentName`/`parentPhone` từ trình duyệt. SĐT còn có lưới đỡ — schema validate
  // bằng `phoneVn` (canonical) nên "090xxxx456" bị từ chối. TÊN thì KHÔNG có lưới
  // nào: điền sẵn "Nguyễn T. L." rồi bấm Lưu là tạo ra một phụ huynh mang đúng cái
  // tên đã đục, im lặng, và không ai phát hiện cho tới lúc gọi tên khách.
  //
  // Để trống là hỏng SỚM và hỏng TO: form chặn ngay ("Nhập đủ tên và SĐT phụ
  // huynh"). Người chốt đang ngồi với khách nên hỏi miệng là có — họ mất quyền đọc
  // SĐT trong CRM, không mất khả năng nghe khách đọc số.
  const dienSan = canViewPii
    ? { ten: lead.parentName, email: lead.email ?? '', sdt: lead.phone }
    : { ten: '', email: '', sdt: '' }

  // Tóm tắt thanh toán (đã nộp / tổng phải thu / còn thiếu) + điều kiện chốt.
  const paymentSummary = await getLeadPaymentSummary(sdb, lead.id)

  // ⚠️ 31/08/2026 — truy vấn `courseOrder` ĐÃ GỠ cùng khối "Học phí" của form: nó chỉ
  // phục vụ ô chia 1/2 đợt, mà việc đó nay chốt ở trang đơn hàng. Giữ lại là một câu
  // query chạy mỗi lần mở trang cho một prop không ai đọc.

  // Lớp đang mở (ưu tiên cùng cơ sở lead) + giá khoá để snapshot.
  const classes = await sdb.class.findMany({
    where: {
      deletedAt: null,
      status: { in: ['PLANNED', 'RECRUITING', 'ACTIVE'] },
      ...(lead.centerId ? { centerId: lead.centerId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      name: true,
      classCode: true,
      courseId: true,
      course: { select: { id: true, name: true, price: true } },
    },
  })

  const classOptions = classes.map((c) => ({
    id: c.id,
    label: c.classCode ? `${c.classCode} · ${c.name}` : c.name,
    courseId: c.courseId,
    courseName: c.course?.name ?? '',
    listPrice: c.course?.price ?? 0,
  }))

  // Tên khoá quan tâm của từng em. Phải tra RIÊNG vì `LeadChild.interestedCourseId`
  // là tham chiếu lỏng, không có FK sang `Course` (xem schema.prisma:1606).
  //
  // Không lấy tên từ `classOptions` được: đúng ca cần nói tên nhất là ca khoá đó
  // KHÔNG có lớp nào đang mở — lúc ấy `classOptions` rỗng khoá đó và câu báo sẽ
  // trống chỗ tên khoá.
  // Gồm CẢ khoá cấp lead: nó là mặc định cho em chưa tự khai, và câu báo "cơ sở
  // chưa mở lớp nào thuộc khoá X" cần đúng tên khoá đó.
  const khoaQuanTamIds = [
    ...new Set(
      [...lead.children.map((c) => c.interestedCourseId), lead.courseId].filter(
        Boolean,
      ) as string[],
    ),
  ]
  const tenKhoaById = new Map(
    khoaQuanTamIds.length
      ? (
          await sdb.course.findMany({
            where: { id: { in: khoaQuanTamIds } },
            select: { id: true, name: true },
          })
        ).map((c) => [c.id, c.name])
      : [],
  )

  /**
   * KHOÁ QUAN TÂM DÙNG ĐỂ LỌC LỚP của một em (chủ dự án chốt 03/09/2026).
   *
   * Ưu tiên khoá của CHÍNH EM (`LeadChild.interestedCourseId`) — hai em cùng phụ
   * huynh thường hỏi hai khoá khác nhau theo tuổi. Em chưa tự khai thì rơi về
   * khoá của LEAD (`Lead.courseId`).
   *
   * Vì sao cần vế rơi về: phần lớn lead thật chưa có khoá ở cấp con. Lead từ web
   * mang khoá ở cấp lead (suy từ slug trang khách vào), lead nhập tay trước
   * 03/09 cũng vậy. Không có vế này thì ô "Lớp đăng ký" của những em đó rơi về
   * "hiện đủ mọi lớp" — tức bộ lọc vừa làm gần như không bao giờ chạy, và người
   * chốt lại phải tự dò đúng lớp trong danh sách 33 lớp.
   */
  const khoaCuaEm = (interestedCourseId: string | null) =>
    interestedCourseId ?? lead.courseId ?? ''

  const prefillStudents = (lead.children.length > 0
    ? lead.children.map((c) => {
        const khoa = khoaCuaEm(c.interestedCourseId)
        return {
          leadChildId: c.id,
          name: c.fullName,
          dob: c.dob ? c.dob.toISOString().slice(0, 10) : '',
          courseId: khoa,
          courseName: khoa ? (tenKhoaById.get(khoa) ?? '(khoá đã xoá)') : '',
        }
      })
    : [
        {
          leadChildId: null,
          name: lead.childName ?? '',
          dob: '',
          courseId: khoaCuaEm(null),
          courseName: lead.courseId
            ? (tenKhoaById.get(lead.courseId) ?? '(khoá đã xoá)')
            : '',
        },
      ]
  )

  return (
    <div className="max-w-4xl p-6">
      <Link
        href={`/leads/${lead.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Quay lại lead
      </Link>

      <div className="mb-6 border-b border-border pb-4">
        <h1 className="text-2xl font-bold text-foreground">Chuyển đổi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {piiLead.parentName} · {formatPhoneVN(piiLead.phone)}
          {piiLead.email ? ` · ${piiLead.email}` : ''} · Trạng thái:{' '}
          <span className="font-medium">{LEAD_STATUS_LABEL[lead.status] ?? lead.status}</span>
        </p>
      </div>

      {/* Khối thanh toán: đã nộp / tổng phải thu / còn thiếu + điều kiện chốt. */}
      <div className="mb-6">
        <LeadPaymentCard
          leadId={lead.id}
          summary={paymentSummary}
          canCreateOrder={await checkPermission('orders:create')}
        />
      </div>

      {/* `conflictHref` truyền tường minh: màn gộp hồ sơ trùng là của khu quản
          trị, và chỗ gọi mới là chỗ biết khu mình có màn đó hay không. */}
      {!canViewPii && (
        <p className="mb-4 rounded-xl border border-amber-500/40 bg-card p-4 text-sm text-muted-foreground">
          <strong className="text-amber-600 dark:text-amber-500">
            Bạn không có quyền xem liên hệ của khách
          </strong>
          {' — '}ô Tên và SĐT phụ huynh để trống, xin khách đọc rồi nhập tay. Đừng
          chép lại chuỗi đã che ở dòng trên: nó không phải thông tin thật.
        </p>
      )}

      <ConvertForm
        conflictHref="/convert-conflicts"
        // Ô "Miễn phí học bổng toàn phần" CHỈ hiện với Quản trị tối cao (chốt 31/08/2026).
        // Đây là lớp giao diện; cổng thật ở `submitConvertV2` — Server Action là endpoint
        // HTTP riêng nên giấu ô không phải là chặn.
        canGrantScholarship={canGrantFullScholarship(actor)}
        leadId={lead.id}
        defaultParentName={dienSan.ten}
        defaultParentEmail={dienSan.email}
        defaultParentPhone={formatPhoneVN(dienSan.sdt)}
        prefillStudents={prefillStudents}
        classes={classOptions}
      />
    </div>
  )
}
