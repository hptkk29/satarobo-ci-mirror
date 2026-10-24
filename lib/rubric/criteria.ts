import type { RubricCriterion, RubricLevel } from "@prisma/client";

// =============================================================================
// Cụm C3 — Định nghĩa rubric robotics (6 tiêu chí, 4 mức). Nguồn chân lý dùng
// chung cho admin (chấm) + portal (hiển thị) + tính điểm quy đổi.
// =============================================================================

export const RUBRIC_CRITERIA: { key: RubricCriterion; label: string; desc: string }[] = [
  { key: "ANALYSIS", label: "Phân tích vấn đề", desc: "Hiểu yêu cầu, xác định bài toán cần giải." },
  { key: "DESIGN", label: "Thiết kế & lắp ráp", desc: "Cấu trúc cơ khí chắc chắn, hợp lý." },
  { key: "PROGRAMMING", label: "Lập trình", desc: "Logic đúng, dùng khối lệnh/biến phù hợp." },
  { key: "TESTING", label: "Kiểm thử & gỡ lỗi", desc: "Chạy thử, phát hiện & sửa lỗi." },
  { key: "CREATIVITY", label: "Sáng tạo", desc: "Giải pháp mới, cải tiến vượt yêu cầu." },
  { key: "PRESENTATION", label: "Trình bày & hợp tác", desc: "Diễn đạt rõ, phối hợp nhóm tốt." },
];

export const RUBRIC_LEVELS: { key: RubricLevel; label: string; points: number; color: string }[] = [
  { key: "NEED_SUPPORT", label: "Cần hỗ trợ", points: 1, color: "text-rose-600" },
  { key: "BASIC", label: "Cơ bản", points: 2, color: "text-amber-600" },
  { key: "GOOD", label: "Tốt", points: 3, color: "text-blue-600" },
  { key: "EXCELLENT", label: "Xuất sắc", points: 4, color: "text-emerald-600" },
];

export const RUBRIC_CRITERION_KEYS = RUBRIC_CRITERIA.map((c) => c.key);
export const RUBRIC_LEVEL_KEYS = RUBRIC_LEVELS.map((l) => l.key);

const LEVEL_POINTS: Record<RubricLevel, number> = {
  NEED_SUPPORT: 1,
  BASIC: 2,
  GOOD: 3,
  EXCELLENT: 4,
};

export function levelLabel(level: RubricLevel): string {
  return RUBRIC_LEVELS.find((l) => l.key === level)?.label ?? String(level);
}

export function criterionLabel(c: RubricCriterion): string {
  return RUBRIC_CRITERIA.find((x) => x.key === c)?.label ?? String(c);
}

/**
 * Quy đổi 6 mức rubric → điểm 0-10. Trung bình mức (1-4) → scale về 10.
 * 6 tiêu chí đủ mới quy đổi; thiếu thì trả null.
 */
export function rubricToScore(levels: { criterion: RubricCriterion; level: RubricLevel }[]): number | null {
  if (levels.length < RUBRIC_CRITERIA.length) return null;
  const sum = levels.reduce((s, l) => s + LEVEL_POINTS[l.level], 0);
  const avg = sum / levels.length; // 1..4
  return Math.round((avg / 4) * 10 * 10) / 10; // 0..10, 1 chữ số thập phân
}
