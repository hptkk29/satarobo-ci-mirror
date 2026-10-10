// lib/lms/makeup-service.ts — R3-07: vòng đời học bù trên DB (dùng canTransitionMakeup thuần).
import type { MakeupNeed } from "@prisma/client";
import { db } from "@/lib/db";
import { canTransitionMakeup } from "@/lib/lms/makeup";

export class MakeupError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MakeupError";
    this.code = code;
  }
}

/** C7.3 — PH/staff tạo yêu cầu học bù (PENDING). Idempotent theo (HS, buổi lỡ). */
export async function requestMakeup(input: {
  studentId: string;
  classId: string;
  missedSessionId: string;
  centerId?: string | null;
  createdById?: string | null;
}): Promise<MakeupNeed> {
  const existing = await db.makeupNeed.findFirst({
    where: { studentId: input.studentId, missedSessionId: input.missedSessionId, status: { in: ["PENDING", "SCHEDULED"] } },
  });
  if (existing) return existing;
  return db.makeupNeed.create({
    data: {
      studentId: input.studentId,
      classId: input.classId,
      missedSessionId: input.missedSessionId,
      centerId: input.centerId ?? null,
      createdById: input.createdById ?? null,
    },
  });
}

async function transition(needId: string, to: "SCHEDULED" | "COMPLETED" | "CANCELLED", extra: Record<string, unknown> = {}): Promise<MakeupNeed> {
  const need = await db.makeupNeed.findUnique({ where: { id: needId } });
  if (!need) throw new MakeupError("NOT_FOUND", "Không tìm thấy yêu cầu học bù.");
  if (!canTransitionMakeup(need.status, to)) {
    throw new MakeupError("INVALID_TRANSITION", `Không thể chuyển ${need.status} → ${to}.`);
  }
  return db.makeupNeed.update({ where: { id: needId }, data: { status: to, ...extra } });
}

/** C7.1 — xếp buổi bù (PENDING → SCHEDULED). */
export async function scheduleMakeup(needId: string, makeupSessionId: string, scheduledById?: string): Promise<MakeupNeed> {
  return transition(needId, "SCHEDULED", { makeupSessionId, scheduledById: scheduledById ?? null });
}

/** C7.1 — hoàn tất học bù (SCHEDULED → COMPLETED). */
export async function completeMakeup(needId: string): Promise<MakeupNeed> {
  return transition(needId, "COMPLETED", { completedAt: new Date() });
}
