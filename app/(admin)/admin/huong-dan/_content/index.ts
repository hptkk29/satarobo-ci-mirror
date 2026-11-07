import { ADMIN_GUIDES } from "./guides.generated";
import type { AdminGuide } from "./types";

export type { AdminGuide };

/** Thứ tự nhóm hiển thị trên trang hub — gom theo khối nghiệp vụ của sidebar. */
export const GUIDE_CATEGORIES = [
  "Bắt đầu",
  "Tuyển sinh & CSKH",
  "Đào tạo & Lớp học",
  "Nhân sự & Giáo viên",
  "Tài chính & Kho",
  "Website & Hệ thống",
  "Báo cáo",
] as const;

const sorted = [...ADMIN_GUIDES].sort((a, b) => a.order - b.order);

export function allGuides(): AdminGuide[] {
  return sorted;
}

export function guidesByCategory(): { category: string; guides: AdminGuide[] }[] {
  return GUIDE_CATEGORIES.map((category) => ({
    category,
    guides: sorted.filter((g) => g.category === category),
  })).filter((group) => group.guides.length > 0);
}

export function getGuide(slug: string): AdminGuide | undefined {
  return sorted.find((g) => g.slug === slug);
}

/** Bài trước/sau theo thứ tự đọc — cho footer điều hướng ở trang chi tiết. */
export function adjacentGuides(slug: string): {
  prev?: AdminGuide;
  next?: AdminGuide;
} {
  const i = sorted.findIndex((g) => g.slug === slug);
  if (i < 0) return {};
  return { prev: sorted[i - 1], next: sorted[i + 1] };
}
