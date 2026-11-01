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
import {
  NHAN_O,
  sach,
  type DonChoForm,
  type FormNguoiMua,
  type HieuLuc,
  type KhoaForm,
  type NguonO,
} from "./form-nguoi-mua";

export const NHAN_DA_AN = "Đã ẩn — cần quyền xem thông tin khách";

/** Một dòng của khối (đã che theo quyền). `giaTri = null` ⇒ chưa có ở đâu cả. */
export type OHienThi = { khoa: KhoaForm; nhan: string; giaTri: string | null; nguon: NguonO };

/** Nơi ghi sang khi bấm Lưu (xem `ghi-nguoi-mua.ts`). */
export type NoiGhiRutGon = "HOC_VIEN" | "LEAD" | "KHONG";

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
   * 01/11/2026 — TÁM ô của khối (+ "Tên đơn vị"/"Mã số thuế" khi có), giá trị HIỆU LỰC: đơn trước, hồ sơ
   * học viên / phiếu lead sau. Đã che theo `orders:view-pii`.
   */
  o: OHienThi[];
  /** Số ô đang hiện giá trị lấy từ hồ sơ mà đơn CHƯA lưu — tờ hoá đơn chỉ đọc thứ đã lưu trên đơn. */
  soODangTheoHoSo: number;
  noiGhi: NoiGhiRutGon;
  /**
   * Giá trị THẬT để mở form — CHỈ khi `xemPii`. `null` ⇒ không có form sửa: khởi tạo form bằng bản đã
   * che rồi Lưu là ghi đè dữ liệu thật bằng chuỗi đã che.
   */
  giaTriSua: {
    /** Giá trị hiệu lực — điền sẵn vào form; cũng là `banDau` gửi lại để server biết ô nào bị sửa. */
    form: FormNguoiMua;
    /** Giá trị đang có ở HỒ SƠ — để nhắc khi khác với form ("Hồ sơ đang ghi …"). */
    hoSo: FormNguoiMua;
    nguon: Record<KhoaForm, NguonO>;
  } | null;
};

export type DonChoKhoi = DonChoHoaDon & DonChoForm;

export function khoiNguoiMuaHoaDon(
  don: DonChoKhoi,
  xemPii: boolean,
  tuHoSo: { hieuLuc: HieuLuc; hoSo: FormNguoiMua; noiGhi: NoiGhiRutGon },
): KhoiNguoiMua {
  const nm = nguoiMuaChoDon(don);
  const che = <T extends string | null>(v: T, f: (s: string) => string): string | null =>
    v == null || v === "" ? null : xemPii ? v : f(v);
  const { form, nguon } = tuHoSo.hieuLuc;
  const hien = (khoa: KhoaForm, giaTri: string | null, nguonO: NguonO = nguon[khoa]): OHienThi => ({
    khoa,
    nhan: NHAN_O[khoa],
    giaTri: giaTri === null || giaTri === "" ? null : giaTri,
    nguon: nguonO,
  });
  const diaChiGop = [form.diaChi, form.phuong, form.tinh].map(sach).filter(Boolean).join(", ");
  const o: OHienThi[] = [
    hien("hocVienTen", form.hocVienTen),
    hien("hocVienNgaySinh", che(form.hocVienNgaySinh, () => NHAN_DA_AN)),
    hien("diaChi", che(diaChiGop, () => NHAN_DA_AN)),
    hien("hocVienCccd", che(form.hocVienCccd, maskPhone)),
    hien("phuHuynhTen", form.phuHuynhTen),
    hien("phuHuynhSdt", che(form.phuHuynhSdt, maskPhone)),
    hien("phuHuynhCccd", che(form.phuHuynhCccd, maskPhone)),
    hien("phuHuynhEmail", che(form.phuHuynhEmail, maskEmail)),
  ];
  if (form.donViTen) o.push(hien("donViTen", form.donViTen));
  if (form.donViMst) o.push(hien("donViMst", che(form.donViMst, maskPhone)));

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
    o,
    soODangTheoHoSo: new Set(
      (Object.keys(nguon) as KhoaForm[]).filter((k) => nguon[k] === "ho-so").map((k) => (["tinh", "phuong", "diaChi"].includes(k) ? "diaChi" : k)),
    ).size,
    noiGhi: tuHoSo.noiGhi,
    giaTriSua: xemPii ? { form, hoSo: tuHoSo.hoSo, nguon } : null,
  };
}
