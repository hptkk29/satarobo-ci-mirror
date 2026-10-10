"use server";

import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

type ActionResult = { error?: string };

const newsSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]*$/, "Slug chỉ gồm chữ thường, số và dấu gạch ngang")
    .optional(),
  title: z.string().trim().min(1, "Tiêu đề không được để trống"),
  excerpt: z.string().trim().min(1, "Excerpt không được để trống"),
  content: z.string().trim().min(1, "Nội dung không được để trống"),
  coverImage: z.string().trim().optional(),
  category: z.string().trim().optional(),
  tags: z.array(z.string()).default([]),
  isPublished: z.boolean(),
  isFeatured: z.boolean(),
  displayOrder: z.number().int(),
  seoTitle: z.string().trim().optional(),
  seoDescription: z.string().trim().optional(),
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

function parseTags(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
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

// News là nội dung global (∉ SCOPED_MODELS) → sdb pass-through, hành vi y nguyên.
async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = session.user.role;
  if (
    role !== "SUPER_ADMIN" &&
    role !== "CENTER_MANAGER" &&
    role !== "MARKETING"
  ) {
    redirect("/dashboard?error=unauthorized");
  }
  const actor = await resolveActor(session.user.id);
  return { user: session.user, sdb: scopedDb(actor) };
}

function readForm(formData: FormData) {
  return {
    slug: emptyToUndefined(formData.get("slug")),
    title: emptyToUndefined(formData.get("title")) ?? "",
    excerpt: emptyToUndefined(formData.get("excerpt")) ?? "",
    content: emptyToUndefined(formData.get("content")) ?? "",
    coverImage: emptyToUndefined(formData.get("coverImage")),
    category: emptyToUndefined(formData.get("category")),
    tags: parseTags(formData.get("tags")),
    isPublished: formData.get("isPublished") === "on",
    isFeatured: formData.get("isFeatured") === "on",
    displayOrder: parseInteger(formData.get("displayOrder")),
    seoTitle: emptyToUndefined(formData.get("seoTitle")),
    seoDescription: emptyToUndefined(formData.get("seoDescription")),
  };
}

export async function createNews(formData: FormData): Promise<ActionResult> {
  const { sdb } = await requireAdmin();

  const parsed = newsSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const n = parsed.data;
  const data: Prisma.NewsCreateInput = {
    slug: n.slug || slugify(n.title),
    title: n.title,
    excerpt: n.excerpt,
    content: n.content,
    coverImage: emptyToNull(n.coverImage),
    category: emptyToNull(n.category),
    tags: n.tags,
    isPublished: n.isPublished,
    isFeatured: n.isFeatured,
    publishedAt: n.isPublished ? new Date() : null,
    displayOrder: n.displayOrder,
    seoTitle: emptyToNull(n.seoTitle),
    seoDescription: emptyToNull(n.seoDescription),
  };

  try {
    await sdb.news.create({ data });
  } catch {
    return { error: "Slug đã tồn tại hoặc lỗi cơ sở dữ liệu" };
  }

  revalidatePath("/news");
  revalidatePath("/tin-tuc");
  redirect("/news");
}

export async function updateNews(id: string, formData: FormData): Promise<ActionResult> {
  const { sdb } = await requireAdmin();

  const parsed = newsSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const existing = await sdb.news.findUnique({
    where: { id },
    select: { isPublished: true, publishedAt: true },
  });
  if (!existing) return { error: "Bài viết không tồn tại" };

  const n = parsed.data;
  // Set publishedAt khi chuyển từ draft sang published; giữ nguyên nếu đang published
  let publishedAt = existing.publishedAt;
  if (n.isPublished && !existing.isPublished) {
    publishedAt = new Date();
  } else if (!n.isPublished) {
    publishedAt = null;
  }

  const data: Prisma.NewsUpdateInput = {
    slug: n.slug || undefined,
    title: n.title,
    excerpt: n.excerpt,
    content: n.content,
    coverImage: emptyToNull(n.coverImage),
    category: emptyToNull(n.category),
    tags: n.tags,
    isPublished: n.isPublished,
    isFeatured: n.isFeatured,
    publishedAt,
    displayOrder: n.displayOrder,
    seoTitle: emptyToNull(n.seoTitle),
    seoDescription: emptyToNull(n.seoDescription),
  };

  try {
    await sdb.news.update({ where: { id }, data });
  } catch {
    return { error: "Bài viết không tồn tại, slug trùng, hoặc lỗi cơ sở dữ liệu" };
  }

  revalidatePath("/news");
  revalidatePath(`/news/${id}/edit`);
  revalidatePath("/tin-tuc");
  revalidatePath(`/tin-tuc/${n.slug || ""}`);
  redirect("/news");
}

export async function deleteNews(id: string): Promise<ActionResult> {
  const { sdb } = await requireAdmin();
  try {
    await sdb.news.delete({ where: { id } });
  } catch {
    return { error: "Không thể xoá bài viết này" };
  }
  revalidatePath("/news");
  revalidatePath("/tin-tuc");
  return {};
}

export async function toggleNewsPublished(id: string, newValue: boolean): Promise<ActionResult> {
  const { sdb } = await requireAdmin();
  try {
    const existing = await sdb.news.findUnique({
      where: { id },
      select: { publishedAt: true, isPublished: true },
    });
    if (!existing) return { error: "Bài viết không tồn tại" };

    let publishedAt = existing.publishedAt;
    if (newValue && !existing.isPublished) publishedAt = new Date();
    if (!newValue) publishedAt = null;

    await sdb.news.update({
      where: { id },
      data: { isPublished: newValue, publishedAt },
    });
  } catch {
    return { error: "Không thể cập nhật trạng thái" };
  }
  revalidatePath("/news");
  revalidatePath("/tin-tuc");
  return {};
}
