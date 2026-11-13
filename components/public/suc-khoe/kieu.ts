/** Kiểu dữ liệu của trang «Sức khỏe cả nhà». Toàn bộ nằm TRÊN MÁY người dùng (localStorage) — không có kiểu nào đi lên máy chủ. */

export type GiaTri = string | number | undefined;
export type TraLoi = Record<string, GiaTri>;

export type Luot = {
  id: string;
  ngay: string;
  tl: TraLoi;
  /** Id các câu xoay vòng đã hỏi trong lượt này. */
  xoay: string[];
  /** Câu xoay vòng → chỉ số lựa chọn đã chọn. */
  xtl: Record<string, number>;
};

export type GioiTinh = "nu" | "nam";

export type Nguoi = {
  id: string;
  ten: string;
  vt: string;
  ns: string;
  gt: GioiTinh;
  /** Đang mang thai / cho con bú (chỉ nữ trưởng thành). */
  mt?: boolean;
  viDu?: boolean;
  /** Mọi id câu xoay vòng người này ĐÃ THẤY — không bao giờ hỏi lại. */
  daThay: string[];
  /** Mới nhất đứng đầu; giữ tối đa `TOI_DA_LUOT`. */
  luot: Luot[];
};

export type Phien = {
  mid: string;
  buoc: number;
  tl: TraLoi;
  xoay: string[] | null;
  xtl: Record<string, number>;
  loi: string;
};

export type ThemNguoi = { mo: boolean; ten: string; vt: string; ns: string; gt: GioiTinh; mt: boolean; loi: string };

export type Hop = { loai: "day"; chon: string | null } | { loai: "nguoi"; nid: string; ten: string };

export type TrangThai = {
  ds: Nguoi[];
  them: ThemNguoi;
  ph: Phien | null;
  kqId: string | null;
  thu: Record<string, boolean[]>;
  toast: string;
  hop: Hop | null;
  moiNhat: string | null;
  vuaXong: string | null;
};

export const THEM_TRONG: ThemNguoi = { mo: false, ten: "", vt: "Con", ns: "", gt: "nu", mt: false, loi: "" };
