import { PORTAL_GUIDES } from "./guides.generated";
import type { PortalGuide } from "./types";

export type { PortalGuide };

/** Thứ tự nhóm hiển thị trên trang hub — theo nhóm chức năng shell v2. */
export const GUIDE_CATEGORIES = [
  "Bắt đầu",
  "Theo dõi con",
  "Học phí & yêu cầu",
  "Liên lạc & khảo sát",
  "Cổng học sinh",
  "Tài khoản",
] as const;

const sorted = [...PORTAL_GUIDES].sort((a, b) => a.order - b.order);

export function allGuides(): PortalGuide[] {
  return sorted;
}

export function guidesByCategory(): {
  category: string;
  guides: PortalGuide[];
}[] {
  return GUIDE_CATEGORIES.map((category) => ({
    category,
    guides: sorted.filter((g) => g.category === category),
  })).filter((group) => group.guides.length > 0);
}

export function getGuide(slug: string): PortalGuide | undefined {
  return sorted.find((g) => g.slug === slug);
}

/** Bài trước/sau theo thứ tự đọc — cho footer điều hướng ở trang chi tiết. */
export function adjacentGuides(slug: string): {
  prev?: PortalGuide;
  next?: PortalGuide;
} {
  const i = sorted.findIndex((g) => g.slug === slug);
  if (i < 0) return {};
  return { prev: sorted[i - 1], next: sorted[i + 1] };
}
