// lib/finance/hoa-don/khoi-nguoi-mua.ts — view-model khối "Người mua trên hoá đơn" của trang đơn. THUẦN.
//
// Dựng ở SERVER từ bản ghi đơn THẬT (chưa che), rồi mới che theo `orders:view-pii` — PLAN GĐ 7 mục 12
// (lỗ có sẵn, vá 29/09):
//   · người thiếu quyền xem thông tin khách KHÔNG thấy MST, CCCD, địa chỉ, email hoá đơn đầy đủ;
//   · "còn thiếu gì để xuất" (`thieuChoHoaDon`) + `daKhai` tính trên dữ liệu THẬT — tính trên bản đã che là
//     nhãn nói dối (MST đã che không qua regex 10/12/13 số ⇒ "cần bổ sung" oan; địa chỉ ẩn ⇒ "thiếu địa chỉ");
//   · ⚠️ BẪY: form sửa khởi tạo bằng giá trị đang HIỆN ⇒ che ở đó thì bấm Lưu là ghi bản đã che đè dữ liệu
//     thật. Nên thiếu quyền ⇒ `giaTriSua = null` ⇒ KHÔNG có form sửa (và action cũng tự chặn —
//     `luuThongTinHoaDonAction`). Giá trị thật chỉ rời server khi người xem có quyền.
// Hàm che: `maskEmail` / `maskPhone` (hàm che duy nhất của repo, `lib/utils.ts`) — MST và CCCD là chuỗi số,
// che cùng kiểu SĐT (giữ 3 đầu + 3 cuối). Địa chỉ không có hàm che ⇒ ẩn hẳn.

import { maskEmail, maskPhone } from "@/lib/utils";
import { daKhaiHoaDon, nguoiMuaChoDon, thieuChoHoaDon, type DonChoHoaDon, type ThieuChoHoaDon } from "./nguoi-mua";

export const NHAN_DA_AN = "Đã ẩn — cần quyền xem thông tin khách";

export type KhoiNguoiMua = {
  xemPii: boolean;
  hoTen: string;
  /** Họ tên đang rơi về tên khách hàng (chưa khai riêng cho hoá đơn). */
  hoTenTheoKhach: boolean;
  tenDonVi: string | null;
  /** Đã che khi `!xemPii`. */
  maSoThue: string | null;
  cccd: string | null;
  /** `null` khi không có; khi `!xemPii` mà có ⇒ `NHAN_DA_AN`. */
  diaChi: string | null;
  email: string | null;
  emailTheoKhach: boolean;
  thieu: ThieuChoHoaDon;
  daKhai: boolean;
  /**
   * Giá trị THẬT của bốn ô sửa được — CHỈ khi `xemPii`. `null` ⇒ không có form sửa: khởi tạo form bằng bản
   * đã che rồi Lưu là ghi đè dữ liệu thật bằng chuỗi đã che.
   */
  giaTriSua: {
    invoiceBuyerName: string;
    invoiceCompanyName: string;
    invoiceTaxCode: string;
    invoiceEmail: string;
    /** Gợi ý trong ô (tên / email khách hàng) — cũng là PII nên chỉ đi cùng form. */
    goiYTen: string | null;
    goiYEmail: string | null;
  } | null;
};

export function khoiNguoiMuaHoaDon(don: DonChoHoaDon, xemPii: boolean): KhoiNguoiMua {
  const nm = nguoiMuaChoDon(don);
  const che = <T extends string | null>(v: T, f: (s: string) => string): string | null =>
    v == null ? null : xemPii ? v : f(v);
  return {
    xemPii,
    hoTen: nm.hoTen,
    hoTenTheoKhach: !don.invoiceBuyerName?.trim() && Boolean(nm.hoTen),
    tenDonVi: nm.tenDonVi,
    maSoThue: che(nm.maSoThue, maskPhone),
    cccd: che(nm.cccd, maskPhone),
    diaChi: che(nm.diaChi, () => NHAN_DA_AN),
    email: che(nm.email, maskEmail),
    emailTheoKhach: !don.invoiceEmail?.trim() && Boolean(nm.email),
    thieu: thieuChoHoaDon(nm),
    daKhai: daKhaiHoaDon(don),
    giaTriSua: xemPii
      ? {
          invoiceBuyerName: don.invoiceBuyerName ?? "",
          invoiceCompanyName: don.invoiceCompanyName ?? "",
          invoiceTaxCode: don.invoiceTaxCode ?? "",
          invoiceEmail: don.invoiceEmail ?? "",
          goiYTen: don.customerName,
          goiYEmail: don.customerEmail,
        }
      : null,
  };
}
