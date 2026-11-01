"use server";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

type ActionResult = { error?: string };

const specsSchema = z.record(z.string(), z.string()).default({});
const stringArraySchema = z.array(z.string()).default([]);
const galleryImagesSchema = z.array(z.string()).default([]);

const kitSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]*$/, "Slug chỉ gồm chữ thường, số và dấu gạch ngang")
    .optional(),
  brand: z.string().trim().min(1, "Brand không được để trống"),
  series: z.string().trim().min(1, "Series không được để trống"),
  code: z.string().trim().optional(),
  title: z.string().trim().min(1, "Tiêu đề không được để trống"),
  subtitle: z.string().trim().min(1, "Subtitle không được để trống"),
  shortDescription: z.string().trim().min(1, "Mô tả ngắn không được để trống"),
  description: z.string().trim().min(1, "Mô tả không được để trống"),
  priceDisplay: z.string().trim().default("Liên hệ tư vấn"),
  isAvailable: z.boolean(),
  specs: specsSchema,
  features: stringArraySchema,
  highlights: stringArraySchema,
  mainImage: z.string().trim().default(""),
  galleryImages: galleryImagesSchema,
  sourceUrl: z.string().trim().optional(),
  displayOrder: z.number().int(),
  isPublished: z.boolean(),
});

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function emptyToNull(value: string | undefined): string | null {
  return value ?? null;
}

function parseInteger(value: FormDataEntryValue | null): number {
  if (typeof value !== "string" || value.trim() === "") return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseStringArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    }
    return [];
  } catch {
    return [];
  }
}

function parseSpecs(value: FormDataEntryValue | null): Record<string, string> {
  if (typeof value !== "string" || value.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") result[k] = v;
        else if (typeof v === "number" || typeof v === "boolean") result[k] = String(v);
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ZMRoboKit là catalog toàn cục (không có centerId, không scoped) — scopedDb
// pass-through; đi qua scopedDb để thống nhất cổng truy vấn (A0-04).
async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("kits:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return scopedDb(await resolveActor(session.user.id));
}

function readForm(formData: FormData) {
  return {
    slug: emptyToUndefined(formData.get("slug")),
    brand: emptyToUndefined(formData.get("brand")) ?? "ZMROBO",
    series: emptyToUndefined(formData.get("series")) ?? "",
    code: emptyToUndefined(formData.get("code")),
    title: emptyToUndefined(formData.get("title")) ?? "",
    subtitle: emptyToUndefined(formData.get("subtitle")) ?? "",
    shortDescription: emptyToUndefined(formData.get("shortDescription")) ?? "",
    description: emptyToUndefined(formData.get("description")) ?? "",
    priceDisplay: emptyToUndefined(formData.get("priceDisplay")) ?? "Liên hệ tư vấn",
    isAvailable: formData.get("isAvailable") === "on",
    specs: parseSpecs(formData.get("specs")),
    features: parseStringArray(formData.get("features")),
    highlights: parseStringArray(formData.get("highlights")),
    mainImage: emptyToUndefined(formData.get("mainImage")) ?? "",
    galleryImages: parseStringArray(formData.get("galleryImages")),
    sourceUrl: emptyToUndefined(formData.get("sourceUrl")),
    displayOrder: parseInteger(formData.get("displayOrder")),
    isPublished: formData.get("isPublished") === "on",
  };
}

export async function createKit(formData: FormData): Promise<ActionResult> {
  const sdb = await requireAdmin();

  const parsed = kitSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const k = parsed.data;
  const data: Prisma.ZMRoboKitCreateInput = {
    slug: k.slug || slugify(`${k.brand}-${k.title}`),
    brand: k.brand,
    series: k.series,
    code: emptyToNull(k.code),
    title: k.title,
    subtitle: k.subtitle,
    shortDescription: k.shortDescription,
    description: k.description,
    priceDisplay: k.priceDisplay,
    isAvailable: k.isAvailable,
    specs: k.specs as Prisma.InputJsonValue,
    features: k.features as Prisma.InputJsonValue,
    highlights: k.highlights as Prisma.InputJsonValue,
    mainImage: k.mainImage,
    galleryImages: k.galleryImages,
    sourceUrl: emptyToNull(k.sourceUrl),
    displayOrder: k.displayOrder,
    isPublished: k.isPublished,
  };

  try {
    await sdb.zMRoboKit.create({ data });
  } catch {
    return { error: "Slug đã tồn tại hoặc lỗi cơ sở dữ liệu" };
  }

  revalidatePath("/kits");
  revalidatePath("/hoc-cu");
  redirect("/kits");
}

export async function updateKit(id: string, formData: FormData): Promise<ActionResult> {
  const sdb = await requireAdmin();

  const parsed = kitSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const k = parsed.data;
  const data: Prisma.ZMRoboKitUpdateInput = {
    slug: k.slug || undefined,
    brand: k.brand,
    series: k.series,
    code: emptyToNull(k.code),
    title: k.title,
    subtitle: k.subtitle,
    shortDescription: k.shortDescription,
    description: k.description,
    priceDisplay: k.priceDisplay,
    isAvailable: k.isAvailable,
    specs: k.specs as Prisma.InputJsonValue,
    features: k.features as Prisma.InputJsonValue,
    highlights: k.highlights as Prisma.InputJsonValue,
    mainImage: k.mainImage,
    galleryImages: k.galleryImages,
    sourceUrl: emptyToNull(k.sourceUrl),
    displayOrder: k.displayOrder,
    isPublished: k.isPublished,
  };

  try {
    await sdb.zMRoboKit.update({ where: { id }, data });
  } catch {
    return { error: "Kit không tồn tại, slug trùng, hoặc lỗi cơ sở dữ liệu" };
  }

  revalidatePath("/kits");
  revalidatePath(`/kits/${id}/edit`);
  revalidatePath("/hoc-cu");
  redirect("/kits");
}

export async function deleteKit(id: string): Promise<ActionResult> {
  const sdb = await requireAdmin();
  try {
    await sdb.zMRoboKit.delete({ where: { id } });
  } catch {
    return { error: "Không thể xoá kit này" };
  }
  revalidatePath("/kits");
  revalidatePath("/hoc-cu");
  return {};
}

export async function toggleKitPublished(id: string, newValue: boolean): Promise<ActionResult> {
  const sdb = await requireAdmin();
  try {
    await sdb.zMRoboKit.update({
      where: { id },
      data: { isPublished: newValue },
    });
  } catch {
    return { error: "Không thể cập nhật trạng thái" };
  }
  revalidatePath("/kits");
  revalidatePath("/hoc-cu");
  return {};
}

export async function toggleKitAvailable(id: string, newValue: boolean): Promise<ActionResult> {
  const sdb = await requireAdmin();
  try {
    await sdb.zMRoboKit.update({
      where: { id },
      data: { isAvailable: newValue },
    });
  } catch {
    return { error: "Không thể cập nhật trạng thái" };
  }
  revalidatePath("/kits");
  revalidatePath("/hoc-cu");
  return {};
}
