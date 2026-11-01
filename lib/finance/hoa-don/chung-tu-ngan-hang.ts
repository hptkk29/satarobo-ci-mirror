// lib/finance/hoa-don/chung-tu-ngan-hang.ts — LUẬT THUẦN của «chứng từ ngân hàng cần kế toán bổ sung» (P7-E, 06/11/2026).
//
// Vì sao có: màn Hoá đơn điện tử đã theo dõi HOÁ ĐƠN thiếu, nhưng KHÔNG có chỗ nào theo dõi sao kê / ủy nhiệm chi của một khoản thu:
// `Payment.evidenceUrl` chỉ nhập được lúc ghi nhận khoản, khoản nguồn nhập lịch sử bị hàng chờ hoá đơn LOẠI (`nguonGiaoDich` LICH_SU).
// Kế toán ĐÁNH DẤU thủ công khoản cần chứng từ (không suy tự động: tiền mặt và cả trăm khoản lịch sử sẽ thành báo động giả), tải tệp SAU
// khi khoản đã tạo, rồi kiểm tra. Tệp này giữ MỌI quyết định "được làm gì ở trạng thái nào" — action và màn hình chỉ hỏi nó (luật 12:
// nút chỉ hiện khi action thật sự cho phép).
//
// ⚠️ Chứng từ KHÔNG BAO GIỜ đổi `Payment.accountantStatus`: tải lên / kiểm tra chứng từ không xác nhận khoản thu. Xác nhận khoản vẫn là
// việc riêng của kế toán qua đường xác nhận khoản có sẵn.
// THUẦN: không Prisma, không đồng hồ, không fs, không env.

import { laKhoaChungTuNganHang, TIEN_TO_CHUNG_TU_NGAN_HANG } from "./tep-mo-coi";

export const TRANG_THAI_CHUNG_TU = ["CHO_BO_SUNG", "DA_TAI_LEN", "DA_KIEM_TRA", "CAN_BO_SUNG_LAI"] as const;
export type TrangThaiChungTu = (typeof TRANG_THAI_CHUNG_TU)[number];

export const NHAN_TRANG_THAI_CHUNG_TU: Record<TrangThaiChungTu, string> = {
  CHO_BO_SUNG: "Chờ bổ sung",
  DA_TAI_LEN: "Đã tải lên",
  DA_KIEM_TRA: "Đã kiểm tra",
  CAN_BO_SUNG_LAI: "Cần bổ sung lại",
};

/** Loại chứng từ thiếu — hôm nay chỉ một loại; cột để màn nói rõ "thiếu cái gì" và để mở rộng sau. */
export const NHAN_LOAI_CHUNG_TU_THIEU = "Sao kê / ủy nhiệm chi ngân hàng";

/** Độ dài tối thiểu của lý do (đánh dấu, yêu cầu bổ sung lại, huỷ đánh dấu) — cùng ngưỡng với các lý do của màn hoá đơn. */
export const TOI_THIEU_LY_DO_CHUNG_TU = 10;
export const TOI_DA_LY_DO_CHUNG_TU = 300;
export const TOI_DA_GHI_CHU_CHUNG_TU = 500;

export type HanhDongChungTu = "TAI_LEN" | "KIEM_TRA" | "YEU_CAU_BO_SUNG_LAI" | "HUY_DANH_DAU";

export type KetQuaChuyen = { ok: true; den: TrangThaiChungTu | "HUY" } | { ok: false; lyDo: string };

/**
 * Máy trạng thái DUY NHẤT:
 *   CHO_BO_SUNG ──TAI_LEN──► DA_TAI_LEN ──KIEM_TRA──► DA_KIEM_TRA
 *   DA_TAI_LEN ──TAI_LEN──► DA_TAI_LEN (thay tệp)        DA_TAI_LEN | DA_KIEM_TRA ──YEU_CAU_BO_SUNG_LAI──► CAN_BO_SUNG_LAI
 *   CAN_BO_SUNG_LAI ──TAI_LEN──► DA_TAI_LEN              CHO_BO_SUNG ──HUY_DANH_DAU──► (xoá hồ sơ)
 * Đã kiểm tra thì KHÔNG thay tệp trực tiếp (phải yêu cầu bổ sung lại trước, để có dấu vết ai bác tệp nào, vì sao).
 * Huỷ đánh dấu chỉ khi chưa từng có tệp (CHO_BO_SUNG) — sau đó hồ sơ mang tệp, bỏ đi là mất dấu vết kiểm tra.
 */
export function chuyenTrangThai(tu: TrangThaiChungTu, hd: HanhDongChungTu): KetQuaChuyen {
  switch (hd) {
    case "TAI_LEN":
      if (tu === "DA_KIEM_TRA") return { ok: false, lyDo: "Chứng từ đã được kiểm tra — yêu cầu bổ sung lại trước khi thay tệp" };
      return { ok: true, den: "DA_TAI_LEN" };
    case "KIEM_TRA":
      if (tu !== "DA_TAI_LEN") return { ok: false, lyDo: tu === "DA_KIEM_TRA" ? "Chứng từ đã được kiểm tra" : "Chưa có tệp chứng từ để kiểm tra" };
      return { ok: true, den: "DA_KIEM_TRA" };
    case "YEU_CAU_BO_SUNG_LAI":
      if (tu !== "DA_TAI_LEN" && tu !== "DA_KIEM_TRA") return { ok: false, lyDo: "Chưa có tệp chứng từ để yêu cầu bổ sung lại" };
      return { ok: true, den: "CAN_BO_SUNG_LAI" };
    case "HUY_DANH_DAU":
      if (tu !== "CHO_BO_SUNG") return { ok: false, lyDo: "Hồ sơ đã có tệp — không huỷ đánh dấu được, hãy yêu cầu bổ sung lại" };
      return { ok: true, den: "HUY" };
  }
}

export type NutChungTu = Record<"taiLen" | "taiVe" | "kiemTra" | "yeuCauBoSungLai" | "huyDanhDau", boolean>;

/** Nút nào được vẽ ở một dòng — đọc từ CHÍNH `chuyenTrangThai` nên nút và action không thể lệch nhau (luật 12). */
export function nutDuocPhep(trangThai: TrangThaiChungTu, coTep: boolean): NutChungTu {
  const ok = (hd: HanhDongChungTu) => chuyenTrangThai(trangThai, hd).ok;
  return {
    taiLen: ok("TAI_LEN"),
    taiVe: coTep,
    kiemTra: ok("KIEM_TRA"),
    yeuCauBoSungLai: ok("YEU_CAU_BO_SUNG_LAI"),
    huyDanhDau: ok("HUY_DANH_DAU"),
  };
}

// ─── khoản nào được đánh dấu ───────────────────────────────────────────────────────────────────────────────

export type KhoanDeDanhDau = {
  deletedAt: Date | null;
  paymentType: string;
  accountantStatus: string;
  amount: number;
  centerId: string | null;
};

/**
 * Lý do KHÔNG đánh dấu được; `null` = được. Cố ý KHÔNG hỏi nguồn khoản (backfill / nhập lịch sử / `[sheet:…]`) và KHÔNG hỏi
 * trạng thái PENDING: khoản nguồn lịch sử đang chờ kế toán chính là ca đầu tiên cần màn này (yêu cầu P7-E).
 */
export function lyDoKhongDanhDau(k: KhoanDeDanhDau): string | null {
  if (k.deletedAt !== null) return "Khoản thu đã bị xoá";
  if (k.paymentType !== "PAYMENT") return "Chỉ khoản thu (không phải hoàn tiền / điều chỉnh) mới cần chứng từ ngân hàng";
  if (k.accountantStatus === "REJECTED") return "Khoản thu đã bị kế toán từ chối";
  if (!(k.amount > 0)) return "Khoản thu không có số tiền";
  if (!k.centerId) return "Khoản thu chưa gán cơ sở — báo quản trị hệ thống";
  return null;
}

// ─── tệp chứng từ ──────────────────────────────────────────────────────────────────────────────────────────

export type LoaiTepChungTu = "pdf" | "png" | "jpg";
export const LOAI_TEP_CHUNG_TU: readonly LoaiTepChungTu[] = ["pdf", "png", "jpg"];

/** Trần cỡ tệp (byte): sao kê PDF vài trăm KB; ảnh chụp màn hình app ngân hàng vài MB. */
export const TRAN_CO_TEP_CHUNG_TU = 10 * 1024 * 1024;

/** Mime ký vào URL PUT — trình duyệt PHẢI gửi đúng header này. */
export const MIME_TEP_CHUNG_TU: Record<LoaiTepChungTu, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
};

export const laLoaiTepChungTu = (v: unknown): v is LoaiTepChungTu => typeof v === "string" && (LOAI_TEP_CHUNG_TU as readonly string[]).includes(v);

/** Loại tệp suy từ đuôi tên (không phân biệt hoa thường; `jpeg` = `jpg`); không nhận ra ⇒ `null`. */
export function loaiTepTuTen(ten: string): LoaiTepChungTu | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(ten.trim());
  const duoi = m?.[1]?.toLowerCase();
  if (duoi === "pdf") return "pdf";
  if (duoi === "png") return "png";
  if (duoi === "jpg" || duoi === "jpeg") return "jpg";
  return null;
}

/** Vân tay BYTE (tin byte, không tin đuôi hay mime trình duyệt khai): PDF `%PDF-` · PNG 8 byte chuẩn · JPEG `FF D8 FF`. */
export function vanTayChungTu(loai: LoaiTepChungTu, dau: Uint8Array): boolean {
  const khop = (mau: readonly number[]) => mau.every((b, i) => dau[i] === b);
  switch (loai) {
    case "pdf":
      return khop([0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "png":
      return khop([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
      return khop([0xff, 0xd8, 0xff]);
  }
}

const AN_TOAN = /^[A-Za-z0-9_-]+$/;

/** `chung-tu-ngan-hang/<mã cơ sở>/<năm>/<paymentId>/<uuid>.<pdf|png|jpg>` — NÉM nếu thành phần nào không an toàn. */
export function khoaChungTu(input: { centerCode: string; paymentId: string; loai: LoaiTepChungTu; nam: number; uuid: string }): string {
  const { centerCode, paymentId, loai, nam, uuid } = input;
  for (const [ten, v] of [
    ["mã cơ sở", centerCode],
    ["mã khoản thu", paymentId],
    ["uuid", uuid],
  ] as const) {
    if (!AN_TOAN.test(v)) throw new Error(`Khoá chứng từ: ${ten} không hợp lệ`);
  }
  if (!Number.isInteger(nam) || nam < 2000 || nam > 2999) throw new Error("Khoá chứng từ: năm không hợp lệ");
  if (!laLoaiTepChungTu(loai)) throw new Error("Khoá chứng từ: loại tệp không hợp lệ");
  const khoa = `${TIEN_TO_CHUNG_TU_NGAN_HANG}${centerCode}/${nam}/${paymentId}/${uuid}.${loai}`;
  if (!laKhoaChungTuNganHang(khoa)) throw new Error("Khoá chứng từ: sai hình dạng");
  return khoa;
}

/**
 * Khoá này có đúng là tệp của KHOẢN THU này ở CƠ SỞ này không. Khoá đến từ trình duyệt: không hỏi thì kế toán cơ sở A gắn được tệp
 * nằm dưới khoản của cơ sở B (hoặc của một khoản khác) vào hồ sơ của mình.
 */
export function khoaThuocKhoan(khoa: string, centerCode: string, paymentId: string): boolean {
  if (khoa.includes("..")) return false;
  if (!AN_TOAN.test(centerCode) || !AN_TOAN.test(paymentId)) return false;
  return new RegExp(`^${TIEN_TO_CHUNG_TU_NGAN_HANG}${centerCode}/\\d{4}/${paymentId}/[A-Za-z0-9_-]+\\.(pdf|png|jpg)$`).test(khoa);
}

/** Tên hiển thị của tệp: bỏ đường dẫn, ký tự điều khiển; cắt 120 ký tự; đảm bảo đuôi khớp loại. */
export function tenTepChungTuSach(ten: string, loai: LoaiTepChungTu): string {
  // eslint-disable-next-line no-control-regex
  const goc = (ten.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const sach = goc.slice(0, 120);
  return sach.length > 0 && loaiTepTuTen(sach) === loai ? sach : `chung-tu-ngan-hang.${loai}`;
}

/** Tên tệp khi TẢI VỀ — không mang PII (không tên học viên / mã đơn): chỉ phần cuối id khoản. */
export function tenTaiVeChungTu(paymentId: string, loai: LoaiTepChungTu): string {
  return `chung-tu-ngan-hang-${paymentId.slice(-8)}.${loai}`;
}

/** Ghi chú / lý do: cắt khoảng trắng; rỗng ⇒ `null`. */
export function lamSachGhiChu(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length === 0 ? null : t;
}
