"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { writeAudit } from "@/lib/audit/audit-log";
import {
  evalFormInputSchema,
  evalQuestionInputSchema,
  createForm,
  replaceQuestions,
  setFormStatus,
  cloneForm,
} from "@/lib/eval/forms";
import { roundInputSchema, createRound, setRoundStatus, getRound } from "@/lib/eval/rounds";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { passesScope } from "@/lib/db-scope";
import { z } from "zod";

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

// Cách ly cơ sở cho EvaluationRound (∈ SCOPED_MODELS + NULL_IS_GLOBAL từ #03 Pha B;
// setRoundStatus/createRound trong lib KHÔNG ép center nên guard THỦ CÔNG ở đây).
// Vá 24/07: bỏ bypass isHoLevel trần → passesScope per-model — role HO chỉ cross-center
// khi CÓ quyền evaluations:* centerScope ALL (Toại TRAINING@HO không còn → hết
// tạo/mở/đóng đợt CS2; đợt CS1 theo CM@CS1 như cũ). Đợt TOÀN HỆ THỐNG (centerId null):
// passesScope trả true cho MỌI actor (semantics NULL_IS_GLOBAL cho ĐỌC) → KHÔNG dùng
// làm guard ghi; đòi SUPER_ADMIN hoặc evaluations:manage centerScope ALL (per-user
// grant ALLOW = ngoại lệ toàn cục, đồng bộ getModelVisibleCenterIds).
function roundCenterInScope(actor: Actor, centerId: string | null): boolean {
  if (!centerId) {
    return (
      actor.isSuperAdmin ||
      actor.grantsAllow.has("evaluations:manage") ||
      actor.permissions.some((p) => p.action === "evaluations:manage" && p.centerScope === "ALL")
    );
  }
  return passesScope("EvaluationRound", { centerId }, actor);
}

async function gate(): Promise<{ ok: true; userId: string; name: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("evaluations:manage"))) return { ok: false, error: "Không có quyền" };
  return { ok: true, userId: session.user.id, name: session.user.name ?? session.user.email ?? "—" };
}

// ─── FORM ───────────────────────────────────────────────────────────────────
export async function createFormAction(input: unknown): Promise<Result<{ id: string }>> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = evalFormInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const form = await createForm(parsed.data, g.userId);
  await writeAudit({
    actor: { id: g.userId, name: g.name },
    module: "evaluations",
    entityType: "EvalForm",
    entityId: form.id,
    action: "CREATE",
    newValues: { title: form.title, scope: form.scope, questions: parsed.data.questions.length },
  });
  revalidatePath("/admin/evaluations");
  return { ok: true, data: { id: form.id } };
}

export async function updateQuestionsAction(formId: string, questions: unknown): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = z.array(evalQuestionInputSchema).min(1).safeParse(questions);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const res = await replaceQuestions(formId, parsed.data);
  if (!res.ok) return res; // edit-lock (AC2)
  await writeAudit({
    actor: { id: g.userId, name: g.name },
    module: "evaluations",
    entityType: "EvalForm",
    entityId: formId,
    action: "UPDATE",
    newValues: { questions: parsed.data.length },
  });
  revalidatePath("/admin/evaluations");
  revalidatePath(`/admin/evaluations/${formId}`);
  return { ok: true };
}

export async function setFormStatusAction(
  formId: string,
  status: "DRAFT" | "ACTIVE" | "ARCHIVED",
): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  if (!["DRAFT", "ACTIVE", "ARCHIVED"].includes(status)) return { ok: false, error: "Trạng thái không hợp lệ" };

  await setFormStatus(formId, status);
  await writeAudit({
    actor: { id: g.userId, name: g.name },
    module: "evaluations",
    entityType: "EvalForm",
    entityId: formId,
    action: "UPDATE",
    newValues: { status },
  });
  revalidatePath("/admin/evaluations");
  revalidatePath(`/admin/evaluations/${formId}`);
  return { ok: true };
}

export async function cloneFormAction(formId: string): Promise<Result<{ id: string }>> {
  const g = await gate();
  if (!g.ok) return g;
  const clone = await cloneForm(formId, g.userId);
  if (!clone) return { ok: false, error: "Không tìm thấy form" };
  await writeAudit({
    actor: { id: g.userId, name: g.name },
    module: "evaluations",
    entityType: "EvalForm",
    entityId: clone.id,
    action: "CREATE",
    reason: `Nhân bản từ form ${formId}`,
  });
  revalidatePath("/admin/evaluations");
  return { ok: true, data: { id: clone.id } };
}

// ─── ROUND ────────────────────────────────────────────────────────────────────
export async function createRoundAction(input: unknown): Promise<Result<{ id: string }>> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = roundInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  // Cách ly cơ sở (vá 24/07): tạo đợt cho cơ sở chỉ khi cơ sở thuộc scope per-model
  // (đợt toàn hệ thống centerId=null → SUPER_ADMIN / evaluations:manage scope ALL).
  const actor = await resolveActor(g.userId);
  if (!roundCenterInScope(actor, parsed.data.centerId?.trim() || null)) {
    return { ok: false, error: "Không có quyền tạo đợt cho cơ sở này" };
  }

  const round = await createRound(parsed.data);
  await writeAudit({
    actor: { id: g.userId, name: g.name },
    module: "evaluations",
    entityType: "EvaluationRound",
    entityId: round.id,
    action: "CREATE",
    newValues: { name: round.name, scope: round.scope, centerId: round.centerId, courseId: round.courseId },
  });
  revalidatePath("/admin/evaluations");
  return { ok: true, data: { id: round.id } };
}

export async function setRoundStatusAction(
  roundId: string,
  status: "DRAFT" | "OPEN" | "CLOSED",
): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  if (!["DRAFT", "OPEN", "CLOSED"].includes(status)) return { ok: false, error: "Trạng thái không hợp lệ" };

  // Cách ly cơ sở (vá 24/07): đổi trạng thái đợt gắn cơ sở chỉ khi cơ sở thuộc scope
  // per-model của actor (đợt SYSTEM → SUPER_ADMIN / evaluations:manage scope ALL).
  const round = await getRound(roundId);
  if (!round) return { ok: false, error: "Không tìm thấy đợt đánh giá" };
  const actor = await resolveActor(g.userId);
  if (!roundCenterInScope(actor, round.centerId)) {
    return { ok: false, error: "Không có quyền đổi trạng thái đợt của cơ sở này" };
  }

  await setRoundStatus(roundId, status);
  await writeAudit({
    actor: { id: g.userId, name: g.name },
    module: "evaluations",
    entityType: "EvaluationRound",
    entityId: roundId,
    action: "UPDATE",
    newValues: { status },
  });
  revalidatePath("/admin/evaluations");
  return { ok: true };
}
