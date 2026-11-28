import { TEACHER_GUIDES } from "./guides.generated";
import type { TeacherGuide } from "./types";

export type { TeacherGuide };

/** Thứ tự nhóm hiển thị trên trang hub — khớp nhóm sidebar + nhóm mở đầu/tài khoản. */
export const GUIDE_CATEGORIES = [
  "Bắt đầu",
  "Giảng dạy",
  "Học thử (Trial)",
  "Học viên & Học bạ",
  "Ca & Chấm công",
  "Tài khoản",
] as const;

const sorted = [...TEACHER_GUIDES].sort((a, b) => a.order - b.order);

export function allGuides(): TeacherGuide[] {
  return sorted;
}

export function guidesByCategory(): {
  category: string;
  guides: TeacherGuide[];
}[] {
  return GUIDE_CATEGORIES.map((category) => ({
    category,
    guides: sorted.filter((g) => g.category === category),
  })).filter((group) => group.guides.length > 0);
}

export function getGuide(slug: string): TeacherGuide | undefined {
  return sorted.find((g) => g.slug === slug);
}

/** Bài trước/sau theo thứ tự đọc — cho footer điều hướng ở trang chi tiết. */
export function adjacentGuides(slug: string): {
  prev?: TeacherGuide;
  next?: TeacherGuide;
} {
  const i = sorted.findIndex((g) => g.slug === slug);
  if (i < 0) return {};
  return { prev: sorted[i - 1], next: sorted[i + 1] };
}
