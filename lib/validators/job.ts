import { z } from 'zod'

export const JobStatusEnum = z.enum(['DRAFT', 'OPEN', 'CLOSED', 'ON_HOLD'])
export const ExperienceLevelEnum = z.enum(['ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'EXPERT'])

const stringArray = z.array(z.string().trim().min(1)).default([])

const optionalEmail = z
  .union([z.literal(''), z.string().email('Email không hợp lệ')])
  .nullable()
  .optional()
  .transform((v) => (v === '' || v == null ? null : v))

const optionalString = z
  .union([z.literal(''), z.string()])
  .nullable()
  .optional()
  .transform((v) => (v === '' || v == null ? null : v))

const jobBaseSchema = z.object({
  slug: z
    .string()
    .min(3, 'Slug tối thiểu 3 ký tự')
    .max(100, 'Slug tối đa 100 ký tự')
    .regex(/^[a-z0-9-]+$/, 'Slug chỉ chứa chữ thường, số và dấu gạch'),
  title: z
    .string()
    .min(5, 'Tiêu đề tối thiểu 5 ký tự')
    .max(200, 'Tiêu đề tối đa 200 ký tự'),
  department: z.string().min(1, 'Chọn phòng ban'),
  location: z.string().min(1, 'Chọn địa điểm'),
  type: z.string().min(1, 'Chọn hình thức'),
  description: z
    .string()
    .min(50, 'Mô tả tối thiểu 50 ký tự')
    .max(20000, 'Mô tả quá dài (tối đa 20.000 ký tự)'),
  workingHours: optionalString,
  experienceLevel: ExperienceLevelEnum.nullable().optional(),
  responsibilities: stringArray,
  requirements: stringArray,
  benefits: stringArray,
  salaryMin: z.coerce.number().int().min(0, 'Lương không hợp lệ').optional().nullable(),
  salaryMax: z.coerce.number().int().min(0, 'Lương không hợp lệ').optional().nullable(),
  salaryNote: z.string().max(200, 'Ghi chú lương tối đa 200 ký tự').optional().nullable(),
  status: JobStatusEnum.default('DRAFT'),
  openings: z.coerce.number().int().min(1, 'Số lượng tuyển tối thiểu là 1').default(1),
  closesAt: z.coerce.date().optional().nullable(),
  contactEmail: optionalEmail,
  contactPhone: optionalString,
})

// Lương max phải ≥ min (khi cả hai được nhập) — chặn "min 50tr > max 10tr".
function checkSalaryRange(
  data: { salaryMin?: number | null; salaryMax?: number | null },
  ctx: z.RefinementCtx,
) {
  if (
    data.salaryMin != null &&
    data.salaryMax != null &&
    data.salaryMin > data.salaryMax
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['salaryMax'],
      message: 'Lương tối đa phải lớn hơn hoặc bằng lương tối thiểu',
    })
  }
}

export const jobCreateSchema = jobBaseSchema.superRefine(checkSalaryRange)

export type JobCreateInput = z.infer<typeof jobBaseSchema>

export const jobUpdateSchema = jobBaseSchema
  .partial()
  .extend({ id: z.string().min(1) })
  .superRefine(checkSalaryRange)
