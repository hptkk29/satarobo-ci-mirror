// lib/finance/hoa-don/yeu-cau-nguoi-mua-bieu-mau.ts — kiểm BIỂU MẪU công khai "thông tin người mua hoá đơn" (Invoice Hub đợt 2, S11, phía phụ huynh). THUẦN: không DB, không đồng hồ,
// không `node:crypto` ⇒ an toàn để cả biểu mẫu CLIENT (phản hồi tức thì) lẫn Server Action (cổng thật) cùng import — MỘT luật, hai nơi gọi, không chép tay.
//
// Khác `kiemODon` (kiểm TỪNG ô khi nhân viên nhập thay, cho phép thiếu ô): phụ huynh gửi cả bộ nên ở đây có ô BẮT BUỘC (xem dưới); các ô tuỳ chọn có thì phải đúng định dạng.
//   · CÁ NHÂN (người mua = ba/mẹ): BẮT BUỘC họ tên ba/mẹ · CCCD ba/mẹ · địa chỉ. Tuỳ chọn: email, SĐT ba/mẹ, khối học viên (tên · ngày sinh · CCCD học viên).
//   · DOANH NGHIỆP: BẮT BUỘC tên doanh nghiệp · mã số thuế · email nhận hoá đơn · địa chỉ. Các ô của cá nhân (CCCD, SĐT, học viên) BỊ BỎ — không gửi, không lưu.
//   (Chủ dự án chốt 02/11/2026. Khối học viên tuỳ chọn vì nhiều em chưa có CCCD.)
// ⚠️ ĐỊNH DẠNG, không phải luật pháp (OD-11 còn mở). Ô lạ trong đầu vào bị BỎ — hàm chỉ đọc đúng các khoá khai dưới đây.
import { LOAI_NGUOI_MUA, O_CHI_CA_NHAN, chuanHoaO, kiemODon, type DauVaoO, type OKhoa } from "./yeu-cau-nguoi-mua";
import { docHocVienThemTho, kiemHocVienThem, type HocVienThem, type HocVienThemTho, type LoiHocVienThem } from "./hoc-vien-them";

/** Đầu vào thô của biểu mẫu — mọi thứ là chuỗi / boolean, chưa chuẩn hoá. */
export type BieuMauTho = {
  loai: string;
  ten: string;
  diaChi: string;
  email: string;
  maSoThue: string;
  cccd: string;
  sdt: string;
  tenHocVien: string;
  ngaySinhHocVien: string;
  cccdHocVien: string;
  /** Các EM CÒN LẠI của đơn nhiều con (em thứ nhất là ba ô `tenHocVien` · `ngaySinhHocVien` · `cccdHocVien` ở trên) — xem `hoc-vien-them.ts`. */
  hocVienThem: HocVienThemTho[];
  dongY: boolean;
};
export type LoiBieuMau = {
  theoO: Partial<Record<OKhoa, string>>;
  /** Lỗi theo CHỈ SỐ khối «học viên thêm» trên màn. */
  hocVienThem?: Record<number, LoiHocVienThem>;
  /** Lỗi chung của danh sách học viên thêm (quá số lượng). */
  hocVienThemChung?: string;
  dongY?: string;
};
export type KetQuaKiemBieuMau = { ok: true; du: DauVaoO; hocVienThem: HocVienThem[] } | { ok: false; loi: LoiBieuMau };

/** Trần độ dài MỘT ô thô trước khi chuẩn hoá — chặn gói tin khổng lồ; các ô thật còn có trần riêng trong `kiemODon`. */
const TRAN_DO_DAI_THO = 500;

export const THONG_DIEP_BIEU_MAU = {
  CHUA_CHON_LOAI: "Chọn cá nhân hoặc doanh nghiệp",
  THIEU_TEN_CA_NHAN: "Nhập họ và tên của ba/mẹ",
  THIEU_TEN_DOANH_NGHIEP: "Nhập tên doanh nghiệp",
  THIEU_DIA_CHI: "Nhập địa chỉ",
  THIEU_MST: "Nhập mã số thuế của doanh nghiệp",
  THIEU_CCCD: "Nhập số CCCD của ba/mẹ",
  THIEU_EMAIL_DOANH_NGHIEP: "Nhập email để nhận hoá đơn của doanh nghiệp",
  CHUA_DONG_Y: "Bạn cần đồng ý để chúng tôi xuất hoá đơn",
} as const;

const chuoi = (v: unknown): string => (typeof v === "string" ? v.slice(0, TRAN_DO_DAI_THO) : "");

/** Đọc một giá trị KHÔNG TIN CẬY (JSON từ client) thành `BieuMauTho`. Khoá không khai bị bỏ; kiểu sai ⇒ ô rỗng; `dongY` chỉ `true` thật mới tính. */
export function docBieuMauTho(raw: unknown): BieuMauTho {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    loai: chuoi(r.loai),
    ten: chuoi(r.ten),
    diaChi: chuoi(r.diaChi),
    email: chuoi(r.email),
    maSoThue: chuoi(r.maSoThue),
    cccd: chuoi(r.cccd),
    sdt: chuoi(r.sdt),
    tenHocVien: chuoi(r.tenHocVien),
    ngaySinhHocVien: chuoi(r.ngaySinhHocVien),
    cccdHocVien: chuoi(r.cccdHocVien),
    hocVienThem: docHocVienThemTho(r.hocVienThem),
    dongY: r.dongY === true,
  };
}

/**
 * Kiểm cả biểu mẫu. Đúng ⇒ `du` là các ô ĐÃ CHUẨN HOÁ để đưa thẳng cho dịch vụ (cá nhân: không có `maSoThue`; doanh nghiệp: không có ô của cá nhân; ô tuỳ chọn trống: không có khoá).
 * Sai ⇒ lỗi THEO Ô bằng tiếng Việt thường ngày + lỗi hộp đồng ý riêng.
 */
export function kiemBieuMau(raw: unknown): KetQuaKiemBieuMau {
  const f = docBieuMauTho(raw);
  const theoO: Partial<Record<OKhoa, string>> = {};
  const du: DauVaoO = {};
  const loai = f.loai;
  const laLoaiHopLe = (LOAI_NGUOI_MUA as readonly string[]).includes(loai);
  if (!laLoaiHopLe) theoO.loai = THONG_DIEP_BIEU_MAU.CHUA_CHON_LOAI;
  else du.loai = loai;

  const tho = (o: OKhoa): string => (f as unknown as Record<string, string>)[o] ?? "";
  const batBuoc = (o: OKhoa, thieu: string) => {
    if (chuanHoaO(o, tho(o)) === "") {
      theoO[o] = thieu;
      return;
    }
    const r = kiemODon(o, tho(o));
    if (r.ok) du[o] = r.giaTri;
    else theoO[o] = r.loi;
  };
  const tuyChon = (o: OKhoa) => {
    if (chuanHoaO(o, tho(o)) === "") return;
    const r = kiemODon(o, tho(o));
    if (r.ok) du[o] = r.giaTri;
    else theoO[o] = r.loi;
  };

  const laDoanhNghiep = loai === "DOANH_NGHIEP";
  batBuoc("ten", laDoanhNghiep ? THONG_DIEP_BIEU_MAU.THIEU_TEN_DOANH_NGHIEP : THONG_DIEP_BIEU_MAU.THIEU_TEN_CA_NHAN);
  batBuoc("diaChi", THONG_DIEP_BIEU_MAU.THIEU_DIA_CHI);

  if (laDoanhNghiep) {
    batBuoc("maSoThue", THONG_DIEP_BIEU_MAU.THIEU_MST);
    batBuoc("email", THONG_DIEP_BIEU_MAU.THIEU_EMAIL_DOANH_NGHIEP);
  } else if (laLoaiHopLe) {
    batBuoc("cccd", THONG_DIEP_BIEU_MAU.THIEU_CCCD);
    tuyChon("email");
    for (const o of O_CHI_CA_NHAN) if (o !== "cccd") tuyChon(o); // SĐT + khối học viên (tuỳ chọn, có thì phải đúng định dạng)
  }

  // Các em còn lại: CHỈ có nghĩa với CÁ NHÂN (doanh nghiệp: bỏ — không gửi, không lưu, như các ô cá nhân khác).
  let hocVienThem: HocVienThem[] = [];
  const loi: LoiBieuMau = { theoO };
  if (laLoaiHopLe && !laDoanhNghiep) {
    const them = kiemHocVienThem(f.hocVienThem);
    if (them.ok) hocVienThem = them.ds;
    else {
      if (Object.keys(them.theoDong).length > 0) loi.hocVienThem = them.theoDong;
      if (them.chung) loi.hocVienThemChung = them.chung;
    }
  }
  if (!f.dongY) loi.dongY = THONG_DIEP_BIEU_MAU.CHUA_DONG_Y;
  return Object.keys(theoO).length > 0 || loi.hocVienThem !== undefined || loi.hocVienThemChung !== undefined || loi.dongY !== undefined ? { ok: false, loi } : { ok: true, du, hocVienThem };
}
