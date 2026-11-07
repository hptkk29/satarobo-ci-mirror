// lib/finance/hoa-don/tu-xuat-sau-gio/chon-lan-thu.ts — KHI NÀO và LẦN THU NÀO được hệ thống TỰ xuất hoá đơn sau khi phụ huynh điền form QR. THUẦN.
//
// Yêu cầu BGĐ (03/11/2026): phụ huynh điền thông tin xuất hoá đơn qua mã QR → «sau n giờ (mặc định 2, admin tự chỉnh trong cấu hình hệ thống) sau khi PH nhập thì hệ thống tự xuất hoá đơn».
// Khoảng n giờ là để NHÂN VIÊN kịp sửa nếu PH điền sai (Sale sửa sau thì ghi đè — ai ghi sau thắng); mỗi lần PH gửi lại thì đồng hồ tính lại từ lần gửi cuối.
//
// ⚠️ KHÁC lô 23h (`xuat-lo-dem/chon-lan-thu.ts`) có chủ đích — đừng gộp hai bộ lọc:
//   · KHÔNG có cửa sổ ngày thu: phụ huynh chủ động xin hoá đơn (thường quét mã vài ngày sau khi đóng tiền), và nút «Phát hành» thủ công của kế toán cũng không có cửa sổ này.
//     Lô 23h thì có (nó xuất cho người KHÔNG xin hoá đơn, lùi ngày là lập hoá đơn lùi ngày). [Giả định cần chủ dự án xác nhận — xem `docs/ke-toan-hoa-don/hub/12-TU-XUAT-SAU-GIO.md`.]
//   · KHÔNG loại «khách đang khai»: đó chính là quần thể của B1.
//   · GIỐNG lô 23h: chỉ lần thu mà MỌI khoản đã được kế toán xác nhận — hệ thống không tự xác nhận tiền; không ngoại lệ (thiếu tiền / nghi trùng); nút «Phát hành» phải hiện.

export type MaBoQuaTuXuat = "NGAN_KHAC" | "KHONG_PHAT_HANH_DUOC" | "NGOAI_LE" | "KHOAN_CHUA_XAC_NHAN";

export const NHAN_BO_QUA_TU_XUAT: Readonly<Record<MaBoQuaTuXuat, string>> = {
  NGAN_KHAC: "Không còn ở hàng «Chờ xuất»",
  KHONG_PHAT_HANH_DUOC: "Nút «Phát hành» không hiện cho lần thu này (pháp nhân không dùng API, hoá đơn thay thế, thiếu cấu hình…)",
  NGOAI_LE: "Lần thu thiếu tiền hoặc nghi trùng — cần người quyết",
  KHOAN_CHUA_XAC_NHAN: "Còn khoản chưa được kế toán xác nhận — hệ thống không tự xác nhận tiền",
};

/** Số giờ chờ: nguyên dương (cấu hình hỏng — 0, âm, NaN — ném thay vì trở thành «xuất ngay» hay «không bao giờ xuất»). */
export function kiemSoGio(soGio: number): number {
  if (!Number.isInteger(soGio) || soGio < 1) throw new RangeError("Số giờ chờ tự xuất phải là số nguyên dương");
  return soGio;
}

/** Giờ hệ thống được phép tự xuất = lần gửi CUỐI của phụ huynh + n giờ. */
export function gioTuXuat(guiLuc: Date, soGio: number): Date {
  return new Date(guiLuc.getTime() + kiemSoGio(soGio) * 3_600_000);
}

/** Đã tới giờ chưa (đúng giờ là tới). */
export function denGioTuXuat(guiLuc: Date, soGio: number, now: Date): boolean {
  return now.getTime() >= gioTuXuat(guiLuc, soGio).getTime();
}

/**
 * Yêu cầu PH đã gửi quá lâu mà hệ thống chưa xuất được (tiền chưa được xác nhận, pháp nhân không dùng API…) thì NGỪNG tự xuất, để kế toán xử lý tay —
 * và để mỗi lượt quét không phải xét đi xét lại những yêu cầu cũ mãi mãi (chặn đói các yêu cầu mới hơn).
 */
export const TOI_DA_NGAY_CHO_TU_XUAT = 7;

export function conTrongHanTuXuat(guiLuc: Date, now: Date): boolean {
  return now.getTime() - guiLuc.getTime() <= TOI_DA_NGAY_CHO_TU_XUAT * 86_400_000;
}

export type DongUngVienTuXuat = {
  ngan: string;
  /** `phatHanhMisa.hien`. */
  phatHanhHien: boolean;
  /** `hanhDong.ngoaiLe != null`. */
  coNgoaiLe: boolean;
  khoanIds: readonly string[];
};

export type BoiCanhTuXuat = {
  /** Khoản (`Payment.id`) CHƯA được kế toán xác nhận. */
  khoanChuaXacNhan: ReadonlySet<string>;
};

/** `null` = được tự xuất; còn lại là MỘT mã lý do (thứ tự: ngăn → nút → ngoại lệ → tiền). */
export function lyDoBoQuaTuXuat(d: DongUngVienTuXuat, bc: BoiCanhTuXuat): MaBoQuaTuXuat | null {
  if (d.ngan !== "cho") return "NGAN_KHAC";
  if (!d.phatHanhHien) return "KHONG_PHAT_HANH_DUOC";
  if (d.coNgoaiLe) return "NGOAI_LE";
  if (d.khoanIds.length === 0 || d.khoanIds.some((id) => bc.khoanChuaXacNhan.has(id))) return "KHOAN_CHUA_XAC_NHAN";
  return null;
}
