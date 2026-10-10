import { auth } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { resolveActor } from '@/lib/auth/actor'
import { scopedDb } from '@/lib/db-scope'
import { JobForm } from '@/components/admin/jobs/job-form'
import { updateJobAction } from '@/app/(admin)/admin/jobs/actions'

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!['SUPER_ADMIN', 'CENTER_MANAGER'].includes(session.user.role)) redirect('/jobs')
  // JobPosting non-scoped → scopedDb pass-through (#03).
  const sdb = scopedDb(await resolveActor(session.user.id))

  const { id } = await params
  const job = await sdb.jobPosting.findUnique({ where: { id } })
  if (!job) notFound()

  const boundAction = updateJobAction.bind(null, job.id)

  return (
    <div>
      <div className="mb-6">
        <Link href="/jobs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Sửa: {job.title}</h1>
          <Link
            href={`/tuyen-dung/${job.slug}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Xem public
          </Link>
        </div>
      </div>

      <JobForm
        action={boundAction}
        mode="edit"
        initialData={{
          slug: job.slug,
          title: job.title,
          department: job.department ?? '',
          location: job.location ?? 'danang',
          type: job.type ?? 'fulltime',
          description: job.description,
          workingHours: job.workingHours,
          experienceLevel: job.experienceLevel,
          responsibilities: job.responsibilities,
          requirements: job.requirements,
          benefits: job.benefits,
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          salaryNote: job.salaryNote,
          status: job.status as never,
          openings: job.openings,
          closesAt: job.closesAt,
          contactEmail: job.contactEmail,
          contactPhone: job.contactPhone,
        }}
      />
    </div>
  )
}
