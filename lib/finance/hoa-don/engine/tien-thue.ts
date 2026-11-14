// lib/finance/hoa-don/engine/tien-thue.ts — số học DÒNG HOÁ ĐƠN bằng số nguyên VND. THUẦN: không Prisma,
// không DB, không env, không đồng hồ.
//
// Lát S3 của Invoice Hub (docs/ke-toan-hoa-don/hub/00-QUYET-DINH-NEN-TANG.md §3): engine SHADOW — chưa nối vào
// luồng nào, không ghi tiền. Đây là bản "nhiều mức thuế trên một hoá đơn + chiết khấu phân bổ" của
// `tinh-hoa-don.ts` (một mức thuế / một dòng, không chiết khấu). KHÔNG sửa tệp đó: nó đang sống.
//
// ─────────────────────────────────────────────────────────────────────────────
// BỐN LUẬT
//
//   1. MỘT chỗ làm tròn: `lamTronChia` (nửa lên, số nguyên không âm, chia bằng `%` chứ không chia thực). Mọi
//      phép chia tiền trong thư mục này đi qua nó — lưới `[ENG-LUOI-02]` đếm `Math.round` = 0.
//      Bản `tinhDongHoaDon` cũ làm tròn `soTien / 1,08` bằng số thực; hai bản cho CÙNG kết quả với thuế suất
//      nguyên (khoảng cách từ phần dư tới .5 luôn ≥ 1/(2(100+p)) ≫ sai số thực) — `[ENG-TT-05]` quét 10.000
//      số để chứng minh chứ không tin.
//   2. Chiết khấu phân bổ theo TỶ LỆ `soTien` từng dòng, phần lẻ dồn về dòng CUỐI — nhưng KHÔNG quá sức chứa của
//      dòng đó. Bản "dồn hết vào dòng cuối" làm dòng cuối ÂM: dòng [1; 1; 1] chiết khấu 2 ⇒ hai dòng đầu nhận 0,
//      dòng cuối nhận 2 > 1. Phần tràn lùi dần lên các dòng trước (`phanBoChietKhau`). Σ phần = chiết khấu, tuyệt đối.
//   3. `thanhTien`/`tienThue`/`congTien` là NGUỒN SỰ THẬT. `donGia` chỉ là phân số `thanhTien / soLuong` để IN
//      (8.311.111 / 48 buổi không chia hết) — không bao giờ nhân ngược lại để ra tiền, không bao giờ cộng.
//   4. Âm chỉ khi người gọi khai `laDieuChinh: true`. Dòng âm ngoài hoá đơn điều chỉnh là lỗi dữ liệu, không phải
//      "số liệu lạ cứ tính".
//
// Mức thuế `KCT` (không chịu thuế) và `KKKNT` (không kê khai, nộp thuế) là mức RIÊNG, không phải "0%": nhóm theo
// khoá chuỗi (`SUAT:8` · `KCT` · `KKKNT`) chứ không theo số — `tongHoaDon` cũ nhóm theo số nên gộp KCT với 0%.
// Mức nào đúng cho khoản thu nào là câu của kế toán/pháp lý (OD-02, TD-10): engine KHÔNG chứa mức thuế mặc định.

import { KIEU_GIA, type KieuGia } from "../tinh-hoa-don";
import { soTienBangChu } from "../so-tien-bang-chu";

export { KIEU_GIA, type KieuGia };

/** Mức thuế của một dòng. `phanTram` là SỐ NGUYÊN 0–100 (mức GTGT VN đều nguyên); số lẻ bị từ chối, không làm tròn ngầm. */
export type MucThue = { kieu: "SUAT"; phanTram: number } | { kieu: "KCT" } | { kieu: "KKKNT" };

/** Khoá nhóm tổng hợp theo mức thuế: `SUAT:8` · `KCT` · `KKKNT`. */
export function khoaNhomThue(m: MucThue): string {
  return m.kieu === "SUAT" ? `SUAT:${m.phanTram}` : m.kieu;
}

export type CachThuSoBuoi =
  /** "1 Khoá" — số buổi nằm trong phần mô tả tên dòng: `Sata 4 (48 buổi)`, số lượng 1. */
  | "MOT_KHOA_MO_TA_SO_BUOI"
  /** "48 Buổi" — số buổi LÀ số lượng, đơn giá = thành tiền / số buổi. */
  | "SO_BUOI_LA_SO_LUONG";

export type MaLoiTinh =
  | "SO_TIEN_KHONG_NGUYEN"
  | "SO_TIEN_AM"
  | "SO_LUONG_SAI"
  | "THUE_SUAT_SAI"
  | "CHIET_KHAU_SAI"
  | "CHIET_KHAU_QUA_TONG"
  | "CHIET_KHAU_VOI_DIEU_CHINH"
  | "SO_BUOI_SAI"
  | "THIEU_DON_VI_TINH"
  | "KHONG_CO_DONG"
  | "TRUNG_MA_DONG";

export type LoiTinh = { ma: MaLoiTinh; dong: string | null; thongDiep: string };

// ── MỘT CHỖ LÀM TRÒN ──────────────────────────────────────────────────────

/**
 * `tu / mau` làm tròn NỬA LÊN, cho số nguyên không âm. Chia bằng `%` (chính xác với số nguyên an toàn) rồi
 * trừ phần dư — không đi qua phép chia thực. Đây là quy tắc làm tròn DUY NHẤT của engine.
 */
export function lamTronChia(tu: number, mau: number): number {
  const n = 2 * tu + mau;
  const d = 2 * mau;
  return (n - (n % d)) / d;
}

/** `floor(a * b / c)` không tràn 2^53 (tích tiền × tiền có thể quá 9e15). Số nguyên không âm, `c > 0`. */
function nhanChiaSan(a: number, b: number, c: number): number {
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

const laNguyenAnToan = (x: number): boolean => Number.isSafeInteger(x);

// ── TRÌNH BÀY SỐ BUỔI / ĐƠN VỊ TÍNH ───────────────────────────────────────

export type TrinhBayDong = { ten: string; donViTinh: string; soLuong: number; moTaSoBuoi: string | null };

/**
 * Tên + đơn vị + số lượng của dòng KHOÁ HỌC theo chính sách trình bày số buổi. Cả đơn vị lẫn mẫu mô tả là THAM SỐ
 * chính sách (`chinh-sach.ts`) — engine không biết "Khoá"/"Buổi" là chữ gì.
 *
 * `soBuoi` null/0 ⇒ không có số buổi để nói: một dòng, đơn vị khoá, tên giữ nguyên.
 */
export function trinhBaySoBuoi(input: {
  tenGoc: string;
  soBuoi: number | null;
  cach: CachThuSoBuoi;
  donViTinhKhoa: string;
  donViTinhBuoi: string;
  /** Có `{n}` — thay bằng số buổi. Ví dụ `({n} buổi)`. */
  mauMoTaSoBuoi: string;
}): { ok: true; dong: TrinhBayDong } | { ok: false; loi: LoiTinh } {
  const { soBuoi } = input;
  if (soBuoi != null && (!Number.isInteger(soBuoi) || soBuoi < 0)) {
    return { ok: false, loi: { ma: "SO_BUOI_SAI", dong: null, thongDiep: `Số buổi phải là số nguyên không âm (đang: ${soBuoi}).` } };
  }
  if (soBuoi == null || soBuoi === 0) {
    return { ok: true, dong: { ten: input.tenGoc, donViTinh: input.donViTinhKhoa, soLuong: 1, moTaSoBuoi: null } };
  }
  if (input.cach === "SO_BUOI_LA_SO_LUONG") {
    return { ok: true, dong: { ten: input.tenGoc, donViTinh: input.donViTinhBuoi, soLuong: soBuoi, moTaSoBuoi: null } };
  }
  const mota = input.mauMoTaSoBuoi.split("{n}").join(String(soBuoi));
  return { ok: true, dong: { ten: `${input.tenGoc} ${mota}`.trim(), donViTinh: input.donViTinhKhoa, soLuong: 1, moTaSoBuoi: mota } };
}

// ── PHÂN BỔ CHIẾT KHẤU ────────────────────────────────────────────────────

/**
 * Chia `chietKhau` cho các dòng theo tỷ lệ `soTien`. Mỗi dòng nhận `floor(chietKhau × soTien / Σ)`; phần lẻ dồn
 * về dòng CUỐI, rồi lùi dần lên trước khi dòng cuối đã hết sức chứa (`soTien` của nó) — nên không dòng nào âm.
 * Σ kết quả === `chietKhau` với mọi đầu vào hợp lệ (`0 ≤ chietKhau ≤ Σ soTien`).
 *
 * Trả `null` khi đầu vào không hợp lệ (người gọi đã kiểm và báo lỗi có mã; hàm này không ném).
 */
export function phanBoChietKhau(soTien: readonly number[], chietKhau: number): number[] | null {
  if (!laNguyenAnToan(chietKhau) || chietKhau < 0) return null;
  if (soTien.some((s) => !laNguyenAnToan(s) || s < 0)) return null;
  const tong = soTien.reduce((a, b) => a + b, 0);
  if (chietKhau > tong) return null;
  if (soTien.length === 0) return chietKhau === 0 ? [] : null;
  if (tong === 0) return soTien.map(() => 0);

  const phan = soTien.map((s) => nhanChiaSan(chietKhau, s, tong));
  let du = chietKhau - phan.reduce((a, b) => a + b, 0);
  for (let i = soTien.length - 1; i >= 0 && du > 0; i--) {
    const them = Math.min(du, soTien[i]! - phan[i]!);
    phan[i] = phan[i]! + them;
    du -= them;
  }
  return du === 0 ? phan : null;
}

// ── MỘT DÒNG ──────────────────────────────────────────────────────────────

export type DauVaoDongHoaDon = {
  /** Khoá dòng ổn định (vd. `OrderItem.id`) — báo lỗi và snapshot trỏ về đây. */
  ma: string;
  ten: string;
  donViTinh: string;
  /** Số nguyên dương. */
  soLuong: number;
  /** Số tiền CẢ dòng theo đơn (không phải đơn giá), TRƯỚC chiết khấu hoá đơn. VND nguyên. */
  soTien: number;
  mucThue: MucThue;
  kieuGia: KieuGia;
  /** Mô tả số buổi nếu có (chỉ để snapshot). */
  moTaSoBuoi?: string | null;
  /** `<mã chính sách>@v<phiên bản>` đã quyết ra dòng này (chỉ để snapshot). */
  thamChieuChinhSach?: string | null;
};

export type DongHoaDonTinh = {
  ma: string;
  ten: string;
  donViTinh: string;
  soLuong: number;
  soTienGoc: number;
  chietKhau: number;
  soTienSauChietKhau: number;
  thanhTien: number;
  mucThue: MucThue;
  nhomThue: string;
  /** 0 với KCT / KKKNT — chỉ để in; phân biệt bằng `mucThue`. */
  thueSuat: number;
  tienThue: number;
  congTien: number;
  /** Đơn giá TRƯỚC thuế dạng phân số — để IN, không để tính. */
  donGia: { tu: number; mau: number };
  kieuGia: KieuGia;
  /** Ảnh chụp những gì quyết định số tiền của dòng — bất biến khi policy đổi sau này. */
  chup: {
    kieuGia: KieuGia;
    mucThue: MucThue;
    donViTinh: string;
    soLuong: number;
    moTaSoBuoi: string | null;
    thamChieuChinhSach: string | null;
  };
};

/** Thuế + tổng của MỘT dòng, đã có số tiền sau chiết khấu (không âm). */
function thueChoSoTien(soTienKhongAm: number, mucThue: MucThue, kieuGia: KieuGia): { thanhTien: number; tienThue: number; congTien: number } {
  if (mucThue.kieu !== "SUAT") return { thanhTien: soTienKhongAm, tienThue: 0, congTien: soTienKhongAm };
  const p = mucThue.phanTram;
  if (kieuGia === KIEU_GIA.DA_GOM_THUE) {
    // `tienThue` = PHẦN DƯ (soTien − thanhTien), không phải round(thanhTien × p): chỉ cách phần-dư bảo đảm
    // thanhTien + tienThue === soTien với mọi số — số khách trả không được lệch 1đ.
    const thanhTien = lamTronChia(soTienKhongAm * 100, 100 + p);
    return { thanhTien, tienThue: soTienKhongAm - thanhTien, congTien: soTienKhongAm };
  }
  const tienThue = lamTronChia(soTienKhongAm * p, 100);
  return { thanhTien: soTienKhongAm, tienThue, congTien: soTienKhongAm + tienThue };
}

/** Tính MỘT dòng; dòng âm (điều chỉnh) tính trên giá trị tuyệt đối rồi đặt lại dấu — đối xứng, không lệch 1đ giữa +x và −x. */
function tinhMotDong(d: DauVaoDongHoaDon, chietKhau: number): DongHoaDonTinh {
  const sauChietKhau = d.soTien - chietKhau;
  const dau = sauChietKhau < 0 ? -1 : 1;
  const t = thueChoSoTien(Math.abs(sauChietKhau), d.mucThue, d.kieuGia);
  const thanhTien = dau * t.thanhTien;
  return {
    ma: d.ma,
    ten: d.ten,
    donViTinh: d.donViTinh,
    soLuong: d.soLuong,
    soTienGoc: d.soTien,
    chietKhau,
    soTienSauChietKhau: sauChietKhau,
    thanhTien,
    mucThue: d.mucThue,
    nhomThue: khoaNhomThue(d.mucThue),
    thueSuat: d.mucThue.kieu === "SUAT" ? d.mucThue.phanTram : 0,
    tienThue: dau * t.tienThue,
    congTien: dau * t.congTien,
    donGia: { tu: thanhTien, mau: d.soLuong },
    kieuGia: d.kieuGia,
    chup: {
      kieuGia: d.kieuGia,
      mucThue: d.mucThue,
      donViTinh: d.donViTinh,
      soLuong: d.soLuong,
      moTaSoBuoi: d.moTaSoBuoi ?? null,
      thamChieuChinhSach: d.thamChieuChinhSach ?? null,
    },
  };
}

// ── CẢ HOÁ ĐƠN ────────────────────────────────────────────────────────────

export type NhomThueTinh = {
  khoa: string;
  mucThue: MucThue;
  thanhTienTruocThue: number;
  tienThue: number;
  congTien: number;
};

export type TongHoaDonTinh = {
  tongChietKhau: number;
  thanhTienTruocThue: number;
  tienThue: number;
  congTienThanhToan: number;
  theoNhomThue: NhomThueTinh[];
  bangChu: string;
};

export type KetQuaTinh =
  | { ok: true; dong: DongHoaDonTinh[]; tong: TongHoaDonTinh; laDieuChinh: boolean }
  | { ok: false; loi: LoiTinh[] };

function kiemDauVao(dong: readonly DauVaoDongHoaDon[], tongChietKhau: number, laDieuChinh: boolean): LoiTinh[] {
  const loi: LoiTinh[] = [];
  if (dong.length === 0) loi.push({ ma: "KHONG_CO_DONG", dong: null, thongDiep: "Hoá đơn không có dòng nào." });
  const daGap = new Set<string>();
  for (const d of dong) {
    if (daGap.has(d.ma)) loi.push({ ma: "TRUNG_MA_DONG", dong: d.ma, thongDiep: `Mã dòng bị trùng: ${d.ma}.` });
    daGap.add(d.ma);
    if (!laNguyenAnToan(d.soTien)) loi.push({ ma: "SO_TIEN_KHONG_NGUYEN", dong: d.ma, thongDiep: `Số tiền dòng ${d.ma} phải là số nguyên đồng (đang: ${d.soTien}).` });
    else if (d.soTien < 0 && !laDieuChinh) loi.push({ ma: "SO_TIEN_AM", dong: d.ma, thongDiep: `Dòng ${d.ma} âm (${d.soTien}) ngoài hoá đơn điều chỉnh.` });
    if (!Number.isInteger(d.soLuong) || d.soLuong < 1) loi.push({ ma: "SO_LUONG_SAI", dong: d.ma, thongDiep: `Số lượng dòng ${d.ma} phải là số nguyên dương (đang: ${d.soLuong}).` });
    if (d.donViTinh.trim() === "") loi.push({ ma: "THIEU_DON_VI_TINH", dong: d.ma, thongDiep: `Dòng ${d.ma} thiếu đơn vị tính.` });
    if (d.mucThue.kieu === "SUAT" && (!Number.isInteger(d.mucThue.phanTram) || d.mucThue.phanTram < 0 || d.mucThue.phanTram > 100)) {
      loi.push({ ma: "THUE_SUAT_SAI", dong: d.ma, thongDiep: `Thuế suất dòng ${d.ma} phải là số nguyên 0–100 (đang: ${d.mucThue.phanTram}).` });
    }
  }
  if (!laNguyenAnToan(tongChietKhau) || tongChietKhau < 0) {
    loi.push({ ma: "CHIET_KHAU_SAI", dong: null, thongDiep: `Chiết khấu phải là số nguyên không âm (đang: ${tongChietKhau}).` });
  } else if (tongChietKhau > 0 && laDieuChinh) {
    loi.push({ ma: "CHIET_KHAU_VOI_DIEU_CHINH", dong: null, thongDiep: "Hoá đơn điều chỉnh không nhận chiết khấu phân bổ — ghi thẳng số điều chỉnh trên dòng." });
  } else if (tongChietKhau > dong.reduce((s, d) => s + Math.max(0, d.soTien), 0)) {
    loi.push({ ma: "CHIET_KHAU_QUA_TONG", dong: null, thongDiep: "Chiết khấu lớn hơn tổng tiền các dòng." });
  }
  return loi;
}

/**
 * Tính cả hoá đơn: phân bổ chiết khấu → thuế từng dòng → tổng theo nhóm thuế. Đầu vào sai ⇒ `ok: false` kèm MỌI
 * lỗi (không dừng ở lỗi đầu), không bao giờ trả số "gần đúng".
 */
export function tinhHoaDon(input: {
  dong: readonly DauVaoDongHoaDon[];
  /** Chiết khấu cấp hoá đơn, VND nguyên ≥ 0. BẮT BUỘC (luật 7): quên là hoá đơn bán nguyên giá. */
  tongChietKhau: number;
  /** BẮT BUỘC: chỉ hoá đơn điều chỉnh mới được có dòng âm. */
  laDieuChinh: boolean;
}): KetQuaTinh {
  const loi = kiemDauVao(input.dong, input.tongChietKhau, input.laDieuChinh);
  if (loi.length > 0) return { ok: false, loi };

  const phan = input.laDieuChinh ? input.dong.map(() => 0) : phanBoChietKhau(input.dong.map((d) => d.soTien), input.tongChietKhau);
  if (!phan) return { ok: false, loi: [{ ma: "CHIET_KHAU_SAI", dong: null, thongDiep: "Không phân bổ được chiết khấu." }] };

  const dong = input.dong.map((d, i) => tinhMotDong(d, phan[i]!));
  const nhom = new Map<string, NhomThueTinh>();
  for (const d of dong) {
    const cu = nhom.get(d.nhomThue) ?? { khoa: d.nhomThue, mucThue: d.mucThue, thanhTienTruocThue: 0, tienThue: 0, congTien: 0 };
    cu.thanhTienTruocThue += d.thanhTien;
    cu.tienThue += d.tienThue;
    cu.congTien += d.congTien;
    nhom.set(d.nhomThue, cu);
  }
  const theoNhomThue = [...nhom.values()].sort((a, b) => a.khoa.localeCompare(b.khoa));
  const congTienThanhToan = dong.reduce((s, d) => s + d.congTien, 0);
  return {
    ok: true,
    dong,
    laDieuChinh: input.laDieuChinh,
    tong: {
      tongChietKhau: input.tongChietKhau,
      thanhTienTruocThue: dong.reduce((s, d) => s + d.thanhTien, 0),
      tienThue: dong.reduce((s, d) => s + d.tienThue, 0),
      congTienThanhToan,
      theoNhomThue,
      bangChu: soTienBangChu(congTienThanhToan),
    },
  };
}

// ── BẤT BIẾN ──────────────────────────────────────────────────────────────

export type MaBatBien = "BB1" | "BB2" | "BB3" | "BB4" | "BB5" | "BB6" | "BB7";
export type VPBatBien = { ma: MaBatBien; thongDiep: string };

/**
 * Kiểm lại một kết quả đã tính (kể cả kết quả do nơi khác dựng). Rỗng ⇔ đúng.
 *   BB1 Σ dòng = tổng (thành tiền, thuế, cộng tiền)      BB2 mỗi dòng: thành tiền + thuế = cộng tiền
 *   BB3 Σ chiết khấu dòng = chiết khấu hoá đơn           BB4 Σ gốc − chiết khấu = Σ sau chiết khấu
 *   BB5 không dòng âm ngoài điều chỉnh                   BB6 Σ nhóm thuế = tổng
 *   BB7 `tongKhachTra` (nếu có) = cộng tiền thanh toán khi MỌI dòng ĐÃ GỒM thuế
 */
export function kiemBatBien(kq: Extract<KetQuaTinh, { ok: true }>, tongKhachTra: number | null): VPBatBien[] {
  const vp: VPBatBien[] = [];
  const tong = (f: (d: DongHoaDonTinh) => number) => kq.dong.reduce((s, d) => s + f(d), 0);
  if (tong((d) => d.thanhTien) !== kq.tong.thanhTienTruocThue) vp.push({ ma: "BB1", thongDiep: "Σ thành tiền các dòng ≠ tổng trước thuế." });
  if (tong((d) => d.tienThue) !== kq.tong.tienThue) vp.push({ ma: "BB1", thongDiep: "Σ tiền thuế các dòng ≠ tổng tiền thuế." });
  if (tong((d) => d.congTien) !== kq.tong.congTienThanhToan) vp.push({ ma: "BB1", thongDiep: "Σ cộng tiền các dòng ≠ tổng thanh toán." });
  for (const d of kq.dong) {
    if (d.thanhTien + d.tienThue !== d.congTien) vp.push({ ma: "BB2", thongDiep: `Dòng ${d.ma}: thành tiền + thuế ≠ cộng tiền.` });
    // Mỗi kiểu giá bảo đảm MỘT đẳng thức với số tiền khách trả/giá niêm yết sau chiết khấu.
    if (d.mucThue.kieu !== "SUAT" || d.kieuGia === KIEU_GIA.DA_GOM_THUE) {
      if (d.congTien !== d.soTienSauChietKhau) vp.push({ ma: "BB2", thongDiep: `Dòng ${d.ma}: cộng tiền ≠ số tiền sau chiết khấu (giá đã gồm thuế / không chịu thuế).` });
    } else if (d.thanhTien !== d.soTienSauChietKhau) {
      vp.push({ ma: "BB2", thongDiep: `Dòng ${d.ma}: thành tiền ≠ số tiền sau chiết khấu (giá chưa gồm thuế).` });
    }
    if (!kq.laDieuChinh && (d.thanhTien < 0 || d.tienThue < 0 || d.congTien < 0 || d.soTienSauChietKhau < 0 || d.chietKhau < 0)) {
      vp.push({ ma: "BB5", thongDiep: `Dòng ${d.ma} âm ngoài hoá đơn điều chỉnh.` });
    }
  }
  if (tong((d) => d.chietKhau) !== kq.tong.tongChietKhau) vp.push({ ma: "BB3", thongDiep: "Σ chiết khấu các dòng ≠ chiết khấu hoá đơn." });
  if (tong((d) => d.soTienGoc) - kq.tong.tongChietKhau !== tong((d) => d.soTienSauChietKhau)) {
    vp.push({ ma: "BB4", thongDiep: "Σ số tiền gốc − chiết khấu ≠ Σ số tiền sau chiết khấu." });
  }
  const nhomTong = (f: (n: NhomThueTinh) => number) => kq.tong.theoNhomThue.reduce((s, n) => s + f(n), 0);
  if (
    nhomTong((n) => n.thanhTienTruocThue) !== kq.tong.thanhTienTruocThue ||
    nhomTong((n) => n.tienThue) !== kq.tong.tienThue ||
    nhomTong((n) => n.congTien) !== kq.tong.congTienThanhToan
  ) {
    vp.push({ ma: "BB6", thongDiep: "Σ các nhóm thuế ≠ tổng hoá đơn." });
  }
  if (tongKhachTra != null && kq.dong.every((d) => d.mucThue.kieu !== "SUAT" || d.kieuGia === KIEU_GIA.DA_GOM_THUE)) {
    if (kq.tong.congTienThanhToan !== tongKhachTra) vp.push({ ma: "BB7", thongDiep: `Tổng thanh toán ${kq.tong.congTienThanhToan} ≠ số khách trả ${tongKhachTra}.` });
  }
  return vp;
}
