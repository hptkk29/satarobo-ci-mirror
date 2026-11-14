'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { Pencil, Trash2, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { deleteJobAction, duplicateJobAction, changeJobStatusAction } from '@/app/(admin)/admin/jobs/actions'
import { JOB_STATUS, DEPARTMENTS } from '@/lib/data/job-options'
import type { JobStatus } from '@prisma/client'
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

const STATUS_COLORS: Record<JobStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  OPEN: 'bg-state-success-soft text-state-success-ink',
  CLOSED: 'bg-state-danger-soft text-state-danger-ink',
  ON_HOLD: 'bg-state-warning-soft text-state-warning-ink',
  PAUSED: 'bg-primary-soft text-primary',
}

const STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: 'Bản nháp',
  OPEN: 'Đang tuyển',
  CLOSED: 'Đã đóng',
  ON_HOLD: 'Tạm dừng',
  PAUSED: 'Tạm dừng',
}

interface JobRow {
  id: string
  slug: string
  title: string
  department: string | null
  status: JobStatus
  openings: number
  closesAt: Date | null
  updatedAt: Date
  author: { name: string | null; email: string | null } | null
}

function JobActions({ job, canEdit }: { job: JobRow; canEdit: boolean }) {
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/tuyen-dung/${job.slug}`}
        target="_blank"
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-muted-foreground"
        title="Xem public"
      >
        <ExternalLink className="h-4 w-4" />
      </Link>

      {canEdit && (
        <>
          <Link
            href={`/jobs/${job.id}/edit`}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-muted-foreground"
            title="Sửa"
          >
            <Pencil className="h-4 w-4" />
          </Link>

          <button
            type="button"
            disabled={pending}
            title="Duplicate"
            onClick={() =>
              startTransition(async () => {
                const r = await duplicateJobAction(job.id)
                if (r.ok && r.id) window.location.href = `/jobs/${r.id}/edit`
              })
            }
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-muted-foreground disabled:opacity-40"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          </button>

          <button
            type="button"
            disabled={pending}
            title="Xoá"
            onClick={() => {
              if (!confirm('Xoá JD này? Thao tác không thể hoàn tác.')) return
              startTransition(async () => {
                await deleteJobAction(job.id)
              })
            }}
            className="rounded p-1.5 text-muted-foreground hover:bg-state-danger-soft hover:text-state-danger-ink disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  )
}

function StatusSelect({ job, canEdit }: { job: JobRow; canEdit: boolean }) {
  const [pending, startTransition] = useTransition()

  if (!canEdit) {
    return (
      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[job.status]}`}>
        {STATUS_LABELS[job.status]}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <select
        defaultValue={job.status}
        disabled={pending}
        onChange={(e) =>
          startTransition(async () => {
            await changeJobStatusAction(job.id, e.target.value)
          })
        }
        className={`rounded-full border-0 py-0.5 pl-2.5 pr-6 text-xs font-semibold focus:ring-2 focus:ring-primary-soft ${STATUS_COLORS[job.status]}`}
      >
        {JOB_STATUS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </div>
  )
}

export function JobsAdminTable({ jobs, canEdit }: { jobs: JobRow[]; canEdit: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <PhanTrangBang cuonNgang>
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tiêu đề</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Phòng ban</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trạng thái</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Chỉ tiêu</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hạn nộp</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Người tạo</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cập nhật</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Chưa có tin tuyển dụng nào
                </td>
              </tr>
            ) : (
              jobs.map((job) => {
                const deptLabel = DEPARTMENTS.find((d) => d.value === job.department)?.label ?? job.department ?? '—'
                return (
                  <tr key={job.id} className="hover:bg-muted/60">
                    <td className="px-4 py-3">
                      <div className="max-w-[260px] font-medium text-foreground line-clamp-2">{job.title}</div>
                      <div className="text-xs text-muted-foreground">/tuyen-dung/{job.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{deptLabel}</td>
                    <td className="px-4 py-3">
                      <StatusSelect job={job} canEdit={canEdit} />
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{job.openings}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {job.closesAt ? new Date(job.closesAt).toLocaleDateString('vi-VN') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{job.author?.name ?? job.author?.email ?? '—'}</td>
                    <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                      {new Date(job.updatedAt).toLocaleDateString('vi-VN')}
                    </td>
                    <td className="px-4 py-3">
                      <JobActions job={job} canEdit={canEdit} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  )
}
