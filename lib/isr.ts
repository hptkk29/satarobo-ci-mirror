/**
 * REQ-11 — Convention ISR `revalidate` (giây) cho trang public.
 *
 * ⚠️ Next yêu cầu `export const revalidate` là LITERAL tĩnh (phân tích lúc build) →
 * KHÔNG import được hằng số này vào segment config. Vì vậy các page vẫn đặt số literal,
 * kèm comment tham chiếu tên dưới đây để đồng bộ ý định.
 *
 *   - LIST (trang danh sách): 60s  → `ISR_LIST`
 *   - DETAIL (trang chi tiết): 300s → `ISR_DETAIL`
 *
 * Ngoại lệ CÓ CHỦ ĐÍCH (giữ nguyên):
 *   - khoa-hoc/[slug] = 60 (course landing cần tươi hơn, có comment tại chỗ)
 *   - OG image routes = 3600
 */
export const ISR_LIST = 60;
export const ISR_DETAIL = 300;
