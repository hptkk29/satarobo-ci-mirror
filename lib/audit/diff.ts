// lib/audit/diff.ts — tiện ích so sánh thay đổi field cho audit.
//
// Tách khỏi log.ts để CẮT VÒNG import: #05 freeze-legacy khiến log.ts import
// `writeAudit` từ audit-log.ts, trong khi audit-log.ts lại import util này từ
// log.ts → no-circular (depcruise error, chặn CI). Leaf thuần (không import gì)
// nên cả log.ts lẫn audit-log.ts import được mà không tạo vòng.

/**
 * So sánh object cũ vs mới, trả danh sách tên field đã đổi.
 * So sánh nông (===). Xử lý riêng Date (so getTime).
 */
export function detectChangedFields<T extends Record<string, unknown>>(
  oldData: T | null | undefined,
  newData: Partial<T>,
): string[] {
  if (!oldData) return Object.keys(newData);
  return Object.keys(newData).filter((key) => {
    const oldVal = oldData[key];
    const newVal = newData[key];
    if (oldVal instanceof Date && newVal instanceof Date) {
      return oldVal.getTime() !== newVal.getTime();
    }
    return oldVal !== newVal;
  });
}
