// lib/finance/hoa-don/xuat-lo-dem/chon-lan-thu.ts — lần thu nào ĐƯỢC ĐƯA VÀO lô đêm 23h, và vì sao lần thu khác bị bỏ lại. THUẦN.
//
// Một hàm hỏi, một danh sách mã lý do: `lyDoBoQuaLanThu` trả `null` (đưa vào lô) hoặc MỘT mã. Báo cáo lô đếm theo mã, màn đọc nhãn theo mã
// (`NHAN_BO_QUA`), không ai viết lại điều kiện ở chỗ khác — ca nào bị bỏ lại đều có tên.
//
// ⚠️ HAI luật chọn có chủ đích, đừng nới khi chưa hỏi:
//   · NGÀY THU: chỉ lần thu từ `homQua` trở đi. Hoá đơn lập vào đêm D mang NGÀY D; xuất cho khoản thu của tuần trước là lập hoá đơn lùi ngày
//     (sai thời điểm lập hoá đơn). Khoản cũ hơn cửa sổ ở lại hàng chờ cho kế toán — lô KHÔNG quét bù lịch sử khi vừa bật.
//   · XÁC NHẬN: chỉ lần thu mà MỌI khoản đã `CONFIRMED`. Lô KHÔNG tự xác nhận: tiền đã về ngân hàng (webhook / POS / giao dịch đã gắn) do bộ quét `lib/finance/tu-xac-nhan-ngan-hang.ts`
//     xác nhận (chủ dự án chốt 08/11/2026, công tắc `payment.tuXacNhanNganHang`); khoản tiền mặt / chưa gắn ghi danh / chưa có bằng chứng ngân hàng ở lại hàng chờ cho người.
//   · ĐƠN CỌC: đơn có cọc CHƯA trả đủ thì KHÔNG vào lô — cọc + phần còn lại là MỘT hoá đơn, xuất khi trả đủ (hàng chờ tự gộp: `dong-hang-cho.ts`, `docDonCoc`).

export type MaBoQuaLanThu =
  | "NGAN_KHAC"
  | "NGAY_CU"
  | "KHONG_PHAT_HANH_DUOC"
  | "NGOAI_LE"
  | "KHACH_DANG_KHAI"
  | "KHOAN_CHUA_XAC_NHAN"
  | "DON_COC_CHUA_TRA_DU"
  | "CO_SO_NGOAI_LO";

export const NHAN_BO_QUA: Readonly<Record<MaBoQuaLanThu, string>> = {
  NGAN_KHAC: "Không còn ở hàng «Chờ xuất»",
  NGAY_CU: "Thu trước cửa sổ của lô (hôm qua, hôm nay) — kế toán xử lý, lô không xuất lùi ngày",
  KHONG_PHAT_HANH_DUOC: "Nút «Phát hành» không hiện cho lần thu này (pháp nhân không dùng API, hoá đơn thay thế, thiếu cấu hình…)",
  NGOAI_LE: "Lần thu thiếu tiền hoặc nghi trùng — cần người quyết",
  KHACH_DANG_KHAI: "Phụ huynh vừa mở mã QR và CHƯA gửi thông tin — đợi họ điền, đêm sau xuất",
  KHOAN_CHUA_XAC_NHAN: "Còn khoản chưa xác nhận (tiền mặt, chưa gắn ghi danh hoặc chưa có bằng chứng ngân hàng) — chờ người xử lý",
  DON_COC_CHUA_TRA_DU: "Đơn có cọc, chưa trả đủ — giữ cả đơn, xuất MỘT hoá đơn khi trả đủ",
  CO_SO_NGOAI_LO: "Cơ sở chưa nằm trong thí điểm Invoice Hub",
};

/** Giờ chạy lô cuối ngày theo giờ VN (BGĐ 09/11/2026: 23h30). MỘT nguồn cho chữ hiển thị — cron VPS (`deploy/crontab.example`) và lưới `[LD-W2]` ghim cùng con số. */
export const GIO_LO_CUOI_NGAY_VN = { gio: 23, phut: 30 } as const;

/**
 * Lúc lô cuối ngày chạy KẾ TIẾP kể từ `now` (đồng hồ truyền vào — luật 19). VN không có giờ mùa hè (UTC+7 cố định) nên cộng 7 giờ là đủ, không cần thư viện múi giờ.
 * Đúng 23h30 là đã tới giờ ⇒ lượt kế là ngày hôm sau.
 */
export function gioLoCuoiNgayKeTiep(now: Date): Date {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  const muc = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate(), GIO_LO_CUOI_NGAY_VN.gio, GIO_LO_CUOI_NGAY_VN.phut);
  const keTiep = vn.getTime() < muc ? muc : muc + 86_400_000;
  return new Date(keTiep - 7 * 3_600_000);
}

/** Khung giờ «yên lặng» theo giờ VN: thư hoá đơn do HỆ THỐNG tạo trong khung này được hẹn tới `den` giờ sáng (BGĐ 09/11/2026: lô 23h30 xong thì 8h sáng hôm sau mới gửi thư cho phụ huynh, tránh làm phiền). */
export const GIO_YEN_LANG_VN = { tu: 22, den: 8 } as const;

/**
 * Lúc nào được GỬI thư hoá đơn cho phụ huynh khi hoá đơn do hệ thống (lô cuối ngày) tạo vào lúc `now`: ngoài khung yên lặng ⇒ gửi ngay (`now`); trong khung (22h–8h VN) ⇒ 8h sáng kế tiếp.
 * Đồng hồ truyền vào (luật 19). Chỉ áp cho thư do HỆ THỐNG khởi tạo — «Gửi lại» tay của kế toán và «Xuất liền» của Sale gửi ngay (người bấm đang chờ kết quả).
 */
export function thoiDiemGuiThuHoaDonLo(now: Date): Date {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  const gio = vn.getUTCHours();
  if (gio < GIO_YEN_LANG_VN.tu && gio >= GIO_YEN_LANG_VN.den) return now;
  const homSau = gio >= GIO_YEN_LANG_VN.tu ? 1 : 0;
  const muc = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + homSau, GIO_YEN_LANG_VN.den, 0);
  return new Date(muc - 7 * 3_600_000);
}

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
  /** `DongHangCho.cocChuaTraDu` — đơn cọc chưa trả đủ. BẮT BUỘC (luật 7): quên thì khoản cọc bị xuất hoá đơn RIÊNG. */
  cocChuaTraDu: boolean;
};

export type BoiCanhChonLo = {
  /** Ngày VN của lúc chạy ("YYYY-MM-DD"). */
  homNay: string;
  /** Cơ sở trong thí điểm Hub (`coSoLoDem`). */
  coSoTrongLo: ReadonlySet<string>;
  /** Đơn có yêu cầu thông tin người mua mà phụ huynh CHƯA GỬI gì và liên kết còn hạn (09/11/2026: yêu cầu ĐÃ gửi thì đi cùng lô, không bị loại). */
  donKhachDangKhai: ReadonlySet<string>;
  /** Khoản (`Payment.id`) CHƯA được kế toán xác nhận. */
  khoanChuaXacNhan: ReadonlySet<string>;
};

export function lyDoBoQuaLanThu(d: DongUngVien, bc: BoiCanhChonLo): MaBoQuaLanThu | null {
  // Thứ tự là thứ tự "nguyên nhân gốc trước": cơ sở → ngăn → ngày → nút → ngoại lệ → khách → cọc → tiền.
  if (!d.coSoId || !bc.coSoTrongLo.has(d.coSoId)) return "CO_SO_NGOAI_LO";
  if (d.ngan !== "cho") return "NGAN_KHAC";
  if (d.ngayThu < lui(bc.homNay, SO_NGAY_LUI)) return "NGAY_CU";
  if (!d.phatHanhHien) return "KHONG_PHAT_HANH_DUOC";
  if (d.coNgoaiLe) return "NGOAI_LE";
  if (bc.donKhachDangKhai.has(d.orderId)) return "KHACH_DANG_KHAI";
  if (d.cocChuaTraDu) return "DON_COC_CHUA_TRA_DU";
  if (d.khoanIds.length === 0 || d.khoanIds.some((id) => bc.khoanChuaXacNhan.has(id))) return "KHOAN_CHUA_XAC_NHAN";
  return null;
}
