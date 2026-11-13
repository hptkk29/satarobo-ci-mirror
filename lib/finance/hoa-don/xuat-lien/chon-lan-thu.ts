// lib/finance/hoa-don/xuat-lien/chon-lan-thu.ts — LẦN THU NÀO được «Xuất liền» (nút của Sale). THUẦN. [09/11/2026: bỏ «tự xuất sau n giờ» — BGĐ đổi.]
//
// Yêu cầu BGĐ (03/11/2026): phụ huynh điền thông tin xuất hoá đơn qua mã QR → «sau n giờ (mặc định 2, admin tự chỉnh trong cấu hình hệ thống) sau khi PH nhập thì hệ thống tự xuất hoá đơn».
// Khoảng n giờ là để NHÂN VIÊN kịp sửa nếu PH điền sai (Sale sửa sau thì ghi đè — ai ghi sau thắng); mỗi lần PH gửi lại thì đồng hồ tính lại từ lần gửi cuối.
//
// ⚠️ KHÁC lô 23h (`xuat-lo-dem/chon-lan-thu.ts`) có chủ đích — đừng gộp hai bộ lọc:
//   · KHÔNG có cửa sổ ngày thu: phụ huynh chủ động xin hoá đơn (thường quét mã vài ngày sau khi đóng tiền), và nút «Phát hành» thủ công của kế toán cũng không có cửa sổ này.
//     Lô 23h thì có (nó xuất cho người KHÔNG xin hoá đơn, lùi ngày là lập hoá đơn lùi ngày). [Giả định cần chủ dự án xác nhận — xem `docs/ke-toan-hoa-don/hub/12-TU-XUAT-SAU-GIO.md`.]
//   · KHÔNG loại «khách đang khai»: đó chính là quần thể của B1.
//   · GIỐNG lô 23h: chỉ lần thu mà MỌI khoản đã `CONFIRMED` (tiền ngân hàng do bộ quét `tu-xac-nhan-ngan-hang.ts` xác nhận); không ngoại lệ (thiếu tiền / nghi trùng); nút «Phát hành» phải hiện; đơn CỌC chưa trả đủ thì giữ (MỘT hoá đơn khi trả đủ).

export type MaBoQuaTuXuat = "NGAN_KHAC" | "KHONG_PHAT_HANH_DUOC" | "NGOAI_LE" | "KHOAN_CHUA_XAC_NHAN" | "DON_COC_CHUA_TRA_DU";

export const NHAN_BO_QUA_TU_XUAT: Readonly<Record<MaBoQuaTuXuat, string>> = {
  NGAN_KHAC: "Không còn ở hàng «Chờ xuất»",
  KHONG_PHAT_HANH_DUOC: "Nút «Phát hành» không hiện cho lần thu này (pháp nhân không dùng API, hoá đơn thay thế, thiếu cấu hình…)",
  NGOAI_LE: "Lần thu thiếu tiền hoặc nghi trùng — cần người quyết",
  KHOAN_CHUA_XAC_NHAN: "Còn khoản chưa xác nhận (tiền mặt, chưa gắn ghi danh hoặc chưa có bằng chứng ngân hàng) — chờ người xử lý",
  DON_COC_CHUA_TRA_DU: "Đơn có cọc, chưa trả đủ — giữ cả đơn, xuất MỘT hoá đơn khi trả đủ",
};

export type DongUngVienTuXuat = {
  ngan: string;
  /** `phatHanhMisa.hien`. */
  phatHanhHien: boolean;
  /** `hanhDong.ngoaiLe != null`. */
  coNgoaiLe: boolean;
  khoanIds: readonly string[];
  /** `DongHangCho.cocChuaTraDu` — đơn cọc chưa trả đủ. BẮT BUỘC (luật 7): quên thì khoản cọc bị xuất hoá đơn RIÊNG. */
  cocChuaTraDu: boolean;
};

export type BoiCanhTuXuat = {
  /** Khoản (`Payment.id`) CHƯA được kế toán xác nhận. */
  khoanChuaXacNhan: ReadonlySet<string>;
};

/** `null` = được tự xuất; còn lại là MỘT mã lý do (thứ tự: ngăn → nút → ngoại lệ → cọc → tiền). */
export function lyDoBoQuaTuXuat(d: DongUngVienTuXuat, bc: BoiCanhTuXuat): MaBoQuaTuXuat | null {
  if (d.ngan !== "cho") return "NGAN_KHAC";
  if (!d.phatHanhHien) return "KHONG_PHAT_HANH_DUOC";
  if (d.coNgoaiLe) return "NGOAI_LE";
  if (d.cocChuaTraDu) return "DON_COC_CHUA_TRA_DU";
  if (d.khoanIds.length === 0 || d.khoanIds.some((id) => bc.khoanChuaXacNhan.has(id))) return "KHOAN_CHUA_XAC_NHAN";
  return null;
}
