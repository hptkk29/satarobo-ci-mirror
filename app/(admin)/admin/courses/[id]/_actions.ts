"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { courseDiscountSchema } from "@/lib/validators/course-discount";
import { MA_CA_KHOA } from "@/lib/hoc-bu/dong-can-bu";

type ActionResult = { ok: boolean; error?: string };

// CourseDiscount + Course là GLOBAL (QĐ-9) → chỉ cần auth + checkPermission("courses:edit").
// scopedDb(actor) pass-through cho model global (không center-scoped) — tuân R6-F1.
async function gate() {
  const session = await auth();
  if (!session?.user) return { error: "Chưa đăng nhập" as const };
  if (!(await checkPermission("courses:edit"))) return { error: "Không có quyền" as const };
  const sdb = scopedDb(await resolveActor(session.user.id));
  return { session, sdb };
}

// ─── Course basics (R7-03: thêm ageRange + level) ─────────────────────────────
const courseBasicsSchema = z.object({
  name: z.string().trim().min(1, "Tên khoá không được để trống"),
  ageRange: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  level: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  price: z
    .union([z.coerce.number().int().nonnegative(), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === undefined || v === null ? null : (v as number))),
  isActive: z.boolean().default(true),
});

const COURSE_SNAPSHOT = {
  name: true,
  ageRange: true,
  level: true,
  price: true,
  isActive: true,
} as const;

export async function updateCourseBasics(id: string, input: unknown): Promise<ActionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };

  const parsed = courseBasicsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const before = await g.sdb.course.findUnique({ where: { id }, select: COURSE_SNAPSHOT });
  if (!before) return { ok: false, error: "Không tìm thấy khoá học" };

  const { actorId, actorName } = getAuditActor(g.session);
  const updated = await g.sdb.course.update({
    where: { id },
    data: {
      name: parsed.data.name,
      ageRange: parsed.data.ageRange,
      level: parsed.data.level,
      price: parsed.data.price,
      isActive: parsed.data.isActive,
    },
    select: COURSE_SNAPSHOT,
  });

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "course",
    entityType: "Course",
    entityId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  revalidatePath(`/courses/${id}`);
  revalidatePath("/courses");
  return { ok: true };
}

// ─── CourseDiscount CRUD ──────────────────────────────────────────────────────
const courseIdSchema = z.object({ courseId: z.string().min(1) });

export async function createCourseDiscount(input: unknown): Promise<ActionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };

  const idParse = courseIdSchema.safeParse(input);
  if (!idParse.success) return { ok: false, error: "Thiếu courseId" };
  const { courseId } = idParse.data;

  const parsed = courseDiscountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const course = await g.sdb.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return { ok: false, error: "Không tìm thấy khoá học" };

  const { actorId, actorName } = getAuditActor(g.session);
  const created = await g.sdb.courseDiscount.create({
    data: {
      courseId,
      type: parsed.data.type,
      value: parsed.data.value,
      note: parsed.data.note,
      conditions: parsed.data.conditions,
      active: parsed.data.active,
      validFrom: parsed.data.validFrom,
      validTo: parsed.data.validTo,
    },
  });

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "course",
    entityType: "CourseDiscount",
    entityId: created.id,
    action: "CREATE",
    newValues: {
      courseId,
      type: created.type,
      value: created.value,
      active: created.active,
    },
  });

  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}

export async function updateCourseDiscount(id: string, input: unknown): Promise<ActionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };

  const before = await g.sdb.courseDiscount.findUnique({
    where: { id },
    select: {
      courseId: true,
      type: true,
      value: true,
      note: true,
      conditions: true,
      active: true,
      validFrom: true,
      validTo: true,
    },
  });
  if (!before) return { ok: false, error: "Không tìm thấy ưu đãi" };

  const parsed = courseDiscountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const { actorId, actorName } = getAuditActor(g.session);
  await g.sdb.courseDiscount.update({
    where: { id },
    data: {
      type: parsed.data.type,
      value: parsed.data.value,
      note: parsed.data.note,
      conditions: parsed.data.conditions,
      active: parsed.data.active,
      validFrom: parsed.data.validFrom,
      validTo: parsed.data.validTo,
    },
  });

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "course",
    entityType: "CourseDiscount",
    entityId: id,
    action: "UPDATE",
    oldValues: { type: before.type, value: before.value, active: before.active },
    newValues: { type: parsed.data.type, value: parsed.data.value, active: parsed.data.active },
  });

  revalidatePath(`/courses/${before.courseId}`);
  return { ok: true };
}

export async function deleteCourseDiscount(id: string): Promise<ActionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };

  const before = await g.sdb.courseDiscount.findUnique({
    where: { id },
    select: { courseId: true, type: true, value: true },
  });
  if (!before) return { ok: false, error: "Không tìm thấy ưu đãi" };

  const { actorId, actorName } = getAuditActor(g.session);
  await g.sdb.courseDiscount.delete({ where: { id } });

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "course",
    entityType: "CourseDiscount",
    entityId: id,
    action: "DELETE",
    oldValues: { type: before.type, value: before.value },
  });

  revalidatePath(`/courses/${before.courseId}`);
  return { ok: true };
}

// ─── Học bù (29/09/2026, docs/hoc-bu/DAC-TA.md §3.1) ──────────────────────────
// Bật/tắt học bù của khoá (Sata 8 tắt: học đủ) + số lượt bù từng học phần. Học phần phải
// là học phần THẬT của khoá (đếm từ `Lesson.moduleCode`) — không nhận mã do client bịa.
const hocBuSchema = z.object({
  choPhepHocBu: z.boolean(),
  luot: z
    .array(z.object({ moduleCode: z.string().max(40), luotBu: z.number().int().min(0).max(20) }))
    .max(50),
});

export async function luuCauHinhHocBuAction(courseId: string, input: unknown): Promise<ActionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const p = hocBuSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const course = await g.sdb.course.findUnique({
    where: { id: courseId },
    select: { id: true, choPhepHocBu: true },
  });
  if (!course) return { ok: false, error: "Không tìm thấy khoá học" };

  const bai = await g.sdb.lesson.findMany({
    where: { archivedAt: null, curriculum: { courseId, isActive: true } },
    select: { moduleCode: true },
  });
  const maThat = new Set(bai.map((b) => b.moduleCode?.trim() || MA_CA_KHOA));
  const la = p.data.luot.find((l) => !maThat.has(l.moduleCode));
  if (la) return { ok: false, error: `Học phần "${la.moduleCode || "cả khoá"}" không thuộc khoá này` };

  const cu = await g.sdb.courseModuleMakeupQuota.findMany({
    where: { courseId },
    select: { moduleCode: true, luotBu: true },
  });

  await g.sdb.$transaction(async (tx) => {
    await tx.course.update({ where: { id: courseId }, data: { choPhepHocBu: p.data.choPhepHocBu } });
    for (const l of p.data.luot) {
      await tx.courseModuleMakeupQuota.upsert({
        where: { courseId_moduleCode: { courseId, moduleCode: l.moduleCode } },
        update: { luotBu: l.luotBu, updatedById: g.session.user.id },
        create: { courseId, moduleCode: l.moduleCode, luotBu: l.luotBu, updatedById: g.session.user.id },
      });
    }
  });

  const { actorId, actorName } = getAuditActor(g.session);
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "lms",
    entityType: "Course",
    entityId: courseId,
    action: "UPDATE",
    oldValues: { choPhepHocBu: course.choPhepHocBu, luotBu: Object.fromEntries(cu.map((c) => [c.moduleCode, c.luotBu])) },
    newValues: {
      choPhepHocBu: p.data.choPhepHocBu,
      luotBu: Object.fromEntries(p.data.luot.map((l) => [l.moduleCode, l.luotBu])),
    },
  });

  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/hoc-bu");
  return { ok: true };
}
