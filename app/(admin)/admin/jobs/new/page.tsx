import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { JobForm } from '@/components/admin/jobs/job-form'
import { createJobAction } from '@/app/(admin)/admin/jobs/actions'

export default async function NewJobPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!['SUPER_ADMIN', 'CENTER_MANAGER'].includes(session.user.role)) redirect('/jobs')

  return (
    <div>
      <div className="mb-6">
        <Link href="/jobs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Tạo tin tuyển dụng mới</h1>
      </div>

      <JobForm action={createJobAction} mode="create" />
    </div>
  )
}
