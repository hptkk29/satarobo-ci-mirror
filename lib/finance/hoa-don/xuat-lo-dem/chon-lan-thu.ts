// lib/finance/hoa-don/xuat-lo-dem/chon-lan-thu.ts — lần thu nào ĐƯỢC ĐƯA VÀO lô đêm 23h, và vì sao lần thu khác bị bỏ lại. THUẦN.
//
// Một hàm hỏi, một danh sách mã lý do: `lyDoBoQuaLanThu` trả `null` (đưa vào lô) hoặc MỘT mã. Báo cáo lô đếm theo mã, màn đọc nhãn theo mã
// (`NHAN_BO_QUA`), không ai viết lại điều kiện ở chỗ khác — ca nào bị bỏ lại đều có tên.
//
// ⚠️ HAI luật chọn có chủ đích, đừng nới khi chưa hỏi:
//   · NGÀY THU: chỉ lần thu từ `homQua` trở đi. Hoá đơn lập vào đêm D mang NGÀY D; xuất cho khoản thu của tuần trước là lập hoá đơn lùi ngày
//     (sai thời điểm lập hoá đơn). Khoản cũ hơn cửa sổ ở lại hàng chờ cho kế toán — lô KHÔNG quét bù lịch sử khi vừa bật.
//   · XÁC NHẬN: chỉ lần thu mà MỌI khoản đã được kế toán xác nhận. Phát hành xong, máy trạng thái tự xác nhận khoản còn chờ (cấp phiếu thu
//     RCP) — làm vậy dưới tên «hệ thống» là hệ thống tự xác nhận tiền thay kế toán. Khoản chưa xác nhận ở lại hàng chờ.

export type MaBoQuaLanThu =
  | "NGAN_KHAC"
  | "NGAY_CU"
  | "KHONG_PHAT_HANH_DUOC"
  | "NGOAI_LE"
  | "KHACH_DANG_KHAI"
  | "KHOAN_CHUA_XAC_NHAN"
  | "CO_SO_NGOAI_LO";

export const NHAN_BO_QUA: Readonly<Record<MaBoQuaLanThu, string>> = {
  NGAN_KHAC: "Không còn ở hàng «Chờ xuất»",
  NGAY_CU: "Thu trước cửa sổ của lô (hôm qua, hôm nay) — kế toán xử lý, lô không xuất lùi ngày",
  KHONG_PHAT_HANH_DUOC: "Nút «Phát hành» không hiện cho lần thu này (pháp nhân không dùng API, hoá đơn thay thế, thiếu cấu hình…)",
  NGOAI_LE: "Lần thu thiếu tiền hoặc nghi trùng — cần người quyết",
  KHACH_DANG_KHAI: "Phụ huynh đang khai (hoặc vừa gửi) thông tin xuất hoá đơn — chờ kế toán áp dụng",
  KHOAN_CHUA_XAC_NHAN: "Còn khoản chưa được kế toán xác nhận — lô không tự xác nhận tiền",
  CO_SO_NGOAI_LO: "Cơ sở chưa nằm trong thí điểm Invoice Hub",
};

/** Cửa sổ ngày thu: hôm nay và `SO_NGAY_LUI` ngày trước (khoản thu sau giờ chạy lô đêm hôm qua vẫn được xuất đêm nay). */
export const SO_NGAY_LUI = 1;

/** "YYYY-MM-DD" của `n` ngày trước `ngay` (lịch thuần, không phụ thuộc múi giờ máy). */
export function lui(ngay: string, n: number): string {
  const d = new Date(`${ngay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export type DongUngVien = {
  ngan: string;
  /** "YYYY-MM-DD" — `DongHangCho.ngayThu`. */
  ngayThu: string;
  coSoId: string | null;
  /** `phatHanhMisa.hien`. */
  phatHanhHien: boolean;
  /** `hanhDong.ngoaiLe != null`. */
  coNgoaiLe: boolean;
  orderId: string;
  khoanIds: readonly string[];
};

export type BoiCanhChonLo = {
  /** Ngày VN của lúc chạy ("YYYY-MM-DD"). */
  homNay: string;
  /** Cơ sở trong thí điểm Hub (`coSoLoDem`). */
  coSoTrongLo: ReadonlySet<string>;
  /** Đơn có yêu cầu thông tin người mua của phụ huynh đang mở (chưa hết hạn) hoặc đã gửi mà kế toán chưa áp dụng. */
  donKhachDangKhai: ReadonlySet<string>;
  /** Khoản (`Payment.id`) CHƯA được kế toán xác nhận. */
  khoanChuaXacNhan: ReadonlySet<string>;
};

export function lyDoBoQuaLanThu(d: DongUngVien, bc: BoiCanhChonLo): MaBoQuaLanThu | null {
  // Thứ tự là thứ tự "nguyên nhân gốc trước": cơ sở → ngăn → ngày → nút → ngoại lệ → khách → tiền.
  if (!d.coSoId || !bc.coSoTrongLo.has(d.coSoId)) return "CO_SO_NGOAI_LO";
  if (d.ngan !== "cho") return "NGAN_KHAC";
  if (d.ngayThu < lui(bc.homNay, SO_NGAY_LUI)) return "NGAY_CU";
  if (!d.phatHanhHien) return "KHONG_PHAT_HANH_DUOC";
  if (d.coNgoaiLe) return "NGOAI_LE";
  if (bc.donKhachDangKhai.has(d.orderId)) return "KHACH_DANG_KHAI";
  if (d.khoanIds.length === 0 || d.khoanIds.some((id) => bc.khoanChuaXacNhan.has(id))) return "KHOAN_CHUA_XAC_NHAN";
  return null;
}
