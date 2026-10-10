// lib/misa/meinvoice/cong.ts — HỢP ĐỒNG giữa module Hoá đơn điện tử và cổng phát hành MISA
// meInvoice (bước 1 "bán tự động", chốt 30/09/2026: kế toán BẤM "Phát hành qua MISA").
//
// Tệp này CHỈ khai kiểu. Hai phía viết độc lập theo nó:
//   · `lib/misa/meinvoice/*`        — dịch `PhieuPhatHanh` ⇄ JSON của MISA, gọi HTTP, token.
//   · `lib/finance/hoa-don/*`       — dựng `PhieuPhatHanh` từ lần thu, máy trạng thái, lưu sổ.
// Đổi một kiểu ở đây là đổi hợp đồng: sửa cả hai phía trong cùng PR.
//
// ⚠️ BA KẾT QUẢ, KHÔNG PHẢI HAI. Hoá đơn đã phát hành là chứng từ thuế — không xoá được. Lỗi
// mạng/timeout/5xx KHÔNG có nghĩa "chưa phát hành": MISA có thể đã nhận. Vì vậy mọi lỗi không
// chắc chắn phải ra `KHONG_RO`, và nơi gọi PHẢI `traCuu(refId)` trước khi thử lại — KHÔNG BAO GIỜ
// sinh `refId` mới cho cùng một lần thu đang dở. `refId` là khoá chống trùng của MISA
// (`InvoiceDuplicated`).
//
// ⚠️ Chỉ hỗ trợ ký HSM (ký từ xa, không người). Chữ ký USB token cần dịch vụ ký cài trên máy kế
// toán (localhost:12019–12023) — ngoài phạm vi bước 1.

/** Thuế suất in trên hoá đơn. `KCT` = không chịu thuế, `KKKNT` = không kê khai nộp thuế. */
export type ThueSuatHoaDon = 0 | 5 | 8 | 10 | "KCT" | "KKKNT";

export type DongPhatHanh = {
  /** 1-based, liên tục. */
  stt: number;
  ten: string;
  donViTinh: string;
  soLuong: number;
  /** Đơn giá TRƯỚC thuế, giữ phần lẻ (MISA in "1.851.851,85"). */
  donGia: number;
  /** Thành tiền TRƯỚC thuế — số nguyên đồng. */
  thanhTien: number;
  thueSuat: ThueSuatHoaDon;
  /** Tiền thuế — số nguyên đồng. 0 với KCT/KKKNT. */
  tienThue: number;
};

export type PhieuPhatHanh = {
  /**
   * Khoá chống trùng gửi sang MISA (`RefID`). UUID do HỆ THỐNG sinh MỘT LẦN khi tạo bản ghi
   * hoá đơn `DANG_PHAT_HANH`, lưu trên chính bản ghi; thử lại dùng lại đúng giá trị này.
   */
  refId: string;
  /** Ký hiệu hoá đơn của pháp nhân, vd "1C26TSR". */
  kyHieu: string;
  /** MST của PHÁP NHÂN phát hành (header `CompanyTaxCode`). */
  mstNguoiBan: string;
  /** Ngày trên hoá đơn (giờ VN, chỉ phần ngày có nghĩa). */
  ngayHoaDon: Date;
  nguoiMua: {
    /** Họ tên người mua (cá nhân) — `BuyerFullName`. */
    hoTen: string | null;
    /** Tên đơn vị — `BuyerLegalName`. Cá nhân thì null. */
    donVi: string | null;
    mst: string | null;
    diaChi: string | null;
    /** Chỉ để MISA lưu; hệ thống TỰ gửi email, không nhờ MISA gửi (`IsSendEmail = false`). */
    email: string | null;
  };
  /** "Tiền mặt" · "Chuyển khoản" · "TM/CK". */
  hinhThucThanhToan: string;
  dong: DongPhatHanh[];
  tongTruocThue: number;
  tongThue: number;
  tongThanhToan: number;
  soTienBangChu: string;
};

export type DaPhatHanh = {
  loai: "DA_PHAT_HANH";
  refId: string;
  kyHieu: string;
  soHoaDon: string;
  /** Ngày phát hành MISA trả về. */
  ngayPhatHanh: Date;
  /** `TransactionID` — mã tra cứu in trên hoá đơn, cũng là khoá tải tệp. */
  maTraCuu: string;
};

export type KetQuaPhatHanh =
  | DaPhatHanh
  /** MISA từ chối CHẮC CHẮN (lỗi dữ liệu: MST sai, ký hiệu sai…) ⇒ CHƯA có hoá đơn nào. */
  | { loai: "TU_CHOI"; ma: string; thongDiep: string }
  /** Không biết đã phát hành chưa (timeout, 5xx, phản hồi không đọc được) ⇒ phải `traCuu`. */
  | { loai: "KHONG_RO"; thongDiep: string };

export type KetQuaTraCuu = DaPhatHanh | { loai: "CHUA_CO" } | { loai: "KHONG_RO"; thongDiep: string };

export type LoaiTep = "pdf" | "xml";

export interface CongHoaDon {
  /** "HSM" thật, "GIA_LAP" = không gọi mạng (bản mô phỏng, KHÔNG có giá trị pháp lý). */
  readonly cheDo: "HSM" | "GIA_LAP";
  /** "sandbox" (testapi.meinvoice.vn) · "production" · "gia-lap". Để màn in rõ đang nói với đâu. */
  readonly moiTruong: "sandbox" | "production" | "gia-lap";
  phatHanh(phieu: PhieuPhatHanh): Promise<KetQuaPhatHanh>;
  traCuu(refId: string, mstNguoiBan: string): Promise<KetQuaTraCuu>;
  taiTep(maTraCuu: string, loai: LoaiTep, mstNguoiBan: string): Promise<Uint8Array>;
}
