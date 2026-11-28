// lib/eval/rounds.ts — R7-16: EvaluationRound CRUD + đóng/mở (AC3/AC5).
import { z } from "zod";
import type { EvaluationRoundStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { EVAL_SCOPES } from "@/lib/eval/schema";

export const roundInputSchema = z
  .object({
    formId: z.string().min(1, "Chọn form"),
    name: z.string().trim().min(1, "Tên đợt không được trống").max(200),
    scope: z.enum(EVAL_SCOPES),
    centerId: z.string().trim().optional().nullable(),
    courseId: z.string().trim().optional().nullable(),
    opensAt: z.string().trim().optional().nullable(),
    closesAt: z.string().trim().optional().nullable(),
  })
  .superRefine((r, ctx) => {
    // CENTER_SURVEY cần centerId để xác định PH đủ điều kiện (AC5).
    if (r.scope === "CENTER_SURVEY" && !r.centerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Khảo sát cơ sở cần chọn cơ sở", path: ["centerId"] });
    }
  });

export type RoundInput = z.infer<typeof roundInputSchema>;

/** Đợt đang MỞ thực sự: status OPEN và (nếu có) trong khoảng opens/closes. */
export function isRoundOpen(
  round: { status: EvaluationRoundStatus; opensAt: Date | null; closesAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (round.status !== "OPEN") return false;
  if (round.opensAt && now < round.opensAt) return false;
  if (round.closesAt && now > round.closesAt) return false;
  return true;
}

export async function createRound(input: RoundInput) {
  return db.evaluationRound.create({
    data: {
      formId: input.formId,
      name: input.name,
      scope: input.scope,
      centerId: input.centerId?.trim() || null,
      courseId: input.courseId?.trim() || null,
      opensAt: input.opensAt ? new Date(input.opensAt) : null,
      closesAt: input.closesAt ? new Date(input.closesAt) : null,
      status: "DRAFT",
    },
  });
}

export async function setRoundStatus(roundId: string, status: EvaluationRoundStatus) {
  const round = await db.evaluationRound.update({ where: { id: roundId }, data: { status } });
  // R7-17 — đợt chuyển sang MỞ → thông báo HV/PH đủ điều kiện (handler eval-notif).
  // dedupeKey ổn định theo roundId: replay/đổi-lại-trạng-thái KHÔNG tạo event trùng.
  if (status === "OPEN") {
    await publishEvent(
      "eval.opened",
      {
        roundId: round.id,
        scope: round.scope,
        centerId: round.centerId,
        courseId: round.courseId,
      },
      { dedupeKey: `eval.opened:${round.id}` },
    );
  }
  return round;
}

export async function listRounds(opts?: { centerIds?: string[] | null }) {
  // Vá 24/07: mảng RỖNG ≠ null — caller truyền scope per-model, [] nghĩa là "không cơ sở
  // nào" → chỉ thấy đợt SYSTEM (centerId null). Trước đây [] rơi về "không filter" =
  // thấy tất cả. null/undefined = ALL, không filter như cũ.
  const where = opts?.centerIds
    ? { OR: [{ centerId: null }, { centerId: { in: opts.centerIds } }] }
    : {};
  return db.evaluationRound.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      form: { select: { title: true, scope: true } },
      _count: { select: { responses: true } },
    },
  });
}

export async function getRound(roundId: string) {
  return db.evaluationRound.findUnique({
    where: { id: roundId },
    include: { form: { select: { title: true, scope: true } } },
  });
}
