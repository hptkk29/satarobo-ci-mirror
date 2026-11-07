// lib/settings/gioi-han-tran-hoa-hong.ts — GIỚI HẠN của ô «Trần tổng hoa hồng» (`crm.commissionMaxTotalRate`). LÁ: KHÔNG import gì.
//
// Một nguồn cho hai nơi cần cùng con số: schema của ô trong `registry.ts` (chặn lúc LƯU) và lời khuyên của guardrail hoa hồng («nâng trần có đủ để qua không»,
// `lib/hoa-hong/huong-xu-ly-tran.ts`). Để mỗi nơi gõ riêng 0.2 là hai bản sẽ lệch lần đầu ai đó đổi giới hạn — và lời khuyên sẽ bảo người ta nâng trần tới mức ô không nhận.
// Tách khỏi `registry.ts` để `lib/hoa-hong` (thuần, chạy cả ở client) không phải kéo cả registry.

/** Chặn dưới = tổng 4 tầng Sale hiện hành: đặt thấp hơn là mọi lần lưu cấu hình tỉ lệ đều ném `RATE_EXCEEDS_CAP`, tức khoá luôn màn cấu hình hoa hồng. */
export const TRAN_HOA_HONG_TOI_THIEU = 0.08;

/** Chặn trên của ô. Tổng tỉ lệ hơn mức này thì nâng trần cũng không đủ — chỉ còn cách chỉnh lại tỉ lệ. */
export const TRAN_HOA_HONG_TOI_DA = 0.2;
