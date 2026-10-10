// lib/bao-luu/hang-so.ts — hằng dùng chung của module bảo lưu. THUẦN.

/** `MakeupNeed.nguon` của buổi bù sinh khi phục học vào lớp đi trước (BR-22) — KHÔNG trừ hạn mức học bù. */
export const NGUON_PHUC_HOC = "PHUC_HOC" as const;

/** Khoá công tắc cơ sở. Chỉ `lib/bao-luu/feature.ts` được đọc nó (lưới `[BL2-FEAT-03]`). */
export const KHOA_CONG_TAC_BAO_LUU = "pause.enabled" as const;
