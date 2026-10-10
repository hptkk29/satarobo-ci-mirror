"use server";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { auditPackagePriceChange, getPackagePrice } from "@/lib/courses/pricing";

type ActionResult = {
  error?: string;
};

const jsonArraySchema = z.array(z.unknown()).default([]);

const packageSchema = z.object({
  code: z.string().trim().min(1, "Code khong duoc de trong").optional(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]*$/, "Slug chi gom chu thuong, so va dau gach ngang")
    .optional(),
  name: z.string().trim().min(1, "Ten package khong duoc de trong"),
  shortName: z.string().trim().optional(),
  subtitle: z.string().trim().optional(),
  shortDescription: z.string().trim().optional(),
  description: z.string().trim().optional(),
  ageGroup: z.string().trim().optional(),
  level: z.string().trim().optional(),
  lessons: z.number().int().nonnegative().nullable(),
  duration: z.string().trim().optional(),
  priceOriginal: z.number().int().nonnegative().nullable(),
  priceEarlyBird: z.number().int().nonnegative().nullable(),
  priceMember: z.number().int().nonnegative().nullable(),
  features: jsonArraySchema,
  highlights: jsonArraySchema,
  curriculum: jsonArraySchema,
  badge: z.string().trim().optional(),
  color: z.string().trim().optional(),
  displayOrder: z.number().int(),
  isPublished: z.boolean(),
  isFeatured: z.boolean(),
  thumbnail: z.string().trim().optional(),
  seoTitle: z.string().trim().optional(),
  seoDescription: z.string().trim().optional(),
  parentCourseSlug: z.string().trim().optional(),
  // FL1-05 — liên kết gói bán ↔ khoá dạy (Course). "" → bỏ liên kết.
  courseId: z.string().trim().optional(),
  // Phase TD-1 — Detail content
  audienceTag: z.string().trim().max(100).optional(),
  audienceDescription: z.string().trim().max(500).optional(),
  mission: z.string().trim().max(5000).optional(),
  outcomesJson: jsonArraySchema,
  methodsJson: jsonArraySchema,
  conditionsJson: jsonArraySchema,
  noteForParents: z.string().trim().max(2000).optional(),
  faqsJson: jsonArraySchema,
});

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function emptyToNull(value: string | undefined): string | null {
  return value ?? null;
}

function parseInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseJsonArray(value: FormDataEntryValue | null): unknown[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // 24/07: chỉnh gói combo CHỈ Đào tạo + SUPER_ADMIN → gác theo permission thay vì
  // hard-code role (khớp course-packages:edit ở matrix + trang list).
  if (!(await checkPermission("course-packages:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Nhóm 01 L1 — CoursePackage/Course = catalog LMS toàn cục (không center-scope),
  // scopedDb pass-through; dùng để sạch whitelist db trần.
  const actor = await resolveActor(session.user.id);
  return { user: session.user, sdb: scopedDb(actor) };
}

function readPackageForm(formData: FormData, includeCode: boolean) {
  const code = emptyToUndefined(formData.get("code"));
  const slug = emptyToUndefined(formData.get("slug"));

  return {
    code: includeCode ? code : undefined,
    slug,
    name: emptyToUndefined(formData.get("name")) ?? "",
    shortName: emptyToUndefined(formData.get("shortName")),
    subtitle: emptyToUndefined(formData.get("subtitle")),
    shortDescription: emptyToUndefined(formData.get("shortDescription")),
    description: emptyToUndefined(formData.get("description")),
    ageGroup: emptyToUndefined(formData.get("ageGroup")),
    level: emptyToUndefined(formData.get("level")),
    lessons: parseInteger(formData.get("lessons")),
    duration: emptyToUndefined(formData.get("duration")),
    priceOriginal: parseInteger(formData.get("priceOriginal")),
    priceEarlyBird: parseInteger(formData.get("priceEarlyBird")),
    priceMember: parseInteger(formData.get("priceMember")),
    features: parseJsonArray(formData.get("features")),
    highlights: parseJsonArray(formData.get("highlights")),
    curriculum: parseJsonArray(formData.get("curriculum")),
    badge: emptyToUndefined(formData.get("badge")),
    color: emptyToUndefined(formData.get("color")),
    displayOrder: parseInteger(formData.get("displayOrder")) ?? 0,
    isPublished: formData.get("isPublished") === "on",
    isFeatured: formData.get("isFeatured") === "on",
    thumbnail: emptyToUndefined(formData.get("thumbnail")),
    seoTitle: emptyToUndefined(formData.get("seoTitle")),
    seoDescription: emptyToUndefined(formData.get("seoDescription")),
    parentCourseSlug: emptyToUndefined(formData.get("parentCourseSlug")),
    courseId: emptyToUndefined(formData.get("courseId")),
    // Phase TD-1
    audienceTag: emptyToUndefined(formData.get("audienceTag")),
    audienceDescription: emptyToUndefined(formData.get("audienceDescription")),
    mission: emptyToUndefined(formData.get("mission")),
    outcomesJson: parseJsonArray(formData.get("outcomesJson")),
    methodsJson: parseJsonArray(formData.get("methodsJson")),
    conditionsJson: parseJsonArray(formData.get("conditionsJson")),
    noteForParents: emptyToUndefined(formData.get("noteForParents")),
    faqsJson: parseJsonArray(formData.get("faqsJson")),
  };
}

export async function createPackage(formData: FormData): Promise<ActionResult> {
  const { sdb } = await requireAdmin();

  const parsed = packageSchema.safeParse(readPackageForm(formData, true));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Du lieu khong hop le" };
  }

  const pkg = parsed.data;
  if (!pkg.code) return { error: "Code khong duoc de trong" };

  const data: Prisma.CoursePackageCreateInput = {
    code: pkg.code,
    slug: pkg.slug || slugify(pkg.code),
    name: pkg.name,
    shortName: emptyToNull(pkg.shortName),
    subtitle: emptyToNull(pkg.subtitle),
    shortDescription: emptyToNull(pkg.shortDescription),
    description: emptyToNull(pkg.description),
    ageGroup: emptyToNull(pkg.ageGroup),
    level: emptyToNull(pkg.level),
    lessons: pkg.lessons,
    duration: emptyToNull(pkg.duration),
    priceOriginal: pkg.priceOriginal,
    priceEarlyBird: pkg.priceEarlyBird,
    priceMember: pkg.priceMember,
    features: pkg.features as Prisma.InputJsonValue,
    highlights: pkg.highlights as Prisma.InputJsonValue,
    curriculum: pkg.curriculum as Prisma.InputJsonValue,
    badge: emptyToNull(pkg.badge),
    color: emptyToNull(pkg.color),
    displayOrder: pkg.displayOrder,
    isPublished: pkg.isPublished,
    isFeatured: pkg.isFeatured,
    thumbnail: emptyToNull(pkg.thumbnail),
    seoTitle: emptyToNull(pkg.seoTitle),
    seoDescription: emptyToNull(pkg.seoDescription),
    parentCourseSlug: emptyToNull(pkg.parentCourseSlug),
    // FL1-05 — liên kết khoá dạy (chỉ connect khi có chọn).
    course: pkg.courseId ? { connect: { id: pkg.courseId } } : undefined,
    // Phase TD-1
    audienceTag: emptyToNull(pkg.audienceTag),
    audienceDescription: emptyToNull(pkg.audienceDescription),
    mission: emptyToNull(pkg.mission),
    outcomesJson: pkg.outcomesJson as Prisma.InputJsonValue,
    methodsJson: pkg.methodsJson as Prisma.InputJsonValue,
    conditionsJson: pkg.conditionsJson as Prisma.InputJsonValue,
    noteForParents: emptyToNull(pkg.noteForParents),
    faqsJson: pkg.faqsJson as Prisma.InputJsonValue,
  };

  try {
    await sdb.coursePackage.create({ data });
  } catch {
    return { error: "Slug hoac code da ton tai, hoac co loi co so du lieu" };
  }

  // Đợt 6 — đồng bộ "Số buổi" sang Course.totalSessions (khớp slug/code).
  await syncCourseTotalSessions(sdb, {
    slug: data.slug,
    code: data.code,
    lessons: data.lessons ?? null,
  });

  revalidatePath("/course-packages");
  redirect("/course-packages");
}

/** Đồng bộ số buổi (CoursePackage.lessons) → Course.totalSessions theo slug/code. */
async function syncCourseTotalSessions(
  sdb: ReturnType<typeof scopedDb>,
  opts: {
    slug?: string | null;
    code?: string | null;
    lessons: number | null;
  },
): Promise<void> {
  const or: { slug?: string; code?: string }[] = [];
  if (opts.slug) or.push({ slug: opts.slug });
  if (opts.code) or.push({ code: opts.code });
  if (or.length === 0) return;
  try {
    await sdb.course.updateMany({ where: { OR: or }, data: { totalSessions: opts.lessons } });
  } catch {
    /* khoá chưa có bản Course tương ứng — bỏ qua */
  }
}

export async function updatePackage(id: string, formData: FormData): Promise<ActionResult> {
  const { user: admin, sdb } = await requireAdmin();

  const parsed = packageSchema.safeParse(readPackageForm(formData, false));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Du lieu khong hop le" };
  }

  // R6-B4 — giá cũ (trước update) để audit nếu đổi giá.
  const oldPrice = await getPackagePrice(id);

  const pkg = parsed.data;
  const data: Prisma.CoursePackageUpdateInput = {
    slug: pkg.slug || undefined,
    name: pkg.name,
    shortName: emptyToNull(pkg.shortName),
    subtitle: emptyToNull(pkg.subtitle),
    shortDescription: emptyToNull(pkg.shortDescription),
    description: emptyToNull(pkg.description),
    ageGroup: emptyToNull(pkg.ageGroup),
    level: emptyToNull(pkg.level),
    lessons: pkg.lessons,
    duration: emptyToNull(pkg.duration),
    priceOriginal: pkg.priceOriginal,
    priceEarlyBird: pkg.priceEarlyBird,
    priceMember: pkg.priceMember,
    features: pkg.features as Prisma.InputJsonValue,
    highlights: pkg.highlights as Prisma.InputJsonValue,
    curriculum: pkg.curriculum as Prisma.InputJsonValue,
    badge: emptyToNull(pkg.badge),
    color: emptyToNull(pkg.color),
    displayOrder: pkg.displayOrder,
    isPublished: pkg.isPublished,
    isFeatured: pkg.isFeatured,
    thumbnail: emptyToNull(pkg.thumbnail),
    seoTitle: emptyToNull(pkg.seoTitle),
    seoDescription: emptyToNull(pkg.seoDescription),
    parentCourseSlug: emptyToNull(pkg.parentCourseSlug),
    // FL1-05 — connect khoá khi chọn, disconnect khi bỏ trống (không xoá JSON cũ).
    course: pkg.courseId ? { connect: { id: pkg.courseId } } : { disconnect: true },
    // Phase TD-1
    audienceTag: emptyToNull(pkg.audienceTag),
    audienceDescription: emptyToNull(pkg.audienceDescription),
    mission: emptyToNull(pkg.mission),
    outcomesJson: pkg.outcomesJson as Prisma.InputJsonValue,
    methodsJson: pkg.methodsJson as Prisma.InputJsonValue,
    conditionsJson: pkg.conditionsJson as Prisma.InputJsonValue,
    noteForParents: emptyToNull(pkg.noteForParents),
    faqsJson: pkg.faqsJson as Prisma.InputJsonValue,
  };

  try {
    await sdb.coursePackage.update({ where: { id }, data });
  } catch {
    return { error: "Package khong ton tai, slug bi trung, hoac co loi co so du lieu" };
  }

  // R6-B4 — audit khi giá đổi (T9).
  if (oldPrice) {
    await auditPackagePriceChange(
      { id: admin.id, name: admin.name ?? admin.email ?? "Admin" },
      {
        packageId: id,
        oldPrice,
        newPrice: {
          priceOriginal: pkg.priceOriginal,
          priceEarlyBird: pkg.priceEarlyBird,
          priceMember: pkg.priceMember,
        },
      },
    );
  }

  // Đợt 6 — đồng bộ "Số buổi" sang Course.totalSessions (đọc lại slug/code đã lưu).
  try {
    const saved = await sdb.coursePackage.findUnique({
      where: { id },
      select: { slug: true, code: true, lessons: true },
    });
    if (saved) await syncCourseTotalSessions(sdb, saved);
  } catch {
    /* bỏ qua lỗi đồng bộ — không chặn lưu package */
  }

  revalidatePath("/course-packages");
  revalidatePath(`/course-packages/${id}/edit`);
  redirect("/course-packages");
}

export async function deletePackage(id: string): Promise<ActionResult> {
  const { sdb } = await requireAdmin();

  try {
    await sdb.coursePackage.delete({ where: { id } });
  } catch {
    return { error: "Khong the xoa package nay" };
  }

  revalidatePath("/course-packages");
  return {};
}
