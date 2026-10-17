// lib/finance/hoa-don/phieu-phat-hanh.ts — dựng `PhieuPhatHanh` (hợp đồng cổng MISA meInvoice,
// `lib/misa/meinvoice/cong.ts`) cho MỘT lần thu. THUẦN: không Prisma, không mạng, không đồng hồ.
//
// Bước 1 "bán tự động" (chủ dự án duyệt 30/09/2026): kế toán bấm "Phát hành qua MISA" thay vì tự gõ lại
// tờ hoá đơn ở MISA. Tờ đó TRƯỚC NAY được gõ theo PHIẾU THU CHỜ (`payments/hoa-don/phieu-cho`) ⇒ phiếu
// phát hành dựng từ CHÍNH các trang phiếu chờ (`dungPhieuThuData` — cùng `tinhDongHoaDon`, `thueChoLoaiDon`,
// tên dòng "Khoá học … — HV …", đơn vị tính). KHÔNG có phép tính thứ hai: hai công thức cho cùng một tờ là
// đúng lớp lỗi của sự cố nội dung CK trên QR (24/09).
//
// ⚠️ `tongThanhToan` PHẢI BẰNG `tongTien` RÒNG của hoá đơn (Σ số ròng các khoản — thứ bản ghi hoá đơn lưu
// và thứ phụ huynh đã trả). Lệch ⇒ NÉM, không phát hành: một tờ hoá đơn điện tử đã ký KHÔNG sửa được, chỉ
// huỷ/điều chỉnh. Ca lệch đã biết: thuế khai "CHƯA GỒM THUẾ" cho loại đơn (tờ cộng thêm thuế ⇒ tổng lớn
// hơn số đã thu) — với ca đó kế toán làm tay ở MISA rồi tải lên.

import type { DongPhatHanh, PhieuPhatHanh, ThueSuatHoaDon } from "@/lib/misa/meinvoice/cong";
import type { NguoiMuaHoaDon } from "./nguoi-mua";
import { laPhapNhanMisa, type PhapNhan } from "./phap-nhan";
import { kyHieuTheoNam } from "./ky-hieu";
import { soTienBangChu } from "./so-tien-bang-chu";
import { tongHoaDon, type DongHoaDon } from "./tinh-hoa-don";

export type MaLoiDungPhieu = "PHAP_NHAN_KHONG_MISA" | "THIEU_KY_HIEU" | "THUE_SUAT_LA" | "RONG" | "LECH_TONG";

const CAU: Record<MaLoiDungPhieu, string> = {
  PHAP_NHAN_KHONG_MISA: "Pháp nhân phát hành của cơ sở này không dùng MISA meInvoice — làm hoá đơn ở phần mềm của pháp nhân rồi tải lên",
  THIEU_KY_HIEU: "Pháp nhân chưa khai ký hiệu hoá đơn trong Cấu hình hoá đơn",
  THUE_SUAT_LA: "Thuế suất khai cho loại đơn này không phải mức MISA nhận (0 · 5 · 8 · 10%) — làm tay ở MISA rồi tải lên",
  RONG: "Lần thu không có dòng nào để phát hành",
  LECH_TONG:
    "Tổng trên hoá đơn không bằng số tiền đã thu (thuế khai 'chưa gồm thuế' cho loại đơn này?) — không phát hành; làm tay ở MISA rồi tải lên",
};

export class LoiDungPhieu extends Error {
  constructor(readonly ma: MaLoiDungPhieu) {
    super(CAU[ma]);
    this.name = "LoiDungPhieu";
  }
}

/** Mức thuế in được trên hoá đơn MISA. Mức lạ ⇒ NÉM (không làm tròn sang mức gần nhất — sai tờ khai thuế). */
export function thueSuatMisa(thueSuat: number): ThueSuatHoaDon {
  if (thueSuat === 0 || thueSuat === 5 || thueSuat === 8 || thueSuat === 10) return thueSuat;
  throw new LoiDungPhieu("THUE_SUAT_LA");
}

/**
 * Hình thức thanh toán in trên tờ MISA — ba giá trị hợp đồng cổng nhận. Theo MÃ phương thức của từng khoản
 * (`Payment.method`) + nhãn đã tra: tiền mặt là mã `CASH*` hoặc nhãn có chữ "tiền mặt"; còn lại là chuyển
 * khoản (payOS / SePay / BANK_CS1 …). Trộn cả hai ⇒ "TM/CK".
 */
export function hinhThucMisa(phuongThuc: readonly { ma: string; nhan: string }[]): "Tiền mặt" | "Chuyển khoản" | "TM/CK" {
  const laTm = (p: { ma: string; nhan: string }) => /^cash/i.test(p.ma.trim()) || /tiền mặt/i.test(p.nhan);
  const tm = phuongThuc.filter(laTm).length;
  if (tm === 0) return "Chuyển khoản";
  return tm === phuongThuc.length ? "Tiền mặt" : "TM/CK";
}

/**
 * Khối người mua ĐÚNG như sẽ gửi MISA. MỘT phép dịch — nút (`nut-phat-hanh-misa.ts`) kiểm luật MISA trên chính
 * kết quả này, nên nút và tờ gửi đi không thể lệch nhau về ô nào mang giá trị gì.
 */
export function nguoiMuaPhatHanh(nm: NguoiMuaHoaDon): PhieuPhatHanh["nguoiMua"] {
  return {
    hoTen: nm.hoTen || null,
    donVi: nm.tenDonVi,
    mst: nm.maSoThue,
    diaChi: nm.diaChi,
    email: nm.email,
  };
}

export function dungPhieuPhatHanh(input: {
  /** UUID do hệ thống sinh MỘT LẦN cho bản ghi DANG_PHAT_HANH. */
  refId: string;
  phapNhan: PhapNhan;
  /** Ngày trên hoá đơn — nửa đêm UTC của ngày lịch VN. */
  ngayHoaDon: Date;
  /** Người mua ĐỌC DƯỚI KHOÁ ĐƠN (bản chụp sẽ lưu lên hoá đơn) — không lấy từ trang phiếu dựng trước khoá. */
  nguoiMua: NguoiMuaHoaDon;
  /** Các trang phiếu thu chờ của lần thu (mỗi khoản một trang) — `dungPhieuThuData`, KHÔNG dựng lại. */
  trang: readonly { dong: readonly DongHoaDon[] }[];
  phuongThuc: readonly { ma: string; nhan: string }[];
  /** Σ số RÒNG các khoản của hoá đơn (`HoaDonDienTu.tongTien`). */
  tongTien: number;
}): PhieuPhatHanh {
  if (!laPhapNhanMisa(input.phapNhan)) throw new LoiDungPhieu("PHAP_NHAN_KHONG_MISA");
  if (!input.phapNhan.kyHieu?.trim()) throw new LoiDungPhieu("THIEU_KY_HIEU");
  const dongGoc = input.trang.flatMap((t) => t.dong);
  if (dongGoc.length === 0) throw new LoiDungPhieu("RONG");

  const tong = tongHoaDon([...dongGoc]);
  if (tong.congTienThanhToan !== input.tongTien) throw new LoiDungPhieu("LECH_TONG");

  const dong: DongPhatHanh[] = dongGoc.map((d, i) => ({
    stt: i + 1,
    ten: d.ten,
    donViTinh: d.donViTinh,
    soLuong: d.soLuong,
    donGia: d.donGia,
    thanhTien: d.thanhTien,
    thueSuat: thueSuatMisa(d.thueSuat),
    tienThue: d.tienThue,
  }));
  return {
    refId: input.refId,
    kyHieu: kyHieuTheoNam(input.phapNhan.kyHieu, input.ngayHoaDon),
    mstNguoiBan: input.phapNhan.maSoThue.replace(/[\s-]/g, ""),
    ngayHoaDon: input.ngayHoaDon,
    nguoiMua: nguoiMuaPhatHanh(input.nguoiMua),
    hinhThucThanhToan: hinhThucMisa(input.phuongThuc),
    dong,
    tongTruocThue: tong.thanhTienTruocThue,
    tongThue: tong.tienThue,
    tongThanhToan: tong.congTienThanhToan,
    soTienBangChu: soTienBangChu(tong.congTienThanhToan),
  };
}

/**
 * Đọc lại phiếu ĐÃ GỬI từ cột `misaPhieu` (JSON) — gửi lại cùng refId phải gửi ĐÚNG nội dung đó, không dựng
 * lại từ đơn. Hình dạng hỏng ⇒ NÉM (không đoán): bản ghi đó phải được người nhìn.
 */
export function phieuTuJson(json: unknown): PhieuPhatHanh {
  const o = json as Partial<Record<keyof PhieuPhatHanh, unknown>> | null;
  const ngay = typeof o?.ngayHoaDon === "string" ? new Date(o.ngayHoaDon) : null;
  if (
    !o ||
    typeof o.refId !== "string" ||
    typeof o.kyHieu !== "string" ||
    typeof o.mstNguoiBan !== "string" ||
    !ngay ||
    Number.isNaN(ngay.getTime()) ||
    !Array.isArray(o.dong) ||
    o.dong.length === 0 ||
    typeof o.tongThanhToan !== "number" ||
    typeof o.nguoiMua !== "object" ||
    o.nguoiMua === null
  ) {
    throw new Error("Phiếu phát hành đã lưu bị hỏng hình dạng — không gửi lại");
  }
  return { ...(o as PhieuPhatHanh), ngayHoaDon: ngay };
}
