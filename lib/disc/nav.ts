/**
 * Nguồn DUY NHẤT cho nhãn + đường dẫn lối vào DISC. Từ 10/11/2026 lối vào DISC nằm trong nhóm «Góc gia đình»
 * (`lib/public/goc-gia-dinh.ts`) cùng Tủ sách và Sức khỏe — thanh trên, menu điện thoại và nút nổi đều đọc từ đó,
 * đúng lớp lỗi `[PUBLIC-NAV-T02]` (hai bản của cùng một thanh điều hướng trôi khỏi nhau). Nhãn là yêu cầu cứng của
 * PRD v2.0: "Khám phá DISC" (KHÔNG thêm "miễn phí" ở menu và nút nổi).
 */
export const DISC_NAV = { label: "Khám phá DISC", href: "/disc" } as const;
