// lib/finance/hoa-don/xem-truoc-kieu.ts — KIỂU + vị từ thuần của «Xem trước» hoá đơn (24/11/2026). Tách khỏi `xem-truoc-hoa-don.ts` (có `server-only`) vì hộp xem trước là component client cần chúng.
import type { QuyetNguoiMua } from "./nguoi-mua-theo-con";

export type PhuongAnXemTruoc = {
  chon: QuyetNguoiMua;
  nguoiMua: { hoTen: string; donVi: string | null; mst: string | null; diaChi: string | null; cccd: string | null; email: string | null; maKhachHang: string | null };
  dong: { stt: number; ten: string; soLuong: number; donGia: number; thanhTien: number; thueSuat: number | string }[];
  hinhThucThanhToan: string;
  tongThanhToan: number;
  /** Dấu của tờ này — gửi kèm lúc bấm «Phát hành» (`phieuDaThay`). */
  dau: string;
};

/** Phương án không dùng được (cổng từ chối) — kèm câu nói bằng lời. */
export type PhuongAnKhongDuoc = { chon: QuyetNguoiMua; khongDuoc: string };

export type KetQuaXemTruoc = {
  kyHieu: string;
  mstNguoiBan: string;
  /** yyyy-mm-dd — ngày in trên hoá đơn. */
  ngayHoaDon: string;
  /** Bên luật TỰ ĐỘNG sẽ chọn nếu kế toán không đổi (chọn sẵn trên màn). */
  macDinh: QuyetNguoiMua;
  phuHuynh: PhuongAnXemTruoc | PhuongAnKhongDuoc;
  con: PhuongAnXemTruoc | PhuongAnKhongDuoc;
};

export const laPhuongAnDuoc = (p: PhuongAnXemTruoc | PhuongAnKhongDuoc): p is PhuongAnXemTruoc => !("khongDuoc" in p);
