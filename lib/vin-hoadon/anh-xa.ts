// lib/vin-hoadon/anh-xa.ts — ánh xạ `PhieuPhatHanh` ⇄ JSON của VIN-HOADON. THUẦN (không mạng, không env, không đồng hồ).
//
// Nguồn: "Hàm tích hợp hóa đơn điện tử — Version 13.0" (PDF quét, VIN-HOADON), số trang = số trang PDF:
//   [GUI]  p66-77   POST …/QuanLyHoaDon/GuiVaKyHoadonGocHSM — gửi + ký HSM trong MỘT lời gọi.
//   [TRA]  p51-54   POST …/TraCuuHoaDon/TraThongTinHoaDon   — tra theo magiaodich hoặc ma_hoadon.
//   [PDF]  p118-119 POST …/TraCuuHoaDon/TaiHoaDonPdfKhongCanThueDuyet → base64pdf.
//   [XML]  p120-121 POST …/TraCuuHoaDon/TaiXmlDaKy                    → base64xml.
//   [MA]   p175-177 Phụ lục 1 — mã kết quả `maketqua`.
//
// ⚠️ Những điều CHƯA kiểm chứng với dịch vụ thật (chưa có sandbox) đều có dấu [?] cạnh chỗ dùng — đừng đọc chúng
// như sự thật cho tới khi có lượt thử sandbox.
//
// Luật ba kết quả (cong.ts): lỗi không chắc chắn ⇒ KHONG_RO, không bao giờ TU_CHOI. TU_CHOI chỉ cho lỗi mà
// CHẮC CHẮN xảy ra trước khi VIN lưu bất cứ thứ gì (tự chặn dữ liệu + mã lỗi dữ liệu/cấu hình + HTTP 400).

import type { DaPhatHanh, KetQuaPhatHanh, KetQuaTraCuu, LoaiTep, PhieuPhatHanh, ThueSuatHoaDon } from "@/lib/misa/meinvoice/cong";

export const MA_TU_CHAN = "DU_LIEU_PHIEU_KHONG_HOP_LE";

// ─── Kiểu body gửi đi ───────────────────────────────────────────────────────────────────────────────

export type VinDongChiTiet = {
  stt: number;
  /** 1 = dịch vụ (học phí là dịch vụ) — [GUI p13]. */
  hanghoa_loai: number;
  ten: string;
  donvitinh: string;
  soluong: number;
  dongia: number;
  tongtien_chuathue: number;
  /** Chỉ với mẫu số 1 (GTGT). -1 không thuế · -2 không kê khai · 0/5/8/10. */
  mathue?: string;
  tongtien_cothue: number;
};

export type VinNhomThue = { mathue: string; tongtien_chiuthue: number; tongtien_thue: number };

export type VinHoaDon = {
  doanhnghiep_mst: string;
  mauso: string;
  kyhieu: string;
  ma_hoadon: string;
  ngaylap: string;
  dnmua_ten?: string;
  dnmua_mst?: string;
  dnmua_tennguoimua?: string;
  dnmua_diachi?: string;
  dnmua_email?: string;
  /** [GUI] `dnmua_khachhang_ma` ≤255 — mã khách hàng kế toán khai (05/11/2026). [?] chưa thử sandbox: VIN có thể tự tạo/đối chiếu danh mục khách theo mã này. */
  dnmua_khachhang_ma?: string;
  thanhtoan_phuongthuc: number;
  thanhtoan_phuongthuc_ten: string;
  tiente_ma: string;
  tongtien_chuavat: number;
  tienthue?: number;
  tongtien_covat: number;
  dschitiet: VinDongChiTiet[];
  dsthuesuat?: VinNhomThue[];
};

// ─── Kiểm phiếu TRƯỚC khi gửi (chắc chắn chưa có hoá đơn) ───────────────────────────────────────────

/** Ký hiệu TT78: [1|2][C|K][yy][chữ][2 ký tự]. VIN tách: `mauso` = chữ số đầu, `kyhieu` = 6 ký tự còn lại [?]. */
const HINH_DANG_KY_HIEU = /^([12])([CK])(\d{2})([A-Z])([A-Z0-9]{2})$/;
const HINH_DANG_MST = /^\d{10}(-\d{3})?$/;
const HINH_DANG_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}$/;

/** [GUI p4/6]: `ma_hoadon` ≤ 50 ký tự. */
const DO_DAI_MA_HOA_DON = 50;
/** [GUI p10]: hoá đơn TRÊN 20 triệu không được chọn tiền mặt. */
const NGUONG_KHONG_TIEN_MAT = 20_000_000;

export function tachKyHieu(kyHieu: string): { mauSo: string; kyHieu6: string } | null {
  const m = HINH_DANG_KY_HIEU.exec(kyHieu.trim().toUpperCase());
  if (!m) return null;
  return { mauSo: m[1]!, kyHieu6: `${m[2]}${m[3]}${m[4]}${m[5]}` };
}

function boDau(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** [GUI p10]: 1 tiền mặt · 2 chuyển khoản · 3 TM/CK. (4 thẻ tín dụng · 5 đối trừ công nợ: phiếu của hệ thống không có.) */
export function maHinhThucThanhToan(ten: string): { ma: 1 | 2 | 3; ten: string } | null {
  const k = boDau(ten);
  if (k === "tien mat") return { ma: 1, ten: "Tiền mặt" };
  if (k === "chuyen khoan") return { ma: 2, ten: "Chuyển khoản" };
  if (k === "tm/ck" || k === "tm / ck" || k === "tien mat/chuyen khoan" || k === "tien mat / chuyen khoan") {
    return { ma: 3, ten: "TM/CK" };
  }
  return null;
}

/**
 * Mã thuế VIN [GUI p15]: -4 CTTC · -2 không kê khai · -1 không thuế · 0 · 5 · 8 · 10.
 * KCT → "-1", KKKNT → "-2" [?: ánh xạ tên KCT/KKKNT sang mã âm là SUY RA từ nghĩa, tài liệu không nêu bảng đối chiếu].
 */
export function maThueVin(t: ThueSuatHoaDon): string | null {
  switch (t) {
    case 0:
      return "0";
    case 5:
      return "5";
    case 8:
      return "8";
    case 10:
      return "10";
    case "KCT":
      return "-1";
    case "KKKNT":
      return "-2";
    default:
      return null;
  }
}

function laSoNguyen(n: number): boolean {
  return Number.isFinite(n) && Number.isInteger(n);
}

function qua(s: string | null | undefined, toiDa: number): boolean {
  return (s?.trim().length ?? 0) > toiDa;
}

/** null = hợp lệ; ngược lại câu lỗi tiếng Việt cho kế toán. KHÔNG in lại giá trị (email/MST là PII). */
export function kiemPhieuVin(p: PhieuPhatHanh): string | null {
  if (!p.refId || !p.refId.trim()) return "Thiếu RefID.";
  if (p.refId.trim().length > DO_DAI_MA_HOA_DON) return `RefID dài quá ${DO_DAI_MA_HOA_DON} ký tự (giới hạn của VIN-HOADON).`;
  const kh = tachKyHieu(p.kyHieu);
  if (!kh) return "Ký hiệu hoá đơn sai dạng (ví dụ đúng: 1C26TSR).";
  if (!HINH_DANG_MST.test(p.mstNguoiBan.trim())) return "MST người bán sai dạng (10 số hoặc 10 số-3 số).";
  if (Number.isNaN(p.ngayHoaDon.getTime())) return "Ngày hoá đơn không hợp lệ.";
  const tt = maHinhThucThanhToan(p.hinhThucThanhToan);
  if (!tt) return "Hình thức thanh toán không hỗ trợ với VIN-HOADON (chỉ nhận Tiền mặt · Chuyển khoản · TM/CK).";
  if (tt.ma === 1 && p.tongThanhToan > NGUONG_KHONG_TIEN_MAT) {
    return "Hoá đơn trên 20 triệu đồng không được chọn hình thức thanh toán tiền mặt (VIN-HOADON).";
  }

  const nm = p.nguoiMua;
  if (!nm.hoTen?.trim() && !nm.donVi?.trim()) return "Thiếu tên người mua (họ tên hoặc tên đơn vị).";
  if (nm.mst?.trim() && !HINH_DANG_MST.test(nm.mst.trim())) return "MST người mua không hợp lệ: phải là 10 chữ số, hoặc 10 số-3 số.";
  if (nm.email?.trim() && !HINH_DANG_EMAIL.test(nm.email.trim())) return "Email người mua không hợp lệ.";
  if (qua(nm.email, 50)) return "Email người mua dài quá 50 ký tự (giới hạn của VIN-HOADON).";
  if (qua(nm.hoTen, 255) || qua(nm.donVi, 255) || qua(nm.diaChi, 255)) return "Tên/địa chỉ người mua dài quá 255 ký tự (giới hạn của VIN-HOADON).";
  if (qua(nm.maKhachHang, 255)) return "Mã khách hàng dài quá 255 ký tự (giới hạn của VIN-HOADON).";

  if (p.dong.length === 0) return "Hoá đơn không có dòng hàng.";
  for (let i = 0; i < p.dong.length; i++) {
    const d = p.dong[i]!;
    if (d.stt !== i + 1) return `Số thứ tự dòng phải liên tục từ 1 (dòng ${i + 1} mang ${d.stt}).`;
    if (!d.ten.trim()) return `Dòng ${d.stt} thiếu tên hàng.`;
    if (qua(d.ten, 255) || qua(d.donViTinh, 255)) return `Dòng ${d.stt}: tên hàng/đơn vị tính dài quá 255 ký tự (giới hạn của VIN-HOADON).`;
    if (!(Number.isFinite(d.soLuong) && d.soLuong > 0)) return `Dòng ${d.stt}: số lượng phải > 0.`;
    if (!(Number.isFinite(d.donGia) && d.donGia >= 0)) return `Dòng ${d.stt}: đơn giá không hợp lệ.`;
    if (!laSoNguyen(d.thanhTien) || d.thanhTien < 0) return `Dòng ${d.stt}: thành tiền phải là số nguyên đồng ≥ 0.`;
    if (!laSoNguyen(d.tienThue) || d.tienThue < 0) return `Dòng ${d.stt}: tiền thuế phải là số nguyên đồng ≥ 0.`;
    if (maThueVin(d.thueSuat) === null) return `Dòng ${d.stt}: thuế suất không hỗ trợ.`;
    if ((d.thueSuat === "KCT" || d.thueSuat === "KKKNT" || d.thueSuat === 0) && d.tienThue !== 0) {
      return `Dòng ${d.stt}: thuế suất không chịu thuế/0% thì tiền thuế phải bằng 0.`;
    }
  }
  const sumTruoc = p.dong.reduce((s, d) => s + d.thanhTien, 0);
  const sumThue = p.dong.reduce((s, d) => s + d.tienThue, 0);
  if (sumTruoc !== p.tongTruocThue) return "Tổng trước thuế không khớp tổng các dòng.";
  if (sumThue !== p.tongThue) return "Tổng tiền thuế không khớp tổng các dòng.";
  if (p.tongTruocThue + p.tongThue !== p.tongThanhToan) return "Tổng thanh toán ≠ trước thuế + thuế.";
  // Mẫu số 2 = hoá đơn bán hàng (02GTTT): không có thuế GTGT [GUI p13/15].
  if (kh.mauSo === "2" && p.tongThue !== 0) return "Hoá đơn bán hàng (ký hiệu bắt đầu bằng 2) không có thuế GTGT nhưng phiếu có tiền thuế.";
  return null;
}

// ─── Ánh xạ phiếu → body ────────────────────────────────────────────────────────────────────────────

/**
 * Ngày lập theo lịch VN, dạng `YYYY-MM-DD hh:mm:ss` [GUI p6]. Chỉ phần ngày có nghĩa ⇒ giờ 00:00:00 (không bao
 * giờ lớn hơn "ngày hiện tại" — mã 12). Cộng 7 giờ rồi đọc trường UTC, không phụ thuộc múi giờ của máy.
 */
export function ngayLapVin(d: Date): string {
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd} 00:00:00`;
}

function lamTron2(n: number): number {
  return Math.round(n * 100) / 100;
}

function datNeuCo(o: Record<string, unknown>, khoa: string, v: string | null | undefined): void {
  const t = v?.trim();
  if (t) o[khoa] = t;
}

/** Gọi SAU `kiemPhieuVin` — không tự kiểm lại. Trả phần BÊN TRONG khoá "hoadon". */
export function phieuSangVin(p: PhieuPhatHanh): VinHoaDon {
  const kh = tachKyHieu(p.kyHieu);
  const tt = maHinhThucThanhToan(p.hinhThucThanhToan);
  if (!kh || !tt) throw new Error("phieuSangVin phải được gọi sau kiemPhieuVin.");
  const coThue = kh.mauSo === "1";

  const dschitiet: VinDongChiTiet[] = p.dong.map((d) => {
    const dong: VinDongChiTiet = {
      stt: d.stt,
      hanghoa_loai: 1,
      ten: d.ten.trim(),
      donvitinh: d.donViTinh.trim(),
      soluong: d.soLuong,
      // [GUI p13]: số làm tròn đến 2 chữ số thập phân.
      dongia: lamTron2(d.donGia),
      tongtien_chuathue: d.thanhTien,
      tongtien_cothue: d.thanhTien + d.tienThue,
    };
    if (coThue) dong.mathue = maThueVin(d.thueSuat) ?? undefined;
    return dong;
  });

  const hoadon: VinHoaDon = {
    doanhnghiep_mst: p.mstNguoiBan.trim(),
    mauso: kh.mauSo,
    kyhieu: kh.kyHieu6,
    // `ma_hoadon` là KHOÁ CHỐNG TRÙNG của hệ thống ta: duy nhất, dùng để tra cứu/thay thế/điều chỉnh [GUI p6].
    ma_hoadon: p.refId.trim(),
    ngaylap: ngayLapVin(p.ngayHoaDon),
    thanhtoan_phuongthuc: tt.ma,
    thanhtoan_phuongthuc_ten: tt.ten,
    tiente_ma: "VND",
    tongtien_chuavat: p.tongTruocThue,
    tongtien_covat: p.tongThanhToan,
    dschitiet,
  };
  const phu = hoadon as unknown as Record<string, unknown>;
  datNeuCo(phu, "dnmua_ten", p.nguoiMua.donVi);
  datNeuCo(phu, "dnmua_tennguoimua", p.nguoiMua.hoTen);
  datNeuCo(phu, "dnmua_mst", p.nguoiMua.mst);
  datNeuCo(phu, "dnmua_diachi", p.nguoiMua.diaChi);
  datNeuCo(phu, "dnmua_email", p.nguoiMua.email);
  datNeuCo(phu, "dnmua_khachhang_ma", p.nguoiMua.maKhachHang);

  if (coThue) {
    hoadon.tienthue = p.tongThue;
    const nhom = new Map<string, VinNhomThue>();
    for (const d of p.dong) {
      const ma = maThueVin(d.thueSuat) ?? "";
      const cu = nhom.get(ma) ?? { mathue: ma, tongtien_chiuthue: 0, tongtien_thue: 0 };
      cu.tongtien_chiuthue += d.thanhTien;
      cu.tongtien_thue += d.tienThue;
      nhom.set(ma, cu);
    }
    hoadon.dsthuesuat = [...nhom.values()];
  }
  return hoadon;
}

// ─── Đọc phản hồi ───────────────────────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

/** Khoá JSON của VIN lẫn hoa/thường giữa các mục (`maketqua`/`maKetQua`, `base64pdf`/`Base64pdf`) ⇒ hạ chữ thường. */
export function docDoiTuong(body: unknown): Rec | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const ra: Rec = {};
  for (const [k, v] of Object.entries(body as Rec)) ra[k.toLowerCase()] = v;
  // Một số mục bọc kết quả trong `result` (p174) — gộp lớp đó lên.
  const trong = ra["result"];
  if (typeof trong === "object" && trong !== null && !Array.isArray(trong)) {
    for (const [k, v] of Object.entries(trong as Rec)) if (!(k.toLowerCase() in ra)) ra[k.toLowerCase()] = v;
  }
  return ra;
}

function chuoi(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** "1" → "01" để so với phụ lục; "-99" giữ nguyên. */
export function chuanHoaMa(v: unknown): string {
  const s = chuoi(v);
  return /^\d$/.test(s) ? `0${s}` : s;
}

/** Phụ lục 1 [MA p175-177] — chỉ những mã mà mã nguồn có phân loại hoặc in ra. */
const MO_TA_MA: Readonly<Record<string, string>> = {
  "01": "Thành công",
  "02": "Không thấy thông tin doanh nghiệp",
  "03": "Trùng hóa đơn",
  "04": "Không thấy thông tin mẫu hóa đơn",
  "08": "Dữ liệu hóa đơn không hợp lệ",
  "11": "Không tìm thấy thông tin hóa đơn",
  "12": "Ngày hóa đơn lớn hơn ngày hiện tại",
  "13": "Không tìm thấy thông tin chứng thư",
  "14": "Ngày hóa đơn không hợp lệ",
  "18": "Mã số thuế không đúng",
  "20": "Hết gói dịch vụ",
  "21": "Lỗi thông tin đăng ký đơn vị",
  "22": "Lỗi ký HSM",
  "23": "Lỗi cấp số hóa đơn",
  "26": "Trùng mã giao dịch",
  "27": "Chứng thư hết hạn",
  "28": "Mẫu hóa đơn đã bị khóa",
  "31": "Phát hành thành công",
  "32": "Phát hành lỗi",
  "33": "Đang xử lý hóa đơn",
  "34": "Phát hành thành công 1 phần",
  "35": "Có lỗi xảy ra trong quá trình tra cứu",
  "42": "Chưa nhập mẫu số",
  "43": "Chưa nhập ký hiệu",
  "44": "Không tìm thấy thông tin mẫu số ký hiệu",
  "49": "Có lỗi xảy ra trong quá trình lập hóa đơn",
  "50": "Không có quyền",
  "51": "Lỗi phát sinh trong quá trình ký",
  "54": "Lỗi phát sinh trong quá trình tải pdf",
  "55": "Lỗi phát sinh trong quá trình tra cứu",
  "-99": "Lỗi ký nhiều",
};

export function moTaMa(ma: string): string {
  return MO_TA_MA[ma] ?? `mã kết quả ${ma}`;
}

/** Thành công của lời gọi gửi+ký: "01" hoặc "31" [?: tài liệu không nói rõ mã nào cho lời gọi này — nhận cả hai]. */
const MA_THANH_CONG_PHAT_HANH = new Set(["01", "31"]);
/** Trùng hoá đơn/mã giao dịch ⇒ có thể ĐÃ có hoá đơn ⇒ tra cứu theo ma_hoadon, không đọc thành từ chối. */
const MA_TRUNG = new Set(["03", "26"]);
/**
 * Chứng thư số của tài khoản có vấn đề: 13 «không tìm thấy thông tin chứng thư», 27 «chứng thư hết hạn».
 * ⚠️ KHÔNG nằm trong `MA_TU_CHOI_CHAC_CHAN`: tài liệu không bảo đảm VIN báo chúng TRƯỚC khi lưu bản nháp, nên
 * mã tự nó chưa đủ để nói «chắc chắn chưa có hoá đơn». Đo thật 03/11/2026 (demo, tài khoản chưa có HSM): mã 13,
 * rồi tra cứu cùng khoá ⇒ 11 — VIN không để lại gì. Vì vậy cổng (`http.ts`) KHÔNG tin mã mà TỰ TRA CỨU ngay:
 * ra 11 ⇒ TU_CHOI `VIN_13`/`VIN_27` (lỗi cấu hình, người dùng biết phải làm gì); thấy hoá đơn ⇒ trả hoá đơn
 * đó; tra cứu không chắc ⇒ KHONG_RO như cũ. Bằng chứng theo TỪNG lần gọi, không theo một lần đo.
 */
const MA_LOI_CHUNG_THU = new Set(["13", "27"]);
/**
 * Từ chối CHẮC CHẮN: lỗi dữ liệu/cấu hình mà VIN phát hiện TRƯỚC khi lưu hoá đơn (kiểm đầu vào, mẫu, gói, quyền).
 * ⚠️ Cố ý KHÔNG gồm 13/27 (xem `MA_LOI_CHUNG_THU`) và 22/23/51/16/17 (lỗi ký/cấp số): chúng có thể xảy ra SAU khi
 * VIN đã lưu bản nháp ⇒ KHONG_RO để nơi gọi tra cứu theo khoá cũ [?].
 */
const MA_TU_CHOI_CHAC_CHAN = new Set(["02", "04", "08", "12", "14", "18", "20", "21", "28", "42", "43", "44", "50"]);

/** Mã báo hoá đơn/mã giao dịch đã tồn tại (03/26). */
export const laMaTrungVin = (ma: string): boolean => MA_TRUNG.has(ma);
/** Mã VIN từ chối chắc chắn TRƯỚC khi lưu gì (xem `MA_TU_CHOI_CHAC_CHAN`). */
export const laMaTuChoiChacChanVin = (ma: string): boolean => MA_TU_CHOI_CHAC_CHAN.has(ma);

export type KetQuaDocPhatHanhVin =
  | KetQuaPhatHanh
  | { loai: "TRUNG"; thongDiep: string }
  /** Lỗi chứng thư số (13/27): nơi gọi tra cứu để biết hoá đơn có tồn tại không trước khi kết luận từ chối. */
  | { loai: "CHUNG_THU"; ma: string; thongDiep: string };

function ngayTuVin(v: unknown): Date | null {
  const s = chuoi(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function kyHieuDayDu(mauSo: string, kyHieu: string, mauDuPhong: string): string {
  const k = kyHieu.trim().toUpperCase();
  if (!k) return mauDuPhong.trim().toUpperCase();
  return `${mauSo.trim()}${k}`;
}

function daPhatHanhTuDoiTuong(o: Rec, refId: string, kyHieuDuPhong: string, ngayDuPhong: Date | null): DaPhatHanh | null {
  const soHoaDon = chuoi(o["sohoadon"]);
  const maTraCuu = chuoi(o["magiaodich"]);
  if (!soHoaDon || !maTraCuu) return null;
  const ngay = ngayTuVin(o["ngayky"]) ?? ngayDuPhong;
  if (!ngay) return null;
  const kyHieu = kyHieuDayDu(chuoi(o["mauso"]), chuoi(o["kyhieu"]), kyHieuDuPhong);
  if (!kyHieu) return null;
  return {
    loai: "DA_PHAT_HANH",
    refId,
    kyHieu,
    soHoaDon,
    ngayPhatHanh: ngay,
    maTraCuu,
  };
}

/** `trangthai` 3 = đã ký. Khuyết ⇒ không phủ định. */
function chuaKy(o: Rec): boolean {
  const t = chuoi(o["trangthai"]);
  return t !== "" && t !== "3";
}

export function docPhanHoiPhatHanh(body: unknown, phieu: Pick<PhieuPhatHanh, "refId" | "kyHieu" | "ngayHoaDon">): KetQuaDocPhatHanhVin {
  const o = docDoiTuong(body);
  if (!o) return { loai: "KHONG_RO", thongDiep: "VIN trả phản hồi không đọc được — chưa rõ đã phát hành hay chưa, cần tra cứu." };
  const ma = chuanHoaMa(o["maketqua"]);
  const moTa = `${moTaMa(ma)}`;

  if (MA_THANH_CONG_PHAT_HANH.has(ma)) {
    if (chuaKy(o)) {
      return { loai: "KHONG_RO", thongDiep: "VIN báo thành công nhưng hoá đơn chưa ở trạng thái đã ký — cần tra cứu." };
    }
    const kq = daPhatHanhTuDoiTuong(o, phieu.refId, phieu.kyHieu, phieu.ngayHoaDon);
    if (kq) return kq;
    return { loai: "KHONG_RO", thongDiep: "VIN báo thành công nhưng phản hồi thiếu số hoá đơn hoặc mã giao dịch — cần tra cứu." };
  }
  if (MA_TRUNG.has(ma)) return { loai: "TRUNG", thongDiep: `VIN báo ${moTa}.` };
  if (MA_LOI_CHUNG_THU.has(ma)) {
    const viSao = ma === "27" ? "chứng thư số của tài khoản VIN đã hết hạn" : "tài khoản VIN chưa có chứng thư số (HSM) để ký";
    return { loai: "CHUNG_THU", ma: `VIN_${ma}`, thongDiep: `VIN từ chối: ${moTa} — ${viSao}. Nhờ VIN-HOADON cấp/gia hạn chứng thư rồi phát hành lại.` };
  }
  if (MA_TU_CHOI_CHAC_CHAN.has(ma)) return { loai: "TU_CHOI", ma: `VIN_${ma}`, thongDiep: `VIN từ chối: ${moTa}.` };
  return { loai: "KHONG_RO", thongDiep: `VIN trả ${moTa} — chưa rõ đã phát hành hay chưa, cần tra cứu.` };
}

export function docPhanHoiTraCuu(body: unknown, refId: string): KetQuaTraCuu {
  const o = docDoiTuong(body);
  if (!o) return { loai: "KHONG_RO", thongDiep: "VIN trả phản hồi tra cứu không đọc được." };
  const ma = chuanHoaMa(o["maketqua"]);
  if (ma === "11") return { loai: "CHUA_CO" };
  if (ma !== "01") return { loai: "KHONG_RO", thongDiep: `Tra cứu VIN trả ${moTaMa(ma)}.` };
  // Đối chiếu khoá: tra theo ma_hoadon mà VIN trả hoá đơn mang khoá khác ⇒ không tin.
  const maHoaDon = chuoi(o["mahoadon"]);
  if (maHoaDon && maHoaDon !== refId.trim()) {
    return { loai: "KHONG_RO", thongDiep: "Tra cứu VIN trả hoá đơn mang khoá khác khoá đã hỏi." };
  }
  if (chuaKy(o)) return { loai: "KHONG_RO", thongDiep: "VIN có hoá đơn mang khoá này nhưng CHƯA ký — cần xử lý tay, không được phát hành lại." };
  const kq = daPhatHanhTuDoiTuong(o, refId.trim(), "", ngayTuVin(o["ngaylap"]));
  if (kq) return kq;
  return { loai: "KHONG_RO", thongDiep: "Tra cứu VIN thiếu số hoá đơn, mã giao dịch hoặc ngày ký." };
}

/** Một lỗi mà nơi gọi có thể in: KHÔNG chứa token/mật khẩu. */
export type KetQuaDocTep = { ok: true; base64: string } | { ok: false; thongDiep: string };

export function docPhanHoiTep(body: unknown, loai: LoaiTep): KetQuaDocTep {
  const o = docDoiTuong(body);
  if (!o) return { ok: false, thongDiep: "VIN trả phản hồi tải tệp không đọc được." };
  const ma = chuanHoaMa(o["maketqua"]);
  if (ma !== "01") return { ok: false, thongDiep: `VIN từ chối tải tệp: ${moTaMa(ma)}.` };
  const v = o[loai === "pdf" ? "base64pdf" : "base64xml"];
  if (typeof v !== "string" || !v.trim()) return { ok: false, thongDiep: "VIN trả tệp rỗng." };
  return { ok: true, base64: v };
}

/**
 * PDF phải bắt đầu "%PDF"; XML phải bắt đầu "<" sau giải mã base64. Sai ⇒ ném — không lưu một tệp hỏng làm
 * bản chính thức. [?] XML có thể về dạng chuỗi thô thay vì base64 ⇒ nhận cả hai.
 */
export function giaiMaTepVin(data: string, loai: LoaiTep): Uint8Array {
  const tho = data.trimStart();
  if (loai === "xml" && tho.startsWith("<")) return new Uint8Array(Buffer.from(tho, "utf8"));
  const bytes = /^[A-Za-z0-9+/=\s]+$/.test(tho) ? Buffer.from(tho, "base64") : Buffer.alloc(0);
  if (loai === "pdf") {
    if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("Tệp PDF VIN trả về không hợp lệ.");
    return new Uint8Array(bytes);
  }
  const s = bytes.toString("utf8").trimStart();
  if (!s.startsWith("<")) throw new Error("Tệp XML VIN trả về không hợp lệ.");
  return new Uint8Array(bytes);
}
