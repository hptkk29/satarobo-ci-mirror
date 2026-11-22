// lib/finance/hoa-don/du-dieu-kien.ts — MỘT khoản tiền có vào màn hoá đơn không, và vào NGĂN
// nào. THUẦN: không Prisma, không DB, không đọc đồng hồ.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §2.1. Chủ dự án chốt 26/09: KHÔNG có mốc ngày — danh
// sách là mọi khoản thu THẬT chưa có hoá đơn trên hệ thống (kế toán đã xuất hết ở MISA, chỉ thiếu
// chỗ tải lên). Luật ở đây vì thế chỉ trả lời "đây có phải tiền thật của đơn không".
//
// ĐỊNH NGHĨA MỘT CHỖ: hàng chờ, khối trang đơn, cổng xác nhận và báo cáo đo GĐ 0 cùng gọi hàm này.
//
// ⚠️ `rong` do người gọi tính bằng `soTienRong` (nguon-khoan.ts) TRÊN MỌI DÒNG CỦA ĐƠN, không
// phải `amount` trần: tách khoản, gỡ gắn, hoàn tiền đều GIỮ dòng gốc (PAYMENT, số dương) rồi ghi
// thêm dòng trỏ `adjustmentOfId` — đọc `amount` trần là xuất hoá đơn hai lần cho một khoản tiền.

import { nguonGiaoDich } from "./nguon-khoan";

/** Hai trạng thái đơn mà tiền trên đó ra ngăn RIÊNG (hoàn hay xuất — người quyết, không phải máy). */
export const TRANG_THAI_DON_DA_HUY = ["CANCELLED", "REFUNDED"] as const;

export const LY_DO_LOAI = {
  KHOAN_DA_XOA: "Khoản đã xoá",
  DON_DA_XOA: "Đơn đã xoá",
  KHONG_PHAI_KHOAN_THU: "Bút toán điều chỉnh / đảo, không phải khoản thu",
  SO_TIEN_AM: "Số tiền không dương (dòng hoàn tiền)",
  DA_DAO_HET: "Đã bị đảo hết (tách / gỡ gắn / hoàn toàn phần)",
  KE_TOAN_TU_CHOI: "Kế toán đã từ chối",
  CHUYEN_NOI_BO: "Chuyển tiền nội bộ giữa hai bé — không phải tiền mới",
  NHAP_LICH_SU: "Nhập lịch sử — thu trước khi lên hệ thống",
} as const;
export type LyDoLoai = keyof typeof LY_DO_LOAI;

export type KhoanPhanLoai = {
  paymentType: string;
  amount: number;
  accountantStatus: string;
  method: string;
  note: string | null;
  deletedAt: Date | null;
};

export type DonPhanLoai = {
  status: string;
  deletedAt: Date | null;
  centerId: string | null;
};

export type PhanLoaiKhoan =
  /** Tiền thật của đơn đang sống — vào hàng chờ hoá đơn. */
  | { vao: "HANG_CHO" }
  /** Tiền thật trên đơn đã huỷ / đã hoàn — ngăn riêng, hoàn hay xuất do người quyết. */
  | { vao: "DON_DA_HUY" }
  /** Tiền thật nhưng đơn chưa có cơ sở — không tạo hoá đơn được (centerId NOT NULL). */
  | { vao: "THIEU_CO_SO" }
  | { vao: "LOAI"; lyDo: LyDoLoai };

/**
 * @param rong số ròng của khoản — `soTienRong(...)` trên mọi dòng của đơn.
 *
 * ⚠️ THỨ TỰ XÉT: mọi lý do LOẠI trước; rồi "thiếu cơ sở" (không có cơ sở thì ngăn nào cũng
 * không tạo được hoá đơn); rồi "đơn đã huỷ"; còn lại vào hàng chờ.
 */
export function phanLoaiKhoan(k: KhoanPhanLoai, don: DonPhanLoai, rong: number): PhanLoaiKhoan {
  if (k.deletedAt != null) return { vao: "LOAI", lyDo: "KHOAN_DA_XOA" };
  if (don.deletedAt != null) return { vao: "LOAI", lyDo: "DON_DA_XOA" };
  if (k.paymentType !== "PAYMENT") return { vao: "LOAI", lyDo: "KHONG_PHAI_KHOAN_THU" };
  if (k.amount <= 0) return { vao: "LOAI", lyDo: "SO_TIEN_AM" };
  if (rong <= 0) return { vao: "LOAI", lyDo: "DA_DAO_HET" };
  if (k.accountantStatus === "REJECTED") return { vao: "LOAI", lyDo: "KE_TOAN_TU_CHOI" };

  // `method` TRƯỚC marker: dòng +X của chuyển nội bộ là tiền đã xác nhận CŨ và KHÔNG có RCP;
  // nếu một ngày ghi chú của nó không mang marker thì `method` vẫn bắt được.
  const nguon = nguonGiaoDich(k.note);
  if (k.method === "chuyen-noi-bo" || nguon.loai === "CHUYEN_NOI_BO") {
    return { vao: "LOAI", lyDo: "CHUYEN_NOI_BO" };
  }
  if (nguon.loai === "LICH_SU") return { vao: "LOAI", lyDo: "NHAP_LICH_SU" };

  if (don.centerId == null) return { vao: "THIEU_CO_SO" };
  if ((TRANG_THAI_DON_DA_HUY as readonly string[]).includes(don.status)) return { vao: "DON_DA_HUY" };
  return { vao: "HANG_CHO" };
}

/**
 * GĐ 8 — đơn có khoản NGÂN HÀNG (webhook / gắn tay) còn là tiền thật không. Dùng cho luật NGHI TRÙNG
 * theo CẢ ĐƠN: lời khai tay và chuyển khoản cùng đơn là nghi trùng BẤT KỂ khoản chuyển khoản đang nằm
 * ở hàng chờ hay đã khoá vào hoá đơn khác.
 *
 * Vì sao phải theo cả đơn (đo 27/09, thiết kế GĐ 8): `gomLanThu` chỉ nhìn tập khoản nó được đưa — tải
 * PDF cho riêng khoản khai tay thì bản nháp chỉ giữ khoản khai tay, lần thu dựng lại thành LOI_KHAI và
 * nút Xác nhận SÁNG; hoặc khoản chuyển khoản đã khoá vào hoá đơn đã xác nhận thì khoản khai tay còn lại
 * rơi về "Khai tay" — đúng hình dạng ORD-260910-000002. Đọc nguồn theo MARKER, không theo giao dịch tra
 * được (giao dịch ngoài phạm vi đọc vẫn là tiền ngân hàng).
 *
 * `payments` là MỌI dòng còn sống của đơn (kể cả khoản đã khoá); `rong` = `soTienRong` trên chúng.
 */
export function donCoKhoanNganHang(
  payments: readonly (KhoanPhanLoai & { id: string })[],
  don: DonPhanLoai,
  rong: ReadonlyMap<string, number>,
): boolean {
  return payments.some((p) => {
    const loai = nguonGiaoDich(p.note).loai;
    return (loai === "WEBHOOK" || loai === "GAN_TAY") && phanLoaiKhoan(p, don, rong.get(p.id) ?? 0).vao !== "LOAI";
  });
}
