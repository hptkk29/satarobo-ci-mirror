'use client'

import { useEffect, useState, useTransition } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { jobCreateSchema, type JobCreateInput } from '@/lib/validators/job'
import { DEPARTMENTS, LOCATIONS, JOB_TYPES, JOB_STATUS } from '@/lib/data/job-options'
import { StringArrayEditor } from '@/app/(admin)/admin/kits/_components/string-array-editor'
import { MoneyInput } from '@/components/ui/money-input'
import { FieldLabel, HelpHint } from '@/components/admin/ui/help-hint'
import { Loader2 } from 'lucide-react'

const EXPERIENCE_OPTIONS: { value: JobCreateInput['experienceLevel']; label: string }[] = [
  { value: null, label: '— Không yêu cầu —' },
  { value: 'ENTRY', label: 'Mới ra trường' },
  { value: 'JUNIOR', label: '1-2 năm' },
  { value: 'MID', label: '3-5 năm' },
  { value: 'SENIOR', label: '5+ năm' },
  { value: 'EXPERT', label: 'Chuyên gia 10+ năm' },
]

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100)
}

interface JobFormProps {
  action: (data: JobCreateInput) => Promise<{ ok: boolean; error?: string; id?: string }>
  mode: 'create' | 'edit'
  initialData?: Partial<JobCreateInput & { closesAt: Date | null }>
}

export function JobForm({ action, mode, initialData }: JobFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const defaultClosesAt =
    initialData?.closesAt instanceof Date
      ? initialData.closesAt.toISOString().split('T')[0]
      : ''

  const form = useForm<JobCreateInput>({
    // zodResolver type mismatch with coerce fields — cast needed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(jobCreateSchema as any),
    defaultValues: {
      slug: initialData?.slug ?? '',
      title: initialData?.title ?? '',
      department: initialData?.department ?? '',
      location: initialData?.location ?? 'danang',
      type: initialData?.type ?? 'fulltime',
      description: initialData?.description ?? '',
      workingHours: initialData?.workingHours ?? null,
      experienceLevel: initialData?.experienceLevel ?? null,
      responsibilities: initialData?.responsibilities ?? [],
      requirements: initialData?.requirements ?? [],
      benefits: initialData?.benefits ?? [],
      salaryMin: initialData?.salaryMin ?? undefined,
      salaryMax: initialData?.salaryMax ?? undefined,
      salaryNote: initialData?.salaryNote ?? 'Thoả thuận theo năng lực',
      status: (initialData?.status as JobCreateInput['status']) ?? 'DRAFT',
      openings: initialData?.openings ?? 1,
      closesAt: undefined,
      contactEmail: initialData?.contactEmail ?? null,
      contactPhone: initialData?.contactPhone ?? null,
    },
  })

  const titleValue = form.watch('title')

  // Auto-slug bám theo tiêu đề CHO ĐẾN KHI user tự sửa ô slug. Bản cũ chỉ điền khi
  // slug rỗng → sau ký tự đầu ("k") slug hết rỗng nên KHÔNG cập nhật tiếp (đứng ở "k").
  const [slugEdited, setSlugEdited] = useState(mode === 'edit')
  const slugReg = form.register('slug')

  useEffect(() => {
    if (mode === 'create' && !slugEdited) {
      form.setValue('slug', slugify(titleValue ?? ''), { shouldValidate: false })
    }
  }, [titleValue, mode, slugEdited, form])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onSubmit = (data: any) => {
    startTransition(async () => {
      const result = await action(data)
      if (result.ok) {
        if (mode === 'create' && result.id) {
          router.push(`/jobs/${result.id}/edit`)
        } else {
          router.push('/jobs')
        }
      } else {
        alert(result.error ?? 'Co loi xay ra')
      }
    })
  }

  const errors = form.formState.errors

  const fieldClass =
    'w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-muted'
  const labelClass = 'block text-sm font-semibold text-foreground mb-1'
  const errorClass = 'mt-1 text-xs text-state-danger-ink'

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 max-w-4xl">
      {/* Section 1: Cơ bản */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-5 font-bold text-foreground">Thông tin cơ bản</h2>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Tiêu đề *</label>
            <input className={fieldClass} {...form.register('title')} placeholder="Ví dụ: Giáo viên Robotics cơ sở Nguyễn Hữu Thọ" />
            {errors.title && <p className={errorClass}>{errors.title.message}</p>}
          </div>

          <div>
            <label className={labelClass}>Slug (URL) *</label>
            <input
              className={fieldClass}
              {...slugReg}
              onChange={(e) => {
                setSlugEdited(true) // user tự sửa → ngừng auto-slug
                void slugReg.onChange(e)
              }}
              placeholder="giao-vien-robotics-hai-chau"
            />
            {errors.slug && <p className={errorClass}>{errors.slug.message}</p>}
            <p className="mt-1 text-xs text-muted-foreground">URL: /tuyen-dung/{form.watch('slug') || '...'}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Phòng ban *</label>
              <select className={fieldClass} {...form.register('department')}>
                <option value="">-- Chọn --</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
              {errors.department && <p className={errorClass}>{errors.department.message}</p>}
            </div>

            <div>
              <label className={labelClass}>Địa điểm *</label>
              <select className={fieldClass} {...form.register('location')}>
                {LOCATIONS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Hình thức *</label>
              <select className={fieldClass} {...form.register('type')}>
                {JOB_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Giờ làm việc</label>
              <input
                className={fieldClass}
                {...form.register('workingHours')}
                placeholder="VD: Thứ 2-6, 8h-17h"
              />
            </div>
            <div>
              <label className={labelClass}>Yêu cầu kinh nghiệm</label>
              <Controller
                control={form.control}
                name="experienceLevel"
                render={({ field }) => (
                  <select
                    className={fieldClass}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
                  >
                    {EXPERIENCE_OPTIONS.map((opt) => (
                      <option key={opt.value ?? '__none__'} value={opt.value ?? ''}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Mô tả + Bullets */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-5 font-bold text-foreground">Nội dung tin tuyển</h2>
        <div className="space-y-5">
          <div>
            <FieldLabel
              label="Mô tả tổng quan *"
              className={labelClass}
              hint="Tối thiểu 50 ký tự. Hỗ trợ xuống dòng."
            />
            <textarea
              className={fieldClass}
              rows={6}
              placeholder="Giới thiệu chung về vị trí, đội nhóm, văn hoá..."
              {...form.register('description')}
            />
            {errors.description && <p className={errorClass}>{errors.description.message}</p>}
          </div>

          <div>
            <label className={labelClass}>Trách nhiệm công việc</label>
            <Controller
              control={form.control}
              name="responsibilities"
              render={({ field }) => (
                <StringArrayEditor
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="VD: Lên giáo án và giảng dạy theo chương trình WRO"
                />
              )}
            />
          </div>

          <div>
            <label className={labelClass}>Yêu cầu ứng viên</label>
            <Controller
              control={form.control}
              name="requirements"
              render={({ field }) => (
                <StringArrayEditor
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="VD: Tốt nghiệp ĐH ngành Kỹ thuật / CNTT / Cơ điện tử"
                />
              )}
            />
          </div>

          <div>
            <label className={labelClass}>Quyền lợi</label>
            <Controller
              control={form.control}
              name="benefits"
              render={({ field }) => (
                <StringArrayEditor
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="VD: Lương 8–15 triệu/tháng tuỳ năng lực"
                />
              )}
            />
          </div>
        </div>
      </section>

      {/* Section 3: Lương & Chỉ tiêu */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-5 font-bold text-foreground">Lương & Chỉ tiêu</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Ô TIỀN — gõ "7000000" hiện "7.000.000". Đi qua <Controller> chứ không
                `register`: MoneyInput trả thẳng số (hoặc null khi ô trống), nên không cần
                `setValueAs` bóc chuỗi nữa. */}
            <div>
              <label className={labelClass}>Lương min (VND)</label>
              <Controller
                control={form.control}
                name="salaryMin"
                render={({ field }) => (
                  <MoneyInput
                    name="salaryMin"
                    className={fieldClass}
                    placeholder="7.000.000"
                    min={0}
                    value={field.value ?? null}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </div>
            <div>
              <label className={labelClass}>Lương max (VND)</label>
              <Controller
                control={form.control}
                name="salaryMax"
                render={({ field }) => (
                  <MoneyInput
                    name="salaryMax"
                    className={fieldClass}
                    placeholder="15.000.000"
                    min={0}
                    value={field.value ?? null}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
              {errors.salaryMax && <p className={errorClass}>{errors.salaryMax.message}</p>}
            </div>
            <div>
              <FieldLabel
                label="Ghi chú lương"
                className={labelClass}
                hint="Nếu điền Ghi chú lương → hiển thị ghi chú thay vì dải lương."
              />
              <input
                className={fieldClass}
                placeholder="Thoả thuận theo năng lực"
                {...form.register('salaryNote')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Số chỉ tiêu</label>
              <input
                className={fieldClass}
                type="number"
                min="1"
                {...form.register('openings', { valueAsNumber: true })}
              />
            </div>
            <div>
              <label className={labelClass}>Hạn nộp CV</label>
              <input
                className={fieldClass}
                type="date"
                defaultValue={defaultClosesAt}
                {...form.register('closesAt')}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Liên hệ */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-5 font-bold text-foreground">
          Thông tin liên hệ
          <HelpHint className="ml-1">
            Để trống = public page dùng email &amp; SĐT mặc định của Sata Robo.
          </HelpHint>
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Email liên hệ</label>
            <input
              className={fieldClass}
              type="email"
              placeholder="hr@satarobo.vn"
              {...form.register('contactEmail')}
            />
            {errors.contactEmail && <p className={errorClass}>{errors.contactEmail.message}</p>}
          </div>
          <div>
            <label className={labelClass}>SĐT liên hệ</label>
            <input
              className={fieldClass}
              type="tel"
              placeholder="0901234567"
              {...form.register('contactPhone')}
            />
          </div>
        </div>
      </section>

      {/* Section 5: Trạng thái */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-5 font-bold text-foreground">Trạng thái</h2>
        <div>
          <FieldLabel
            label="Trạng thái hiển thị"
            className={labelClass}
            hint={
              <ul className="space-y-1">
                <li><strong>DRAFT</strong>: chỉ admin thấy, không xuất hiện trên /tuyen-dung</li>
                <li><strong>OPEN</strong>: hiển thị public, Google Jobs có thể index</li>
                <li><strong>CLOSED</strong>: đã đóng tuyển, ẩn khỏi public</li>
                <li><strong>ON_HOLD</strong>: tạm dừng, ẩn khỏi public</li>
              </ul>
            }
          />
          <select className={`${fieldClass} max-w-xs`} {...form.register('status')}>
            {JOB_STATUS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </section>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? 'Đang lưu...' : mode === 'create' ? 'Tạo JD' : 'Cập nhật'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </form>
  )
}
