// lib/lms/makeup.ts — R3-07: học bù (MakeupNeed) — không vượt tiến độ + lifecycle (THUẦN).
import type { MakeupNeedStatus } from "@prisma/client";

/**
 * C7.2 — chỉ cho học bù bài có order <= tiến độ hiện tại của lớp (không vượt tiến độ).
 * THUẦN.
 */
export function canMakeupForLesson(makeupLessonOrder: number, classProgressOrder: number): boolean {
  return makeupLessonOrder <= classProgressOrder;
}

/** C7.1 — chuyển trạng thái hợp lệ. THUẦN. */
const MAKEUP_NEXT: Record<MakeupNeedStatus, MakeupNeedStatus[]> = {
  PENDING: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionMakeup(from: MakeupNeedStatus, to: MakeupNeedStatus): boolean {
  return MAKEUP_NEXT[from]?.includes(to) ?? false;
}
