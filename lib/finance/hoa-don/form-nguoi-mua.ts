// lib/finance/hoa-don/form-nguoi-mua.ts — 8 ô "Người mua trên hoá đơn" + phép đồng bộ với hồ sơ. THUẦN.
//
// Chủ dự án 01/11/2026: khối này nhập đủ — Họ tên học viên · Ngày sinh học viên · Địa chỉ nơi ở · CCCD
// học viên · Họ tên ba/mẹ · SĐT ba/mẹ · CCCD ba/mẹ · Email ba/mẹ. Ba chốt kèm theo:
//   1. ĐẢO luật "không lưu giấy tờ tùy thân học viên" (chỉ CCCD học viên, có che + có xoá NĐ13);
//   2. LƯU TRÊN ĐƠN và link dữ liệu sang hồ sơ học viên;
//   3. đi theo chiều hồ sơ/lead → giá trị khai lúc tạo đơn → hoá đơn, nhưng mọi nơi phải ĐỒNG BỘ,
//      có sẵn ở đâu thì KHÔNG bắt nhập lại.
//
// ── Cách hiểu "có sẵn" ────────────────────────────────────────────────────────────────────────
//   Giá trị HIỆU LỰC của một ô = cột trên ĐƠN nếu có, không thì giá trị ở HỒ SƠ (học viên, rồi phiếu
//   lead). Thứ tự đúng theo chiều dòng chảy ở trên: đơn là thứ người ta đã khai/kiểm cho tờ hoá đơn
//   này, hồ sơ chỉ là chỗ lấy cho khỏi gõ lại.
//
// ── Bấm Lưu thì sao ──────────────────────────────────────────────────────────────────────────
//   · Ghi CẢ 8 ô lên đơn (ô trắng ⇒ null). Bấm Lưu là người dùng đã nhìn từng ô nên "đã khai" mới có
//     nghĩa — khác với việc đơn tự sao chép lúc tạo (xem lời dặn đầu `nguoi-mua.ts`).
//   · Sang HỒ SƠ chỉ đẩy ô (a) người dùng vừa SỬA, hoặc (b) hồ sơ đang TRỐNG. Ô hồ sơ đã có giá trị
//     khác mà người dùng không đụng tới thì KHÔNG bị đè (đơn cũ mang tên cũ không được lật hồ sơ
//     mới) — màn nhắc "Hồ sơ đang ghi …" để họ tự chọn.
//   · Ô để TRỐNG ở hoá đơn KHÔNG xoá ô tương ứng ở hồ sơ.
//
// Không import gì của server ⇒ component client dùng được.

import { canonicalPhone, nationalPhone } from "@/lib/phone";
import { parseVnYmd, vnDateOnly, vnYmd } from "@/lib/time/vn";

export const KHOA_FORM = [
  "hocVienTen",
  "hocVienNgaySinh",
  "hocVienCccd",
  "tinh",
  "phuong",
  "diaChi",
  "phuHuynhTen",
  "phuHuynhSdt",
  "phuHuynhCccd",
  "phuHuynhEmail",
  "donViTen",
  "donViMst",
] as const;
export type KhoaForm = (typeof KHOA_FORM)[number];
export type FormNguoiMua = Record<KhoaForm, string>;

/** Ô có chỗ ở hồ sơ (hai ô "đơn vị" chỉ có trên hoá đơn). */
export const KHOA_CO_HO_SO = KHOA_FORM.filter((k) => k !== "donViTen" && k !== "donViMst");
/** Ba ô địa chỉ đi MỘT KHỐI — trộn tỉnh của bên này với phường của bên kia là địa chỉ không tồn tại. */
const KHOA_DIA_CHI: readonly KhoaForm[] = ["tinh", "phuong", "diaChi"];

export const NHAN_O: Record<KhoaForm, string> = {
  hocVienTen: "Họ và tên học viên",
  hocVienNgaySinh: "Ngày tháng năm sinh học viên",
  hocVienCccd: "Số CCCD của học viên",
  tinh: "Tỉnh / Thành phố",
  phuong: "Phường / Xã",
  diaChi: "Địa chỉ nơi ở",
  phuHuynhTen: "Họ và tên của ba/mẹ",
  phuHuynhSdt: "SĐT của ba/mẹ",
  phuHuynhCccd: "Số CCCD của ba/mẹ",
  phuHuynhEmail: "Email của ba/mẹ",
  donViTen: "Tên đơn vị",
  donViMst: "Mã số thuế",
};

export const FORM_TRONG: FormNguoiMua = Object.fromEntries(KHOA_FORM.map((k) => [k, ""])) as FormNguoiMua;

/** Đúng những cột của `Order` mà 8 ô cần (+ hai ô đơn vị). */
export type DonChoForm = {
  invoiceStudentName: string | null;
  invoiceStudentDob: Date | null;
  invoiceStudentCccd: string | null;
  customerAddress: string | null;
  customerWard: string | null;
  customerCity: string | null;
  invoiceBuyerName: string | null;
  customerName: string | null;
  invoiceParentPhone: string | null;
  customerPhone: string | null;
  customerCccd: string | null;
  invoiceEmail: string | null;
  customerEmail: string | null;
  invoiceCompanyName: string | null;
  invoiceTaxCode: string | null;
};

export const sach = (v: string | null | undefined): string => (v ?? "").trim();

export type NguonO = "don" | "ho-so" | "trong";
export type HieuLuc = { form: FormNguoiMua; nguon: Record<KhoaForm, NguonO> };

/** Những gì CHÍNH cột trên đơn đang nói (chưa nhìn hồ sơ). */
export function formTuDon(don: DonChoForm): FormNguoiMua {
  return {
    hocVienTen: sach(don.invoiceStudentName),
    hocVienNgaySinh: don.invoiceStudentDob ? vnYmd(don.invoiceStudentDob) : "",
    hocVienCccd: sach(don.invoiceStudentCccd),
    tinh: sach(don.customerCity),
    phuong: sach(don.customerWard),
    diaChi: sach(don.customerAddress),
    phuHuynhTen: sach(don.invoiceBuyerName) || sach(don.customerName),
    phuHuynhSdt: sach(don.invoiceParentPhone) || sach(don.customerPhone),
    phuHuynhCccd: sach(don.customerCccd),
    phuHuynhEmail: sach(don.invoiceEmail) || sach(don.customerEmail),
    donViTen: sach(don.invoiceCompanyName),
    donViMst: sach(don.invoiceTaxCode),
  };
}

/**
 * Giá trị HIỆU LỰC từng ô: đơn trước, hồ sơ sau. Khối địa chỉ lấy NGUYÊN KHỐI từ một bên (đơn có bất
 * kỳ ô nào của khối thì lấy khối của đơn).
 */
export function hieuLuc(don: DonChoForm, hoSo: FormNguoiMua): HieuLuc {
  const tuDon = formTuDon(don);
  const form = { ...FORM_TRONG };
  const nguon = Object.fromEntries(KHOA_FORM.map((k) => [k, "trong"])) as Record<KhoaForm, NguonO>;

  const donCoDiaChi = KHOA_DIA_CHI.some((k) => tuDon[k] !== "");
  for (const k of KHOA_FORM) {
    const doiCuaDon = KHOA_DIA_CHI.includes(k) ? donCoDiaChi : tuDon[k] !== "";
    if (doiCuaDon) {
      form[k] = tuDon[k];
      nguon[k] = tuDon[k] !== "" ? "don" : "trong";
    } else if (sach(hoSo[k]) !== "") {
      form[k] = sach(hoSo[k]);
      nguon[k] = "ho-so";
    }
  }
  return { form, nguon };
}

/** Cột `Order` ghi từ form. Ô trắng ⇒ `null` (KHÔNG ghi chuỗi rỗng — "chưa khai" khác "khai ô trắng"). */
export function cotDonTuForm(f: FormNguoiMua) {
  const n = (v: string): string | null => (sach(v) === "" ? null : sach(v));
  const ngay = sach(f.hocVienNgaySinh) === "" ? null : parseVnYmd(f.hocVienNgaySinh);
  return {
    invoiceStudentName: n(f.hocVienTen),
    invoiceStudentDob: ngay ? vnDateOnly(ngay) : null,
    invoiceStudentCccd: n(f.hocVienCccd),
    customerCity: n(f.tinh),
    customerWard: n(f.phuong),
    customerAddress: n(f.diaChi),
    invoiceBuyerName: n(f.phuHuynhTen),
    invoiceParentPhone: n(f.phuHuynhSdt),
    customerCccd: n(f.phuHuynhCccd),
    invoiceEmail: n(f.phuHuynhEmail),
    invoiceCompanyName: n(f.donViTen),
    invoiceTaxCode: n(f.donViMst),
  };
}
export type CotDonTuForm = ReturnType<typeof cotDonTuForm>;
export type CotDon = keyof CotDonTuForm;

/** Cột nào chứa giấy tờ tùy thân — vết ghi chỉ ghi TÊN cột, không ghi giá trị. */
export const COT_NHAY_CAM: ReadonlySet<CotDon> = new Set<CotDon>(["invoiceStudentCccd", "customerCccd"]);

const RONG_TOI_DA = 200;
const CCCD = /^(\d{9}|\d{12})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lỗi đầu tiên của form, hoặc `null`. CHỈ soi ô người dùng ĐÃ ĐỔI so với `banDau`: đơn cũ có thể mang
 * CCCD/SĐT gõ tay kiểu cũ, bắt họ sửa thứ họ không đụng tới là chặn lưu phần đã có.
 */
export function kiemForm(f: FormNguoiMua, banDau: FormNguoiMua, homNay: Date): string | null {
  for (const k of KHOA_FORM) {
    if (sach(f[k]).length > (k === "diaChi" ? 300 : RONG_TOI_DA)) {
      return `${NHAN_O[k]} quá dài (tối đa ${k === "diaChi" ? 300 : RONG_TOI_DA} ký tự)`;
    }
  }
  const doi = (k: KhoaForm) => sach(f[k]) !== sach(banDau[k]);
  if (doi("hocVienNgaySinh") && sach(f.hocVienNgaySinh) !== "") {
    const d = parseVnYmd(f.hocVienNgaySinh);
    if (!d || vnYmd(d) !== sach(f.hocVienNgaySinh)) return "Ngày sinh học viên không hợp lệ";
    if (d.getTime() > homNay.getTime() || d.getUTCFullYear() < 1900) return "Ngày sinh học viên không hợp lệ";
  }
  for (const k of ["hocVienCccd", "phuHuynhCccd"] as const) {
    if (doi(k) && sach(f[k]) !== "" && !CCCD.test(sach(f[k]))) {
      return `${NHAN_O[k]} phải gồm 9 hoặc 12 chữ số`;
    }
  }
  if (doi("phuHuynhSdt") && sach(f.phuHuynhSdt) !== "" && !canonicalPhone(f.phuHuynhSdt)) {
    return "SĐT của ba/mẹ không hợp lệ";
  }
  if (doi("phuHuynhEmail") && sach(f.phuHuynhEmail) !== "" && !EMAIL.test(sach(f.phuHuynhEmail))) {
    return "Email của ba/mẹ không hợp lệ";
  }
  return null;
}

// ─── Sang hồ sơ ──────────────────────────────────────────────────────────────────────────────

function cungNghia(k: KhoaForm, a: string, b: string): boolean {
  if (k === "phuHuynhSdt") {
    const ca = canonicalPhone(a);
    const cb = canonicalPhone(b);
    if (ca && cb) return ca === cb;
  }
  return sach(a) === sach(b);
}

/**
 * Ô nào của form phải ĐẨY sang hồ sơ. `hoSoMuc` = giá trị của CHÍNH nơi sẽ ghi (học viên, hoặc phiếu
 * lead khi chưa có học viên) — không phải bản trộn dùng để hiển thị.
 *
 * Quy tắc: ô không trắng, KHÁC hồ sơ về nghĩa, và (người dùng vừa sửa HOẶC hồ sơ đang trống).
 * Khối địa chỉ qua cổng thì đẩy cả ba ô (ô trắng trong khối ⇒ xoá ô đó ở hồ sơ, để khỏi còn phường cũ
 * của tỉnh khác).
 */
export function oCanDayVaoHoSo(
  form: FormNguoiMua,
  banDau: FormNguoiMua,
  hoSoMuc: FormNguoiMua,
): KhoaForm[] {
  const qua = (k: KhoaForm): boolean => {
    const v = sach(form[k]);
    if (v === "") return false;
    if (cungNghia(k, v, hoSoMuc[k])) return false;
    return sach(banDau[k]) !== v || sach(hoSoMuc[k]) === "";
  };
  const ra: KhoaForm[] = [];
  const diaChi = KHOA_DIA_CHI.some(qua);
  for (const k of KHOA_CO_HO_SO) {
    if (KHOA_DIA_CHI.includes(k)) {
      if (diaChi) ra.push(k);
    } else if (qua(k)) ra.push(k);
  }
  return ra;
}

/** Patch dạng HỒ SƠ HỌC VIÊN cho các ô đẩy sang. Ô không dịch được (SĐT hỏng, ngày hỏng) thì bỏ. */
export type VaChamHoSo = {
  name?: string;
  dateOfBirth?: Date;
  nationalId?: string;
  parentNationalId?: string;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  city?: string | null;
  ward?: string | null;
  address?: string | null;
};

export function vaChamTuForm(form: FormNguoiMua, ds: readonly KhoaForm[]): VaChamHoSo {
  const co = (k: KhoaForm) => ds.includes(k);
  const out: VaChamHoSo = {};
  if (co("hocVienTen")) out.name = sach(form.hocVienTen);
  if (co("hocVienNgaySinh")) {
    // Hồ sơ HV lưu ngày sinh là nửa đêm UTC của ngày đó (form hồ sơ ghi `new Date("YYYY-MM-DD")`) —
    // cùng quy ước với cột `@db.Date` của LeadChild, nên KHÔNG dùng 00:00 giờ VN (lùi một ngày).
    const d = parseVnYmd(form.hocVienNgaySinh);
    if (d) out.dateOfBirth = vnDateOnly(d);
  }
  if (co("hocVienCccd")) out.nationalId = sach(form.hocVienCccd);
  if (co("phuHuynhCccd")) out.parentNationalId = sach(form.phuHuynhCccd);
  if (co("phuHuynhTen")) out.parentName = sach(form.phuHuynhTen);
  if (co("phuHuynhSdt")) {
    const s = nationalPhone(form.phuHuynhSdt);
    if (s) out.parentPhone = s;
  }
  if (co("phuHuynhEmail")) out.parentEmail = sach(form.phuHuynhEmail);
  if (KHOA_DIA_CHI.some(co)) {
    out.city = sach(form.tinh) || null;
    out.ward = sach(form.phuong) || null;
    out.address = sach(form.diaChi) || null;
  }
  return out;
}
