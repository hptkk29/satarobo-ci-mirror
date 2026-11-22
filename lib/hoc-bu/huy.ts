// Huỷ buổi cần bù / miễn phí ngoại lệ — độ dài lý do tối thiểu (chốt 9: "giải trình lí do").
// Cùng ngưỡng với ngoại lệ hoá đơn (docs/ke-toan-hoa-don/PLAN.md) để người vận hành gặp
// một luật, không hai.
export const LY_DO_TOI_THIEU = 10;

/**
 * Cookie nhớ số dòng/trang của màn Học bù. Ở module THUẦN (không `"use client"`) vì trang RSC
 * phải đọc được giá trị thật — hằng xuất từ tệp client chỉ là tham chiếu (sự cố 12/08 `docSoDong`).
 */
export const COOKIE_SO_DONG_HOC_BU = "hocbu_so_dong";
