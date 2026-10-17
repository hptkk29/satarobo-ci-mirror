/**
 * Thời gian che kết quả referral với cổng đối tác (R9 · N1, docs/source-commission/12 §11.8). Module LÁ (không import gì) để
 * `cua-toi.ts` và `doc-link.ts` cùng dùng mà không tạo vòng phụ thuộc (`cua-toi` import kiểu từ `doc-link`).
 */
export const NGAY_AN_KET_QUA_REFERRAL = 7;
export const MS_AN_KET_QUA_REFERRAL = NGAY_AN_KET_QUA_REFERRAL * 24 * 60 * 60 * 1000;
