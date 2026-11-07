import { z } from "zod";

export const HonorCategoryEnum = z.enum([
  "SPARK",
  "GROWTH",
  "IMPACT",
  "GRAND_CHAMPION",
]);

export const honorCreateSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(150)
    .regex(/^[a-z0-9-]+$/, "Slug chỉ chứa chữ thường, số và dấu gạch"),
  // Phase 4.7: link sang Employee thay vì gõ tay
  employeeId: z.string().cuid("Phải chọn nhân sự"),
  jobTitleAtTime: z.string().max(200).optional().nullable(),
  yearsAtTime: z.coerce.number().int().min(0).max(80).optional().nullable(),
  category: HonorCategoryEnum,
  awardName: z.string().min(3).max(200),
  awardedAt: z.coerce.date(),
  awardQuarter: z.string().max(20).optional().nullable(),
  story: z.string().min(20).max(20000),
  shortBio: z.string().max(280).optional().nullable(),
  pullQuote: z.string().max(500).optional().nullable(),
  achievements: z.string().max(10000).optional().nullable(),
  isFeatured: z.coerce.boolean().default(false),
  isPublished: z.coerce.boolean().default(true),
  displayOrder: z.coerce.number().int().default(0),
});

export type HonorCreateInput = z.infer<typeof honorCreateSchema>;

export const timelineCreateSchema = z.object({
  occurredAt: z.coerce.date(),
  title: z.string().min(2).max(200),
  description: z.string().min(10).max(5000),
  coverImageUrl: z.string().url().optional().or(z.literal("")).nullable(),
  isPublished: z.coerce.boolean().default(true),
  displayOrder: z.coerce.number().int().default(0),
});

export type TimelineCreateInput = z.infer<typeof timelineCreateSchema>;

export const sitePageContentUpdateSchema = z.object({
  pageKey: z.string().min(1).max(50),
  contentKey: z.string().min(1).max(50),
  contentValue: z.string().max(5000),
});

export type SitePageContentInput = z.infer<typeof sitePageContentUpdateSchema>;
