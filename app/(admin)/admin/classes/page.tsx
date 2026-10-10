import Link from 'next/link'
import { FileSpreadsheet, Plus } from 'lucide-react'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { scopedDb } from '@/lib/db-scope'
import { resolveActor } from '@/lib/auth/actor'
import { checkPermission } from '@/lib/auth/check-permission'
import type { ClassStatus } from '@prisma/client'
import { ENROLLMENT_ACTIVE_STATUS_LIST } from '@/lib/enrollment-status'
import { getAssignableTeachers } from '@/lib/teachers/assignable'
import { getCenterOptions, type CenterOption } from '@/lib/org/center-options'
import { ClassDeleteButton } from './_components/class-delete-button'
import { ClassFilters } from './_components/class-filters'
import { ClassExportDialog } from './_components/class-export-dialog'
import {
  CLASS_STATUS_LABEL,
  buildClassOrderBy,
  buildClassWhere,
  matchesFill,
  parseClassListFilters,
  toClassListQuery,
} from '@/lib/classes/list-filter'
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

const STATUS_COLOR: Record<ClassStatus, string> = {
  PLANNED: 'bg-muted text-foreground',
  RECRUITING: 'bg-state-warning-soft text-state-warning-ink',
  PENDING_APPROVAL: 'bg-primary-soft text-primary',
  ACTIVE: 'bg-state-success-soft text-state-success-ink',
  COMPLETED: 'bg-state-info-soft text-state-info-ink',
  CANCELLED: 'bg-state-danger-soft text-state-danger-ink',
}

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

function formatDate(date: Date | null) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function ScheduleBadge({
  days,
  startTime,
  endTime,
}: {
  days: number[]
  startTime: string | null
  endTime: string | null
}) {
  if (!days || days.length === 0) return <span className="text-muted-foreground">—</span>
  const daysText = [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d] ?? '')
    .filter(Boolean)
    .join(' · ')
  const time = startTime && endTime ? `${startTime}–${endTime}` : ''
  return (
    <span className="whitespace-nowrap text-xs">
      <span className="font-medium">{daysText}</span>
      {time && <span className="ml-1 text-muted-foreground">{time}</span>}
    </span>
  )
}

interface SearchParams {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ClassesPage({ searchParams }: SearchParams) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const actor = await resolveActor(session.user.id)
  // 18/08 — Đào tạo vào được DANH SÁCH lớp để đi tiếp vào tab "Đánh giá & Nhận xét"
  // của từng lớp. Không có quyền này thì màn nhận xét có tồn tại cũng không ai tới được.
  // Chỉ là lối đi: nút Thêm/Sửa/Xoá vẫn gác riêng bằng classes:create/edit/delete.
  // Ba lời gọi để NGUYÊN trong điều kiện — bất biến menu≡gate (page-gates.test) đọc
  // tĩnh chính chỗ này; gán ra biến trước là gate "tàng hình" với test.
  if (
    !(await checkPermission('classes:view-all')) &&
    !(await checkPermission('classes:view-own')) &&
    !(await checkPermission('session-feedback:view-all'))
  ) {
    redirect('/dashboard')
  }

  const canCreate = await checkPermission('classes:create')
  const canUpdate = await checkPermission('classes:edit')
  const canDelete = await checkPermission('classes:delete')
  // "Chi tiết" hiện cho MỌI người xem được danh sách: cổng của trang danh sách
  // (classes:view-all | view-own | session-feedback:view-all) là TẬP CON của cổng
  // trang chi tiết, nên ai vào được đây thì chắc chắn mở được /classes/<id>.
  // Trước 04/09 cả cột Hành động treo sau canUpdate || canDelete, nên Sale và Quản
  // lý lớp học không thấy nút nào — phải dán tay URL mới vào xem lớp được.

  // 24/09 — điều kiện lọc đi qua `lib/classes/list-filter.ts`, DÙNG CHUNG với route
  // xuất Excel: màn và file không bao giờ lệch nhau về "những lớp nào".
  const filters = parseClassListFilters(await searchParams)
  const filterQuery = toClassListQuery(filters)

  const hasViewAll = await checkPermission('classes:view-all')
  const hasViewOwn = await checkPermission('classes:view-own')
  const viewOwnOnly = !hasViewAll && hasViewOwn
  // Kèm liên hệ phụ huynh khi xuất — cùng cổng với màn danh sách học viên.
  const canParentContact = await checkPermission('students:view-all')

  // Truy vấn BỎ điều kiện trạng thái để đếm số lớp cho từng chip trạng thái; lọc trạng
  // thái làm trong bộ nhớ ngay dưới (danh sách vốn tải trọn, phân trang ở tầng hiển thị).
  const where = buildClassWhere(
    { ...filters, statuses: [] },
    { forceTeacherId: viewOwnOnly ? session.user.id : null },
  )

  const [allClasses, centers, courses, teachers] = await Promise.all([
    scopedDb(actor).class
      .findMany({
        where,
        orderBy: buildClassOrderBy(filters.sort),
        select: {
          id: true,
          classCode: true,
          name: true,
          status: true,
          startDate: true,
          scheduleDays: true,
          startTime: true,
          endTime: true,
          maxStudents: true,
          course: { select: { name: true } },
          center: { select: { name: true } },
          room: { select: { code: true } },
          teacher: { select: { name: true } },
          _count: {
            select: {
              enrollments: { where: { status: { in: ENROLLMENT_ACTIVE_STATUS_LIST }, deletedAt: null } },
              sessions: true,
            },
          },
        },
      })
      .catch(() => []),
    // 03/09 — ô lọc cơ sở đi qua helper chung: bản cũ bày cả Hội sở (không dạy lớp),
    // các dòng Center mồ côi của bộ test, và không cắt theo tầm nhìn người dùng.
    getCenterOptions(actor).catch(() => [] as CenterOption[]),
    scopedDb(actor).course
      .findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
      .catch(() => [] as Array<{ id: string; name: string }>),
    // Fix #9 — bộ lọc GV dùng chung nguồn assignable (không lọt quản lý/sale thuần).
    // R2-RBAC-3 — chỉ GV thuộc cơ sở actor nhìn thấy (CS1 không lọt GV CS2 vào filter).
    // 06/08 - GV la nguon luc chung (Hoi so dieu di moi co so): KHONG loc danh
    // sach theo co so nua, neu khong CS2 khong bao gio toi duoc form va bo loc
    // phia client co mo cung vo nghia.
    getAssignableTeachers({}).catch(
      () => [] as Array<{ id: string; name: string | null }>,
    ),
  ])

  const statusCounts: Record<string, number> = {}
  const fillMatched = allClasses.filter((c) =>
    matchesFill(c._count.enrollments, c.maxStudents, filters.fill),
  )
  for (const c of fillMatched) statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1
  const classes =
    filters.statuses.length > 0
      ? fillMatched.filter((c) => filters.statuses.includes(c.status))
      : fillMatched

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lớp học</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {classes.length > 0 ? `${classes.length} lớp` : 'Chưa có lớp nào'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate && (
            <>
              <Link
                href="/classes/new"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Thêm lớp
              </Link>
              <Link
                href="/classes/import"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Import Excel
              </Link>
            </>
          )}
          {/* 24/09 — nút "Kiểm tra lịch buổi" GỠ theo yêu cầu chủ dự án (màn vẫn còn, xem
              ALLOWLIST của nav-coverage). Xuất Excel hiện cho MỌI người xem được danh sách:
              route gác cùng cổng và chỉ xuất đúng những lớp người đó đang thấy. */}
          <ClassExportDialog
            filterQuery={filterQuery}
            classCount={classes.length}
            canParentContact={canParentContact}
          />
        </div>
      </div>

      {/* Filters — client-side nav + pending indicator (Lỗi 1 QA 20/07) */}
      <ClassFilters
        initial={filters}
        statusCounts={statusCounts}
        showTeacher={!viewOwnOnly}
        centers={centers.map((c) => ({ value: c.id, label: c.name }))}
        courses={courses.map((c) => ({ value: c.id, label: c.name }))}
        teachers={teachers.map((t) => ({
          value: t.id,
          label: t.name ?? '(chưa đặt tên)',
        }))}
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* khoaTrang gắn với bộ lọc: quay lại từ trang chi tiết là về đúng trang đang xem. */}
        <PhanTrangBang
          cuonNgang
          tenDonVi="lớp"
          khoaTrang={`classes?${filterQuery}`}
          classThanh="flex-wrap px-4 pb-3"
        >
          {/* min-w: khung hẹp thì bảng CUỘN NGANG (PhanTrangBang cuonNgang) thay vì ép cột —
              24/09 ép cột làm tên lớp gãy 5 dòng và cột Trạng thái bị cắt. */}
          <table className="w-full min-w-[1100px] divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tên lớp
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Khoá học
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cơ sở / Phòng
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Lịch
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  GV chính
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Sức chứa
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Khai giảng
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Trạng thái
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {classes.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    {allClasses.length === 0 && !filterQuery
                      ? 'Chưa có lớp nào'
                      : 'Không có lớp nào khớp bộ lọc'}
                  </td>
                </tr>
              ) : (
                classes.map((cls) => {
                  const statusInfo = {
                    label: CLASS_STATUS_LABEL[cls.status] ?? cls.status,
                    color: STATUS_COLOR[cls.status] ?? 'bg-muted text-muted-foreground',
                  }
                  return (
                    <tr key={cls.id} className="hover:bg-muted/60">
                      <td className="px-4 py-3">
                        <div className="min-w-[240px] font-medium text-foreground">{cls.name}</div>
                        {cls.classCode && (
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {cls.classCode}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground max-w-[160px] truncate">
                        {cls.course?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        <div>{cls.center?.name ?? '—'}</div>
                        {cls.room?.code && (
                          <div className="text-xs text-muted-foreground">P. {cls.room.code}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ScheduleBadge
                          days={cls.scheduleDays ?? []}
                          startTime={cls.startTime}
                          endTime={cls.endTime}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {cls.teacher?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-foreground font-semibold">
                        {cls._count.enrollments}/{cls.maxStudents}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-muted-foreground">
                        {formatDate(cls.startDate)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/classes/${cls.id}`}
                            className="rounded-md border border-primary-soft px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                          >
                            Chi tiết
                          </Link>
                          {canUpdate && (
                            <Link
                              href={`/classes/${cls.id}/edit`}
                              className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                            >
                              Sửa
                            </Link>
                          )}
                          {canDelete && (
                            <ClassDeleteButton
                              classId={cls.id}
                              name={cls.name}
                              enrollmentCount={cls._count.enrollments}
                              sessionCount={cls._count.sessions}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  )
}
