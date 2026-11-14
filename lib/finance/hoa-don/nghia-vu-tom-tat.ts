// lib/finance/hoa-don/nghia-vu-tom-tat.ts — CHỮ của dòng tóm tắt «scanner đã ghi nhận bao nhiêu nghĩa vụ hoá đơn». THUẦN: không DB, không đồng hồ (nhận `now`).
//
// Vì sao có (02/11/2026, chủ dự án thử trên `test`): «cs2 chưa có data nên không check được gì». Đo: scanner đã ghi 32 nghĩa vụ cho CS2 (31 chờ xuất · 1 đang xử lý) nhưng KHÔNG màn nào
// liệt kê `HoaDonNghiaVu` — khu Ngoại lệ chỉ hiện sai lệch (0 dòng khi mọi thứ khớp) nên người dùng thấy «trống» dù hệ thống đã làm việc. Dòng tóm tắt này nói thật điều scanner đã làm,
// để «0 ngoại lệ» đọc được là «đã quét N nghĩa vụ và không có gì lệch» chứ không phải «chưa chạy».

export const NHAN_TRANG_THAI_NGHIA_VU: Readonly<Record<string, string>> = {
  CHO_XUAT: "chờ xuất",
  CHO_QUYET: "chờ quyết",
  DANG_XU_LY: "đang xử lý",
  DA_XUAT: "đã xuất",
  KHONG_XUAT: "không cần xuất",
  MAT_NGUON: "mất nguồn",
};

/** Thứ tự hiển thị cố định (việc cần làm trước, việc đã xong sau) — không phụ thuộc thứ tự DB trả về. */
const THU_TU = ["CHO_QUYET", "CHO_XUAT", "DANG_XU_LY", "DA_XUAT", "KHONG_XUAT", "MAT_NGUON"] as const;

export type TomTatNghiaVu = {
  tong: number;
  theoTrangThai: Readonly<Record<string, number>>;
  /** Lần quét gần nhất của một nghĩa vụ bất kỳ trong phạm vi (ISO), hoặc null khi chưa có. */
  quetLanCuoiLuc: string | null;
};

/** «lần quét gần nhất» tính theo giờ Việt Nam, đủ ngắn để đọc: «02/11 18:40». */
export function dinhDangLanQuet(iso: string): string {
  // Ghép từ `formatToParts`, không dùng `toLocaleString`: thứ tự ngày/giờ của `vi-VN` đổi theo bản ICU (đo: «00:30 03-11» thay vì «03/11 00:30»).
  const parts = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}/${g("month")} ${g("hour")}:${g("minute")}`;
}

/**
 * Dựng câu tóm tắt. `tong = 0` ⇒ nói NGUYÊN NHÂN có thể (cơ sở chưa vào thí điểm / chưa có khoản thu cần hoá đơn) chứ không để trống. Trạng thái lạ (thêm sau này) vẫn được đếm và in nhãn thô,
 * không bị nuốt.
 */
export function cauTomTatNghiaVu(t: TomTatNghiaVu): string {
  if (t.tong === 0) {
    return "Scanner chưa ghi nhận nghĩa vụ hoá đơn nào trong phạm vi này — cơ sở có thể chưa vào thí điểm, hoặc chưa có khoản thu nào cần hoá đơn.";
  }
  const biet = THU_TU.filter((k) => (t.theoTrangThai[k] ?? 0) > 0).map((k) => `${t.theoTrangThai[k]} ${NHAN_TRANG_THAI_NGHIA_VU[k]}`);
  const la = Object.keys(t.theoTrangThai)
    .filter((k) => !(THU_TU as readonly string[]).includes(k) && (t.theoTrangThai[k] ?? 0) > 0)
    .sort()
    .map((k) => `${t.theoTrangThai[k]} ${k}`);
  const lan = t.quetLanCuoiLuc ? ` Lần quét gần nhất: ${dinhDangLanQuet(t.quetLanCuoiLuc)}.` : "";
  return `Scanner đã ghi nhận ${t.tong} nghĩa vụ hoá đơn: ${[...biet, ...la].join(" · ")}.${lan}`;
}
