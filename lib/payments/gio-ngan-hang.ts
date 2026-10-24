// lib/payments/gio-ngan-hang.ts — GIỜ NGÂN HÀNG THỰC NHẬN của một giao dịch. THUẦN (không DB, không đồng hồ ngầm).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI — đối soát T9–T10/2026 (23–24/10/2026), đo trên PROD
//
// Webhook SePay/payOS gửi giờ giao dịch dạng "2026-09-24 14:57:00" — GIỜ VIỆT NAM, KHÔNG kèm múi
// giờ. `new Date("2026-09-24 14:57:00")` hiểu chuỗi đó theo MÚI GIỜ CỦA TIẾN TRÌNH:
//   · Vercel (UTC, đến 24/09) ⇒ 14:57 UTC = 21:57 giờ VN ⇒ `BankTransaction.transferredAt` LỆCH +7 GIỜ.
//   · VPS (TZ = Asia/Ho_Chi_Minh, từ 28/09) ⇒ đúng — nhưng đúng VÌ MÁY, không vì mã.
// Đo được: 46/87 giao dịch có `createdAt − transferredAt ≈ −6h59'`, và 36 khoản `Payment` mang đúng giờ
// lệch ấy làm `paidDate`; 7 khoản bị đẩy sang NGÀY KẾ TIẾP (khớp 6/6 dòng "sai ngày" mà Sale ghi đúng).
//
// Sửa ở HAI chỗ, vì chúng là hai lỗi khác nhau:
//   1. `parseGioNganHang` — đọc chuỗi KHÔNG múi giờ LUÔN là giờ VN, không phụ thuộc máy.
//   2. `gioNganHangThuc` — dùng cho dữ liệu ĐÃ nằm trong DB (dòng đời cũ vẫn lệch): gắn tay một giao dịch
//      cũ phải lấy giờ ngân hàng đúng, không lấy lúc bấm gắn và không lấy giờ lệch +7h.
//
// ⚠️ Dùng `Date.UTC(...) − 7h` chứ KHÔNG dùng `new Date("...+07:00")` ghép chuỗi: ghép chuỗi lại đẻ ra
// đúng cái lỗi này ở những định dạng ngoài dự kiến ("2026/09/24", giây lẻ…). Không khớp định dạng nào
// ⇒ trả `null` để người gọi quyết (lùi về lúc nhận webhook), KHÔNG đoán.
// ─────────────────────────────────────────────────────────────────────────────

const GIO = 3_600_000;
const PHUT = 60_000;
/** Việt Nam không có giờ mùa hè: UTC+7 quanh năm. */
export const LECH_GIO_VN_MS = 7 * GIO;

/** Webhook đến SAU giao dịch; sai số đồng hồ cho phép khi một giao dịch trông như "ở tương lai". */
export const DUNG_SAI_TUONG_LAI_MS = 5 * PHUT;

const KHONG_MUI_GIO = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const CO_MUI_GIO = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Chuỗi giờ giao dịch của nhà cung cấp → thời điểm tuyệt đối.
 *
 *  · không múi giờ ("2026-09-24 14:57:00" / "2026-09-24T14:57") ⇒ giờ VIỆT NAM;
 *  · có múi giờ ("…Z", "…+07:00") ⇒ tôn trọng múi giờ ấy;
 *  · còn lại ⇒ `null`.
 */
export function parseGioNganHang(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const m = KHONG_MUI_GIO.exec(s);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? 0));
    // Date.UTC "cuộn" ngày không tồn tại (2026-02-31 → 03-03) — từ chối thay vì lặng lẽ đổi ngày.
    const kiem = new Date(utc);
    if (kiem.getUTCMonth() !== Number(mo) - 1 || kiem.getUTCDate() !== Number(d)) return null;
    return new Date(utc - LECH_GIO_VN_MS);
  }
  if (CO_MUI_GIO.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type GiaoDichCoGio = {
  transferredAt: Date;
  /** Lúc hệ thống NHẬN giao dịch (webhook đến). Thiếu ⇒ chỉ so với `now`. */
  createdAt?: Date | null;
};

/**
 * Giờ ngân hàng thực nhận của một giao dịch ĐÃ LƯU — kể cả dòng đời cũ bị lệch +7 giờ.
 *
 * Quy tắc, theo thứ tự:
 *  1. `transferredAt` không sau mốc "đã nhận" (createdAt, hoặc `now`) quá {@link DUNG_SAI_TUONG_LAI_MS}
 *     ⇒ HỢP LỆ, dùng nguyên (kể cả giao dịch đồng bộ muộn nhiều ngày: giờ ngân hàng vẫn là giờ ngân hàng).
 *  2. Sau mốc ⇒ một giao dịch không thể xảy ra SAU khi hệ thống nhận. Nếu trừ 7 giờ thì rơi vào 30 phút
 *     trước mốc ⇒ đúng là lỗi múi giờ đời cũ ⇒ trả `transferredAt − 7h`.
 *  3. Còn lại (lệch lạ) ⇒ lùi về chính mốc "đã nhận" — KHÔNG bao giờ trả một giờ ở tương lai.
 */
export function gioNganHangThuc(txn: GiaoDichCoGio, now: Date): Date {
  const t = txn.transferredAt.getTime();
  const nhan = txn.createdAt && Number.isFinite(txn.createdAt.getTime()) ? txn.createdAt.getTime() : now.getTime();
  const moc = Math.min(nhan, now.getTime());
  if (!Number.isFinite(t)) return new Date(moc);
  if (t <= moc + DUNG_SAI_TUONG_LAI_MS) return txn.transferredAt;
  const lui7 = t - LECH_GIO_VN_MS;
  if (lui7 <= moc + DUNG_SAI_TUONG_LAI_MS && lui7 >= moc - 30 * PHUT) return new Date(lui7);
  return new Date(moc);
}
