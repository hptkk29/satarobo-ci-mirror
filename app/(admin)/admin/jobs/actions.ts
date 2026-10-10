'use server'

import { auth } from '@/lib/auth'
import { assertPermission } from '@/lib/auth/check-permission'
import { resolveActor } from '@/lib/auth/actor'
import { scopedDb } from '@/lib/db-scope'
import { revalidatePath } from 'next/cache'
import { jobCreateSchema } from '@/lib/validators/job'

// JobPosting KHÔNG ∈ SCOPED_MODELS → scopedDb(actor) là pass-through (không đổi hành vi);
// dùng để tuân quy ước "app/** không import @/lib/db trần" (#03).

export async function createJobAction(input: unknown) {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chua dang nhap' }
  try {
    await assertPermission('jobs:create')
  } catch {
    return { ok: false, error: 'Khong co quyen' }
  }
  const sdb = scopedDb(await resolveActor(session.user.id))

  const parsed = jobCreateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Du lieu khong hop le' }

  const existing = await sdb.jobPosting.findUnique({ where: { slug: parsed.data.slug } })
  if (existing) return { ok: false, error: 'Slug da ton tai, vui long chon slug khac' }

  const job = await sdb.jobPosting.create({
    data: {
      ...parsed.data,
      closesAt: parsed.data.closesAt ?? null,
      authorId: session.user.id,
    },
  })

  revalidatePath('/jobs')
  revalidatePath('/tuyen-dung')

  return { ok: true, id: job.id }
}

export async function updateJobAction(id: string, input: unknown) {
  const session = await auth()
  if (!session?.user) return { ok: false, error: 'Chua dang nhap' }
  try {
    await assertPermission('jobs:edit')
  } catch {
    return { ok: false, error: 'Khong co quyen' }
  }
  const sdb = scopedDb(await resolveActor(session.user.id))

  const parsed = jobCreateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Du lieu khong hop le' }

  const job = await sdb.jobPosting.update({
    where: { id },
    data: {
      ...parsed.data,
      closesAt: parsed.data.closesAt ?? null,
    },
  })

  revalidatePath('/jobs')
  revalidatePath('/tuyen-dung')
  revalidatePath(`/tuyen-dung/${job.slug}`)

  return { ok: true }
}

export async function deleteJobAction(id: string) {
  const session = await auth()
  if (!session?.user) return { ok: false }
  try {
    await assertPermission('jobs:delete')
  } catch {
    return { ok: false, error: 'Khong co quyen xoa JD' }
  }
  const sdb = scopedDb(await resolveActor(session.user.id))

  const job = await sdb.jobPosting.delete({ where: { id } })

  revalidatePath('/jobs')
  revalidatePath('/tuyen-dung')
  revalidatePath(`/tuyen-dung/${job.slug}`)

  return { ok: true }
}

export async function duplicateJobAction(id: string) {
  const session = await auth()
  if (!session?.user) return { ok: false }
  try {
    await assertPermission('jobs:create')
  } catch {
    return { ok: false, error: 'Khong co quyen' }
  }
  const sdb = scopedDb(await resolveActor(session.user.id))

  const original = await sdb.jobPosting.findUnique({ where: { id } })
  if (!original) return { ok: false, error: 'Khong tim thay JD' }

  const newSlug = `${original.slug}-copy-${Date.now()}`
  const newJob = await sdb.jobPosting.create({
    data: {
      slug: newSlug,
      title: `[COPY] ${original.title}`,
      department: original.department,
      location: original.location,
      type: original.type,
      description: original.description,
      workingHours: original.workingHours,
      experienceLevel: original.experienceLevel,
      responsibilities: original.responsibilities,
      requirements: original.requirements,
      benefits: original.benefits,
      salary: original.salary,
      salaryMin: original.salaryMin,
      salaryMax: original.salaryMax,
      salaryNote: original.salaryNote,
      openings: original.openings,
      status: 'DRAFT',
      contactEmail: original.contactEmail,
      contactPhone: original.contactPhone,
      closesAt: original.closesAt,
      authorId: session.user.id,
    },
  })

  revalidatePath('/jobs')
  return { ok: true, id: newJob.id }
}

export async function changeJobStatusAction(id: string, status: string) {
  const session = await auth()
  if (!session?.user) return { ok: false }
  try {
    await assertPermission('jobs:edit')
  } catch {
    return { ok: false }
  }
  const sdb = scopedDb(await resolveActor(session.user.id))

  const job = await sdb.jobPosting.update({
    where: { id },
    data: { status: status as never },
  })

  revalidatePath('/jobs')
  revalidatePath('/tuyen-dung')
  revalidatePath(`/tuyen-dung/${job.slug}`)

  return { ok: true }
}
