// lib/lms/checklist.ts — R3-05: checklist GV sau buổi (7 bước → mới "Hoàn tất buổi"). THUẦN.
export const SESSION_CHECKLIST_STEPS = [
  "attendance", // điểm danh
  "lesson", // ghi bài đã dạy
  "feedback", // nhận xét học viên
  "media", // ảnh/clip (nếu có)
  "homework", // giao bài tập
  "incident", // ghi sự cố (nếu có)
  "complete", // xác nhận hoàn tất
] as const;
export type ChecklistStep = (typeof SESSION_CHECKLIST_STEPS)[number];

/** Các bước BẮT BUỘC để hoàn tất (media/incident optional). */
export const REQUIRED_STEPS: ChecklistStep[] = ["attendance", "lesson", "feedback", "homework"];

/** C5.2 — đủ bước bắt buộc mới cho hoàn tất buổi. THUẦN. */
export function isChecklistComplete(doneSteps: string[]): boolean {
  const set = new Set(doneSteps);
  return REQUIRED_STEPS.every((s) => set.has(s));
}

/** Bước bắt buộc còn thiếu (cho UI hiển thị). THUẦN. */
export function missingRequiredSteps(doneSteps: string[]): ChecklistStep[] {
  const set = new Set(doneSteps);
  return REQUIRED_STEPS.filter((s) => !set.has(s));
}
