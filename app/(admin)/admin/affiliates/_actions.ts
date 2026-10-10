"use server";

// BGĐ 31/07 — quản lý NGƯỜI/ĐỐI TÁC GIỚI THIỆU (affiliate).
// Affiliate ∉ SCOPED_MODELS (danh mục dùng chung) → scopedDb pass-through; gate
// bằng quyền leads:assign (vai quản lý lead) như các danh mục CRM khác.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { normalizeAffiliateCode } from "@/lib/affiliate";

type Result = { ok: true; id?: string } | { ok: false; error: string };

const upsertSchema = z.object({
  code: z.string().trim().min(3, "Mã tối thiểu 3 ký tự").max(32),
  name: z.string().trim().min(2, "Nhập tên người giới thiệu").max(120),
  phone: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().email("Email không hợp lệ").optional().or(z.literal("")).nullable(),
  centerId: z.string().trim().optional().nullable(),
  commissionPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  isActive: z.coerce.boolean().default(true),
});

async function gate() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission("leads:assign"))) {
    return { ok: false as const, error: "Không có quyền quản lý nguồn giới thiệu" };
  }
  return { ok: true as const, session };
}

export async function createAffiliateAction(input: unknown): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const code = normalizeAffiliateCode(parsed.data.code);
  if (!code) return { ok: false, error: "Mã giới thiệu không hợp lệ (chữ + số, ≥3 ký tự)" };

  const sdb = scopedDb(await resolveActor(g.session.user.id));
  const dup = await sdb.affiliate.findUnique({ where: { code }, select: { id: true } });
  if (dup) return { ok: false, error: `Mã "${code}" đã tồn tại` };

  const { actorId, actorName } = getAuditActor(g.session);
  const created = await sdb.affiliate.create({
    data: {
      code,
      name: parsed.data.name,
      phone: parsed.data.phone?.trim() || null,
      email: parsed.data.email?.trim() || null,
      centerId: parsed.data.centerId || null,
      commissionPercent: parsed.data.commissionPercent ?? null,
      note: parsed.data.note?.trim() || null,
      isActive: parsed.data.isActive,
      createdById: actorId,
    },
    select: { id: true },
  });

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "crm",
    entityType: "Affiliate",
    entityId: created.id,
    action: "CREATE",
    newValues: { code, name: parsed.data.name },
  });

  revalidatePath("/affiliates");
  return { ok: true, id: created.id };
}

export async function updateAffiliateAction(id: string, input: unknown): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const code = normalizeAffiliateCode(parsed.data.code);
  if (!code) return { ok: false, error: "Mã giới thiệu không hợp lệ (chữ + số, ≥3 ký tự)" };

  const sdb = scopedDb(await resolveActor(g.session.user.id));
  const current = await sdb.affiliate.findUnique({ where: { id }, select: { id: true, code: true } });
  if (!current) return { ok: false, error: "Không tìm thấy nguồn giới thiệu" };

  if (code !== current.code) {
    const dup = await sdb.affiliate.findUnique({ where: { code }, select: { id: true } });
    if (dup) return { ok: false, error: `Mã "${code}" đã tồn tại` };
  }

  const { actorId, actorName } = getAuditActor(g.session);
  await sdb.affiliate.update({
    where: { id },
    data: {
      code,
      name: parsed.data.name,
      phone: parsed.data.phone?.trim() || null,
      email: parsed.data.email?.trim() || null,
      centerId: parsed.data.centerId || null,
      commissionPercent: parsed.data.commissionPercent ?? null,
      note: parsed.data.note?.trim() || null,
      isActive: parsed.data.isActive,
    },
  });

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "crm",
    entityType: "Affiliate",
    entityId: id,
    action: "UPDATE",
    oldValues: { code: current.code },
    newValues: { code, name: parsed.data.name, isActive: parsed.data.isActive },
  });

  revalidatePath("/affiliates");
  return { ok: true, id };
}

/** Gán / gỡ nguồn giới thiệu cho 1 lead (khi khách không vào qua link ref). */
export async function setLeadAffiliateAction(
  leadId: string,
  affiliateId: string | null,
): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;

  const sdb = scopedDb(await resolveActor(g.session.user.id));
  // Lead ∈ SCOPED_MODELS → findUnique lọc hậu kỳ theo cơ sở (chống IDOR chéo CS).
  const lead = await sdb.lead.findUnique({
    where: { id: leadId },
    select: { id: true, centerId: true, affiliateId: true },
  });
  if (!lead) return { ok: false, error: "Không tìm thấy lead" };

  if (affiliateId) {
    const aff = await sdb.affiliate.findFirst({
      where: { id: affiliateId, isActive: true },
      select: { id: true },
    });
    if (!aff) return { ok: false, error: "Nguồn giới thiệu không hợp lệ" };
  }

  const { actorId, actorName } = getAuditActor(g.session);
  await sdb.lead.update({ where: { id: leadId }, data: { affiliateId } });

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "crm",
    entityType: "Lead",
    entityId: leadId,
    action: "UPDATE",
    oldValues: { affiliateId: lead.affiliateId },
    newValues: { affiliateId },
    orgUnitId: lead.centerId,
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/affiliates");
  return { ok: true, id: leadId };
}
