/**
 * ƯU ĐÃI KHAI GIẢNG SATA ROBO 2026 — nguồn sự thật DUY NHẤT cho mọi
 * con số/mốc thời gian của chương trình ưu đãi + quà tặng trên site public.
 *
 * LÝ DO FILE NÀY TỒN TẠI: trước 18/08/2026 site chạy song song 4 mức giảm
 * ("đến 30%" trang chủ · "15%" landing · "45%" online · "50%" SEO meta), 3 mốc
 * hết hạn (10/05/2026 đã qua · 31/12/2026 · countdown tự reset mỗi Chủ nhật)
 * và 2 cách tính tổng quà (banner "2 triệu" vs 4 món cộng lại = 1.840.000đ).
 * Mỗi bề mặt tự khai số của mình nên không ai phát hiện lệch.
 *
 * LUẬT: KHÔNG hardcode lại các số này ở component. Import từ đây.
 * Đổi chính sách = sửa đúng file này (+ bảng giá trong
 * components/legacy-laptrinhrobot/_data/courses-pricing.ts nếu đổi giá).
 */

/** Cửa sổ áp dụng chương trình. */
export const PROGRAM_START = new Date("2026-08-18T00:00:00+07:00");
export const PROGRAM_END = new Date("2026-12-31T23:59:59+07:00");

/** Nhãn hiển thị của hạn chương trình — dùng trong copy marketing. */
export const PROGRAM_END_LABEL = "31/12/2026";

/** Tên chương trình hợp nhất — dùng thống nhất ở mọi bề mặt. */
export const PROGRAM_NAME = "Ưu đãi Khai giảng Sata Robo 2026";

/**
 * Mức giảm học phí TỐI ĐA, suy ra từ bảng giá thật:
 *  - offline: Sata3–Sata7 giảm 25% (mức sâu nhất) — xem courses-pricing.ts
 *  - online : Luyện thi R2 890.000 → 490.000 = 44,9% ≈ 45%
 * Sata8 giá cố định, KHÔNG giảm.
 */
export const MAX_DISCOUNT_OFFLINE = 25;
export const MAX_DISCOUNT_ONLINE = 45;

/** Câu headline giảm giá — dùng nguyên văn, đừng chế biến thể mới. */
export const DISCOUNT_HEADLINE = `Giảm đến ${MAX_DISCOUNT_OFFLINE}% khoá offline, đến ${MAX_DISCOUNT_ONLINE}% khoá luyện thi online`;

/**
 * Tổng giá trị bộ quà tặng = tổng 4 món trong
 * components/legacy-laptrinhrobot/_data/gifts.ts
 * (200.000 + 490.000 + 150.000 + 1.000.000).
 */
export const TOTAL_GIFT_VALUE = "1.840.000đ";

/** Buổi học thử 1-1 — móc câu duy nhất, thay toàn bộ "suất học miễn phí" cũ. */
export const TRIAL_LABEL = "buổi học thử 1-1 miễn phí";
export const TRIAL_LABEL_TITLE = "Buổi học thử 1-1 miễn phí";
export const TRIAL_TEST_MINUTES = 45;
export const TRIAL_SESSION_MINUTES = 90;
