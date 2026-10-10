"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { db } from "@/lib/db";
import { resolveActor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { actorCapabilities } from "@/lib/lms/report-card";
import {
  chuyenTrangThaiHocBaCore,
  luuHocBaCore,
  type NguoiThaoTacHocBa,
} from "@/lib/lms/report-card-ghi";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const AUDIT_MODULE = "lms";

// ─── Helpers ────────────────────────────────────────────────────────────────
async function authContext() {
  const session = await auth();
  if (!session?.user) return { error: "Chưa đăng nhập" as const };
  // report-cards:* seed v2 scope GLOBAL cố ý (check ở authContext, cách ly do
  // scopedDb — ReportCard ∈ SCOPED_MODELS từ #03 Pha B 86edfbc) — không
  // truyền target (chưa chắc scope, không đoán mò).
  const canManage = await checkPermission("report-cards:manage");
  const canReview = await checkPermission("report-cards:review");
  if (!canManage && !canReview) return { error: "Không có quyền" as const };
  const actor = await resolveActor(session.user.id);
  const capabilities = actorCapabilities({ manage: canManage, review: canReview });
  const auditActor = { id: session.user.id, name: session.user.name ?? session.user.email ?? session.user.id };
  return { session, actor, capabilities, auditActor };
}

// ═══════════════════════════════════════════════════════════════════════════
// SAVE / TRANSITION — thân đã tách sang lib/lms/report-card-ghi.ts (26/09/2026, giữ nguyên
// hành vi). Action chỉ còn: phiên đăng nhập + quyền (authContext) → core → revalidatePath.
// ═══════════════════════════════════════════════════════════════════════════
function nguoiThaoTac(ctx: Exclude<Awaited<ReturnType<typeof authContext>>, { error: string }>): NguoiThaoTacHocBa {
  return {
    userId: ctx.session.user.id,
    auditActor: ctx.auditActor,
    actor: ctx.actor,
    capabilities: ctx.capabilities,
  };
}

export async function saveReportCardAction(input: unknown): Promise<Result> {
  const ctx = await authContext();
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Không có quyền" };
  const res = await luuHocBaCore(nguoiThaoTac(ctx), input);
  if (!res.ok) return res;
  revalidatePath(`/admin/report-cards/${res.data.enrollmentId}`);
  revalidatePath("/admin/report-cards");
  return { ok: true };
}

export async function transitionReportCardAction(input: unknown): Promise<Result> {
  const ctx = await authContext();
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Không có quyền" };
  const res = await chuyenTrangThaiHocBaCore(nguoiThaoTac(ctx), input);
  if (!res.ok) return res;
  revalidatePath(`/admin/report-cards/${res.data.enrollmentId}`);
  revalidatePath("/admin/report-cards");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// TIÊU CHÍ NĂNG LỰC (Đào tạo cấu hình per khóa).
// ═══════════════════════════════════════════════════════════════════════════
const criterionSchema = z.object({
  courseId: z.string().min(1),
  name: z.string().trim().min(1, "Tên tiêu chí bắt buộc").max(200),
  order: z.number().int().min(0).max(999).default(0),
});

export async function createCriterionAction(input: unknown): Promise<Result> {
  const ctx = await authContext();
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Không có quyền" };
  // Cấu hình tiêu chí = quyền duyệt (QL/Đào tạo).
  if (!ctx.capabilities.includes("review")) return { ok: false, error: "Chỉ Đào tạo/Quản lý cấu hình tiêu chí" };

  const parsed = criterionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  const created = await db.reportCardCriterion.create({
    data: { courseId: d.courseId, name: d.name, order: d.order, active: true },
    select: { id: true },
  });
  await writeAudit({
    actor: ctx.auditActor,
    module: AUDIT_MODULE,
    entityType: "ReportCardCriterion",
    entityId: created.id,
    action: "CREATE",
    newValues: { courseId: d.courseId, name: d.name },
  });

  revalidatePath("/admin/report-cards/criteria");
  return { ok: true };
}

export async function toggleCriterionAction(input: unknown): Promise<Result> {
  const ctx = await authContext();
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Không có quyền" };
  if (!ctx.capabilities.includes("review")) return { ok: false, error: "Chỉ Đào tạo/Quản lý cấu hình tiêu chí" };

  const parsed = z.object({ id: z.string().min(1), active: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };

  await db.reportCardCriterion.update({ where: { id: parsed.data.id }, data: { active: parsed.data.active } });
  await writeAudit({
    actor: ctx.auditActor,
    module: AUDIT_MODULE,
    entityType: "ReportCardCriterion",
    entityId: parsed.data.id,
    action: "UPDATE",
    newValues: { active: parsed.data.active },
  });

  revalidatePath("/admin/report-cards/criteria");
  return { ok: true };
}
