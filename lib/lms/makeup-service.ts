// lib/lms/makeup-service.ts — R3-07: vòng đời học bù trên DB (dùng canTransitionMakeup thuần).
import type { MakeupNeed } from "@prisma/client";
import { db } from "@/lib/db";
import { canTransitionMakeup } from "@/lib/lms/makeup";
import { taoDongHocBu } from "@/lib/hoc-bu/dong-service";

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
  // ĐƯỜNG CHẾT ngoài test (0 caller ở production) — gỡ ở T16. Qua `taoDongHocBu` (T05) để vẫn idempotent theo unique (HS, buổi lỡ).
  const r = await db.$transaction((tx) =>
    taoDongHocBu(tx, {
      studentId: input.studentId,
      missedSessionId: input.missedSessionId,
      nguon: "MANUAL",
      createdById: input.createdById ?? null,
    }),
  );
  // Nguồn MANUAL không bao giờ rơi vào nhánh bảo lưu (chỉ ABSENCE) ⇒ luôn có id.
  if (r.id === null) throw new MakeupError("INVALID_TRANSITION", "Không tạo được yêu cầu học bù.");
  return db.makeupNeed.findUniqueOrThrow({ where: { id: r.id } });
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
