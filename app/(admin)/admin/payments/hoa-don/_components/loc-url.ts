"use client";

// Bộ lọc cơ sở + tháng ĐANG NẰM TRÊN URL của màn Hoá đơn điện tử — để mọi chỗ đổi URL sâu trong ngăn
// xử lý (xác nhận xong → dòng kế tiếp, huỷ xong → dòng hàng chờ) giữ bộ lọc mà không phải khoan prop
// qua từng khối. `BanChungTu` cấp giá trị; mặc định = không lọc (hành vi trước khi có bộ lọc).

import { createContext, useContext } from "react";
import type { LocUrl } from "@/lib/finance/hoa-don/loc-hang-cho";

export const LocUrlContext = createContext<LocUrl>({ coSo: null, thang: null });

export function useLocUrl(): LocUrl {
  return useContext(LocUrlContext);
}
