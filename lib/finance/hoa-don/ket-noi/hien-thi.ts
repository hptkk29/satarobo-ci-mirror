// lib/finance/hoa-don/ket-noi/hien-thi.ts — chữ và mức cảnh báo của màn «Kết nối & ký». THUẦN (không đọc đồng hồ: `homNay` truyền vào — luật 19).

import type { KetQuaGiaiKetNoi } from "./luat";

export type MucCanhBao = "danger" | "warning" | "success" | "muted" | "info";

/** Số ngày trước hạn bắt đầu cảnh báo chứng thư sắp hết hạn. */
export const NGAY_BAO_CHUNG_THU = 30;

const MS_NGAY = 24 * 60 * 60 * 1000;

/** Còn bao nhiêu ngày tới hạn (âm = đã hết). Cả hai là `YYYY-MM-DD` (lịch VN). */
export function soNgayConLai(hetHan: string, homNay: string): number {
  return Math.round((Date.parse(`${hetHan}T00:00:00Z`) - Date.parse(`${homNay}T00:00:00Z`)) / MS_NGAY);
}

export type CanhBaoChungThu = { muc: "danger" | "warning" | "success"; cau: string } | null;

/** `null` = chưa khai hạn (chưa biết gì thì không bịa). Hạn là NGÀY CUỐI còn hiệu lực. */
export function canhBaoChungThu(hetHan: string | null, homNay: string): CanhBaoChungThu {
  if (!hetHan) return null;
  const n = soNgayConLai(hetHan, homNay);
  if (n < 0) return { muc: "danger", cau: `Chứng thư số đã hết hạn ${-n} ngày — không ký được cho tới khi gia hạn.` };
  // Hạn là NGÀY CUỐI còn hiệu lực: hôm nay vẫn ký được — cảnh báo mạnh, không chặn.
  if (n === 0) return { muc: "warning", cau: "Chứng thư số hết hạn HÔM NAY — ký trong ngày và gia hạn ngay." };
  if (n <= NGAY_BAO_CHUNG_THU) return { muc: "warning", cau: `Chứng thư số còn ${n} ngày — gia hạn sớm để không gián đoạn ký.` };
  return { muc: "success", cau: `Chứng thư số còn ${n} ngày.` };
}

const NHAN_KIEM_TRA: Record<string, { cau: string; muc: MucCanhBao }> = {
  OK: { cau: "Đăng nhập được VIN-HOADON", muc: "success" },
  DANG_NHAP_SAI: { cau: "VIN từ chối: sai MST, tên đăng nhập hoặc mật khẩu", muc: "danger" },
  LOI_MAY_CHU: { cau: "Máy chủ VIN báo lỗi — thử lại sau", muc: "warning" },
  MANG: { cau: "Không nối được tới máy chủ VIN (kiểm địa chỉ hoặc mạng)", muc: "danger" },
  PHAN_HOI_LA: { cau: "Máy chủ VIN trả phản hồi lạ — kiểm địa chỉ máy chủ", muc: "danger" },
};

/** Mã kiểm tra (cố định) → câu. Mã lạ ⇒ không bịa, nói «chưa rõ». `null` = chưa từng kiểm. */
export function nhanKetQuaKiemTra(ma: string | null): { cau: string; muc: MucCanhBao } {
  if (ma === null) return { cau: "Chưa kiểm tra", muc: "muted" };
  return NHAN_KIEM_TRA[ma] ?? { cau: "Kết quả kiểm tra không rõ", muc: "muted" };
}

/** Một dòng tóm tắt «đang dùng gì» cho từng pháp nhân — cùng `giaiKetNoi` mà phát hành dùng. */
export function tomTatTrangThai(k: KetQuaGiaiKetNoi): { nhan: string; muc: MucCanhBao; chiTiet: string } {
  if (k.nguon === "KHONG") return { nhan: "Chưa dùng được", muc: "danger", chiTiet: k.lyDo };
  const cach = k.phuongThucKy === "USB" ? "ký bằng USB token" : "ký HSM của nhà cung cấp";
  if (k.nguon === "ENV") return { nhan: "Đang dùng cấu hình trên máy chủ", muc: "info", chiTiet: `Chưa khai ở màn này — đang dùng biến môi trường (${cach}).` };
  return { nhan: "Đang dùng kết nối đã khai", muc: "success", chiTiet: k.phuongThucKy === "USB" ? `${cach}; ${k.cheDoKy === "TUNG_LENH" ? "từng hoá đơn" : "ký cả lô"}.` : `${cach}.` };
}

export const NHAN_PHUONG_THUC_KY: Readonly<Record<string, string>> = Object.freeze({
  HSM_NHA_CUNG_CAP: "HSM của nhà cung cấp (nhà cung cấp tự ký)",
  USB_TOKEN: "USB token (kế toán ký trên máy Windows)",
});

export const NHAN_CHE_DO_KY: Readonly<Record<string, string>> = Object.freeze({
  TUNG_LENH: "Ký từng hoá đơn",
  LO: "Ký cả lô (một lần bấm, một lần nhập PIN)",
});
