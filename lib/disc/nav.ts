/**
 * Nguồn DUY NHẤT cho mục điều hướng DISC. Header desktop, drawer mobile và nút nổi đều
 * đọc từ đây — đúng lớp lỗi `[PUBLIC-NAV-T02]` (hai bản của cùng một thanh điều hướng
 * trôi khỏi nhau). Nhãn là yêu cầu cứng của PRD v2.0: "Khám phá DISC" (KHÔNG thêm
 * "miễn phí" ở menu và nút nổi).
 */
export const DISC_NAV = { label: "Khám phá DISC", href: "/disc" } as const;

/** Chèn mục DISC NGAY TRƯỚC "Liên hệ"; không có "Liên hệ" thì đặt cuối. Cờ tắt ⇒ trả nguyên. */
export function chenMucDisc<T extends { label: string; href: string }>(
  muc: readonly T[],
  bat: boolean,
): Array<T | { label: string; href: string }> {
  if (!bat) return [...muc];
  const i = muc.findIndex((m) => m.href === "/lien-he");
  const viTri = i === -1 ? muc.length : i;
  return [...muc.slice(0, viTri), DISC_NAV, ...muc.slice(viTri)];
}
