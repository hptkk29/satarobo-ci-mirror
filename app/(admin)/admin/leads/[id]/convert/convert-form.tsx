'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { HelpHint } from '@/components/admin/ui/help-hint'
import { submitConvertV2 } from './actions'

type ClassOpt = {
  id: string
  label: string
  courseId: string
  courseName: string
  listPrice: number
}

/**
 * ⚠️ 31/08/2026 — GỠ khung "Ưu đãi học phí" khỏi màn chốt.
 *
 * Trước đó mỗi em có một ô chọn NONE/FREE/PERCENT/AMOUNT + ô nhập mức + ô lý do, và
 * KHÔNG vai nào bị chặn: ai chốt được lead là giảm học phí bao nhiêu tuỳ ý. Chủ dự án
 * chốt bỏ hẳn giảm theo %/số tiền ở đây, chỉ giữ MỘT ô tick "miễn phí học bổng toàn
 * phần" và chỉ Quản trị tối cao mới thấy.
 *
 * Ô tick vẫn là lối tắt của SCHOLARSHIP 100% — đúng ca mà trước đây không chốt nổi:
 * tổng sau ưu đãi = 0 ⇒ guard tiền tự thoả, khỏi phải bịa một khoản thu để lách (khoản
 * 0đ thì hệ thống chặn, khoản khống thì sai sổ).
 */

type StudentRow = {
  key: string
  leadChildId: string | null
  name: string
  dob: string
  /**
   * Khoá QUAN TÂM của em này (`LeadChild.interestedCourseId`). Rỗng = phiếu chưa
   * ghi khoá nào, hoặc em được thêm tay ở màn này.
   *
   * Giữ trong hàng vì ô "Lớp đăng ký" lọc THEO TỪNG EM: hai em cùng một phiếu có
   * thể quan tâm hai khoá khác nhau, nên không có một danh sách lớp chung nào đúng
   * cho cả bảng.
   */
  courseId: string
  /** Tên khoá quan tâm — chỉ để hiện trong câu báo khi khoá đó chưa có lớp nào. */
  courseName: string
  classId: string
  consentMedia: boolean
  /** Miễn phí học bổng toàn phần. Chỉ Quản trị tối cao thấy ô này (`canGrantScholarship`). */
  scholarship: boolean
}

const inputCls =
  'w-full rounded-lg border border-border px-3 py-1.5 text-sm focus:border-state-success focus:outline-none focus:ring-1 focus:ring-state-success'

function newKey() {
  return Math.random().toString(36).slice(2)
}

export function ConvertForm({
  leadId,
  defaultParentName,
  defaultParentEmail,
  defaultParentPhone,
  prefillStudents,
  classes,
  canGrantScholarship,
  backHref,
  conflictHref,
}: {
  leadId: string
  /**
   * Nơi quay về sau khi chốt xong. Mặc định `/leads/<id>` — đường CLEAN-URL của site
   * admin. Site Sale (`app/(sale)/`) phải truyền đường của nó, không thì chốt xong là
   * ném người dùng sang host khác, tức ra khỏi site của họ. (Giữ lại khi hợp nhất
   * `main` → `test` 16/09/2026: bản `main` chưa có hai prop này.)
   */
  backHref?: string
  /** Đường tới màn xử lý phiếu trùng; `null` ⇒ dùng đường mặc định của site admin. */
  conflictHref?: string | null
  /**
   * Người đang chốt có phải Quản trị tối cao không (chốt 31/08/2026).
   * `false` ⇒ KHÔNG vẽ ô "Miễn phí học bổng toàn phần". Đây chỉ là lớp giao diện —
   * cổng thật nằm ở `submitConvertV2` (Server Action là endpoint HTTP riêng).
   */
  canGrantScholarship: boolean
  defaultParentName: string
  defaultParentEmail: string
  defaultParentPhone: string
  prefillStudents: {
    leadChildId: string | null
    name: string
    dob: string
    courseId: string
    courseName: string
  }[]
  classes: ClassOpt[]
  /** FL2-01 — đơn hàng học phí gắn lead (để chia 1/2 đợt). null = chưa có đơn. */
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [conflict, setConflict] = useState<string | null>(null)
  const veLai = backHref ?? `/leads/${leadId}`

  const [parentName, setParentName] = useState(defaultParentName)
  const [parentEmail, setParentEmail] = useState(defaultParentEmail)
  const [parentPhone, setParentPhone] = useState(defaultParentPhone)
  // C5 — CCCD + địa chỉ phụ huynh (lưu trên tài khoản phụ huynh, KHÔNG lưu trên học viên).
  const [parentCccd, setParentCccd] = useState('')
  const [parentAddress, setParentAddress] = useState('')
  const [parentWard, setParentWard] = useState('')
  const [parentCity, setParentCity] = useState('')

  // FL2-01 — kế hoạch học phí. Chỉ áp dụng khi có Order với tổng > 0.

  // Lý do ưu đãi — BẮT BUỘC khi có giảm (server chặn lại lần nữa, đây chỉ là chặn sớm).

  const [students, setStudents] = useState<StudentRow[]>(() =>
    (prefillStudents.length ? prefillStudents : [{ leadChildId: null, name: '', dob: '', courseId: '', courseName: '' }]).map(
      (s) => {
        // Prefill class: nếu con có khoá quan tâm, chọn lớp đầu tiên của khoá đó.
        const cls = s.courseId ? classes.find((c) => c.courseId === s.courseId) : undefined
        return {
          key: newKey(),
          leadChildId: s.leadChildId,
          name: s.name,
          dob: s.dob,
          courseId: s.courseId,
          courseName: s.courseName,
          classId: cls?.id ?? '',
          consentMedia: false,
          scholarship: false,
        }
      },
    ),
  )

  /**
   * LỚP ĐƯỢC CHỌN CHO MỘT EM — chỉ lớp thuộc KHOÁ QUAN TÂM của em đó
   * (chủ dự án chốt 03/09/2026).
   *
   * Trước đợt này ô lớp liệt kê MỌI lớp đang mở tại cơ sở, trong khi phần điền sẵn
   * đã tự chọn lớp đúng khoá — nên chỉ cần lỡ tay đổi ô là ghi danh em vào một khoá
   * khác hẳn khoá phụ huynh hỏi, và học phí lấy theo giá lớp mới. Sai kiểu đó không
   * báo lỗi ở đâu cả: nó thành công nợ đúng số tiền của một khoá không ai đặt.
   *
   * Em CHƯA có khoá quan tâm (phiếu không ghi, hoặc em thêm tay ở màn này) thì hiện
   * đủ mọi lớp — lọc về rỗng ở đây là chặn luôn việc chốt mà không nói vì sao.
   */
  const lopChoEm = (courseId: string) =>
    courseId ? classes.filter((c) => c.courseId === courseId) : classes

  const priceOf = (classId: string) => classes.find((c) => c.id === classId)?.listPrice ?? 0
  const sumListPrice = students.reduce((n, r) => n + priceOf(r.classId), 0)
  // Học bổng toàn phần = giảm ĐÚNG BẰNG giá lớp của em đó. Không còn %/số tiền nên
  // không cần hàm ước tính riêng nữa.
  const sumDiscount = students.reduce(
    (n, r) => n + (r.scholarship ? priceOf(r.classId) : 0),
    0,
  )
  const sumFinal = Math.max(0, sumListPrice - sumDiscount)
  const hasDiscount = sumDiscount > 0
  // Miễn phí toàn phần: tổng sau ưu đãi = 0 ⇒ guard tiền tự thoả, không cần khoản thu.
  const allFree = hasDiscount && sumFinal === 0

  function patch(key: string, p: Partial<StudentRow>) {
    setStudents((rows) => rows.map((r) => (r.key === key ? { ...r, ...p } : r)))
  }

  function addStudent() {
    setStudents((rows) => [
      ...rows,
      {
        key: newKey(),
        leadChildId: null,
        name: '',
        dob: '',
        // Em thêm tay ở màn này không có khoá quan tâm trên phiếu ⇒ để trống, và
        // ô lớp sẽ hiện đủ mọi lớp đang mở (xem `lopChoEm`).
        courseId: '',
        courseName: '',
        classId: '',
        consentMedia: false,
        scholarship: false,
      },
    ])
  }

  function removeStudent(key: string) {
    setStudents((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows))
  }

  function submit() {
    // AUTH-SĐT P5 — SĐT là định danh bắt buộc, email tuỳ chọn (kênh dự phòng).
    if (!parentName.trim() || !parentPhone.trim()) {
      toast.error('Nhập đủ tên và SĐT phụ huynh')
      return
    }
    if (students.some((s) => !s.name.trim() || !s.classId)) {
      toast.error('Mỗi học viên cần tên + lớp')
      return
    }
    setConflict(null)
    startTransition(async () => {
      const res = await submitConvertV2(leadId, {
        parentName: parentName.trim(),
        parentEmail: parentEmail.trim(),
        parentPhone: parentPhone.trim(),
        parentCccd: parentCccd.trim(),
        parentAddress: parentAddress.trim(),
        parentWard: parentWard.trim(),
        parentCity: parentCity.trim(),
        students: students.map((s) => ({
          leadChildId: s.leadChildId,
          name: s.name.trim(),
          dob: s.dob || '',
          classId: s.classId,
          consentMedia: s.consentMedia,
          scholarship: s.scholarship,
        })),
      })
      if (res.ok) {
        toast.success(
          `Đã chuyển đổi: ${res.studentIds.length} học viên · ${res.enrollmentIds.length} đăng ký` +
            (res.deduped ? ' (đã xử lý trùng / idempotent)' : ''),
        )
        router.push(veLai)
        router.refresh()
        return
      }
      // Lỗi nghiệp vụ — hiển thị rõ ràng.
      if (res.code === 'PARENT_CONFLICT') {
        setConflict(res.error)
        toast.error('Xung đột hồ sơ phụ huynh — chuyển Admin xử lý')
        return
      }
      if (res.code === 'PAYMENT_REQUIRED') {
        // 31/08 — khối "Ưu đãi học phí" đã gỡ, nên câu hướng dẫn cũ (chỉ người dùng tới
        // một khối không còn tồn tại) phải đổi. Hai đường ra khác nhau theo vai, nói
        // đúng đường của người đang đọc.
        toast.error(
          canGrantScholarship
            ? 'Chưa đủ điều kiện chốt: cần ghi nhận thanh toán trước. Nếu em này được cấp học bổng toàn phần, tick ô "Miễn phí học bổng toàn phần" của em đó rồi chốt lại.'
            : 'Chưa đủ điều kiện chốt: cần ghi nhận thanh toán trước. Nếu em này được miễn học phí, nhờ Quản trị tối cao cấp học bổng toàn phần.',
        )
        return
      }
      toast.error(res.error || 'Lỗi chuyển đổi')
    })
  }

  return (
    <div className="space-y-6">
      {conflict && (
        <div className="flex items-start gap-2 rounded-xl border border-state-danger bg-state-danger-soft p-4 text-sm text-state-danger-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Xung đột hồ sơ phụ huynh</p>
            <p>{conflict}</p>
            <a href={conflictHref ?? "/convert-conflicts"} className="mt-1 inline-block font-medium underline">
              Mở màn xử lý xung đột →
            </a>
          </div>
        </div>
      )}

      {/* Phụ huynh */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Phụ huynh</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Họ tên *</span>
            <input value={parentName} onChange={(e) => setParentName(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Email <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              <HelpHint>
                Chỉ là kênh dự phòng. Bỏ trống cũng không sao — thông báo và mã kích hoạt
                đi theo số điện thoại.
              </HelpHint>
            </span>
            <input
              type="email"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              placeholder="Bỏ trống nếu phụ huynh không dùng email"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              SĐT * (tài khoản đăng nhập)
              <HelpHint>
                Chính là tên đăng nhập của phụ huynh vào cổng học viên, và là số nhận mã
                kích hoạt qua Zalo. Gõ sai một chữ số là phụ huynh không vào được — sửa
                lại phải nhờ quản trị.
              </HelpHint>
            </span>
            <input value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">CCCD / CMND</span>
            <input
              value={parentCccd}
              onChange={(e) => setParentCccd(e.target.value)}
              placeholder="9 hoặc 12 chữ số"
              className={inputCls}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Địa chỉ</span>
            <input
              value={parentAddress}
              onChange={(e) => setParentAddress(e.target.value)}
              placeholder="Số nhà, đường…"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Tỉnh / Thành</span>
            <input value={parentCity} onChange={(e) => setParentCity(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Phường / Xã</span>
            <input value={parentWard} onChange={(e) => setParentWard(e.target.value)} className={inputCls} />
          </label>
        </div>
      </div>

      {/* Học viên (multi) */}
      <div className="space-y-4">
        {students.map((s, idx) => {
          return (
            <div key={s.key} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  Học viên {idx + 1}
                  {s.leadChildId && <span className="ml-2 text-xs text-muted-foreground">(từ lead)</span>}
                </h3>
                {students.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStudent(s.key)}
                    className="inline-flex items-center gap-1 text-xs text-state-danger-ink hover:text-state-danger-ink"
                  >
                    <Trash2 size={14} /> Xoá
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Tên học viên *</span>
                  <input
                    value={s.name}
                    onChange={(e) => patch(s.key, { name: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Ngày sinh</span>
                  <input
                    type="date"
                    value={s.dob}
                    onChange={(e) => patch(s.key, { dob: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    Lớp đăng ký *
                    <HelpHint>
                      {s.courseId
                        ? "Chỉ hiện lớp thuộc KHOÁ QUAN TÂM ghi trên phiếu của em này. Chốt xong bé vào thẳng lớp này và học phí của lớp thành công nợ của phụ huynh — đổi lớp sau phải làm ở màn Lớp học."
                        : "Phiếu chưa ghi khoá quan tâm cho em này nên danh sách hiện đủ lớp đang mở tại cơ sở. Chốt xong bé vào thẳng lớp này và học phí của lớp thành công nợ của phụ huynh."}
                    </HelpHint>
                  </span>
                  <select
                    value={s.classId}
                    onChange={(e) => patch(s.key, { classId: e.target.value })}
                    className={inputCls}
                    disabled={lopChoEm(s.courseId).length === 0}
                  >
                    <option value="">— Chọn lớp —</option>
                    {lopChoEm(s.courseId).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} · {c.courseName} ({c.listPrice.toLocaleString('vi-VN')}đ)
                      </option>
                    ))}
                  </select>
                  {/* Ô rỗng mà không nói gì là chỗ người dùng đọc thành "hệ thống hỏng".
                      Chỉ hiện khi CÓ lớp ở cơ sở nhưng không lớp nào đúng khoá — ca
                      "chưa có lớp nào cả" đã có dòng cảnh báo chung ở cuối form. */}
                  {s.courseId && classes.length > 0 && lopChoEm(s.courseId).length === 0 && (
                    <span className="mt-1 block text-xs text-state-warning-ink">
                      Cơ sở này chưa mở lớp nào thuộc khoá{" "}
                      <strong>{s.courseName}</strong> — mở lớp ở mục Lớp học, hoặc
                      sửa khoá quan tâm của em trên phiếu lead.
                    </span>
                  )}
                </label>
              </div>
              {/* ⚠️ 31/08/2026 — khung "Ưu đãi học phí" ĐÃ GỠ (ô chọn %/số tiền + ô lý do).
                  Còn lại ĐÚNG một ô tick học bổng toàn phần, và chỉ Quản trị tối cao
                  thấy. Vai khác không render gì ⇒ `s.scholarship` giữ nguyên `false`,
                  payload gửi lên y hệt trước khi có tính năng này. */}
              {canGrantScholarship && (
                <label className="mt-3 flex items-start gap-2 rounded-lg border border-state-warning bg-state-warning-soft p-3 text-sm text-state-warning-ink">
                  <input
                    type="checkbox"
                    checked={s.scholarship}
                    onChange={(e) => patch(s.key, { scholarship: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-border"
                  />
                  <span>
                    <strong>Miễn phí học bổng toàn phần</strong> — học phí của em này về 0đ.
                    {s.classId && (
                      <>
                        {' '}Giá lớp{' '}
                        <strong>{priceOf(s.classId).toLocaleString('vi-VN')}đ</strong>
                        {s.scholarship && ' → 0đ'}.
                      </>
                    )}
                    {s.scholarship && (
                      <span className="mt-1 block text-xs">
                        Chốt được ngay, không cần ghi nhận thanh toán. Tên bạn và thời điểm
                        cấp được lưu vào nhật ký.
                      </span>
                    )}
                  </span>
                </label>
              )}

              <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={s.consentMedia}
                  onChange={(e) => patch(s.key, { consentMedia: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-border"
                />
                <span>
                  Phụ huynh đồng ý cho trung tâm sử dụng hình ảnh/video của học viên trong lớp cho mục
                  đích lưu trữ & truyền thông (NĐ 13/2023). Người tick &amp; thời điểm sẽ được ghi nhật ký.
                </span>
              </label>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={addStudent}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
      >
        <Plus size={14} /> Thêm học viên
      </button>

      {classes.length === 0 && (
        <p className="text-xs text-state-warning-ink">
          Chưa có lớp nào đang mở (cùng cơ sở lead). Tạo lớp ở mục Lớp học trước khi chốt.
        </p>
      )}

      {/* ⚠️ 31/08/2026 — khung "Ưu đãi học phí" (tổng + ô lý do) ĐÃ GỠ theo chốt của chủ
          dự án. Lý do ghi nhật ký nay do SERVER tự dựng kèm tên người cấp, không còn ô
          để gõ. Giữ lại đúng MỘT dòng xác nhận khi toàn bộ học viên được miễn phí: đó là
          thông tin quyết định việc bấm Chốt (không cần ghi nhận thanh toán), bỏ đi thì
          người chốt không biết vì sao mình qua được cổng tiền. */}
      {allFree && (
        <p className="rounded-lg border border-state-success bg-state-success-soft px-3 py-2 text-sm font-medium text-state-success-ink">
          ✓ Miễn phí học bổng toàn phần — chốt được ngay, không cần ghi nhận thanh toán.
        </p>
      )}

      {/* ⚠️ 31/08/2026 — khối "Học phí" (1 đợt / 2 đợt + số tiền đợt 1 + hạn đợt 2) ĐÃ GỠ.
          Chốt của chủ dự án: học phí đã chốt ở TRANG ĐƠN HÀNG rồi, để lại đây là hỏi
          cùng một câu ở hai chỗ. Năng lực không mất: `recordInstallmentPlan` và
          `requestInstallmentApproval` vẫn chạy từ /orders (orders/_actions.ts:959 và
          order-detail-client.tsx) — đó nay là NƠI DUY NHẤT khai kế hoạch đợt, nên không
          còn chuyện hai màn ghi đè nhau. */}

      <div className="flex gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={submit}
          disabled={pending || classes.length === 0}
          className="rounded-lg bg-state-success-ink px-4 py-2 text-sm font-semibold text-white hover:bg-state-success-ink-hover disabled:opacity-50"
        >
          {pending ? 'Đang xử lý…' : 'Xác nhận chuyển đổi'}
        </button>
        <button
          type="button"
          onClick={() => router.push(veLai)}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Hủy
        </button>
        {/* Hệ quả của việc chốt nằm ở NÚT chứ không ở ô nào — đặt "?" ngay cạnh nút để
            người chốt đọc được trước khi bấm. */}
        <HelpHint className="self-center [&_svg]:size-4" label="Chốt lead nghĩa là gì">
          Bấm chốt là hệ thống tạo hồ sơ học viên, ghi danh vào lớp đã chọn và tạo tài
          khoản phụ huynh ở trạng thái chờ kích hoạt; lead chuyển sang &ldquo;đã chuyển
          đổi&rdquo;. Lỡ bấm hai lần cũng không tạo trùng, nhưng gỡ ra thì phải nhờ quản
          trị — kiểm lại tên bé, lớp và số tiền trước khi bấm.
        </HelpHint>
      </div>
    </div>
  )
}
