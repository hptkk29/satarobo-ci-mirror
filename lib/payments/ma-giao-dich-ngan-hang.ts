// lib/payments/ma-giao-dich-ngan-hang.ts — MÃ GIAO DỊCH NGÂN HÀNG do người nhập khai tay. THUẦN.
//
// VÌ SAO: ghi nhận thủ công (`recordPayment`) KHÔNG có khoá chống trùng theo giao dịch — chỉ có
// idempotency theo (provider, providerTxnId) ở đường webhook. Đối soát T9–T10/2026: khoản
// 3.920.000đ phải nhập tay vì tài khoản MB chưa nối webhook; nếu sau này SePay đồng bộ lại giao dịch 04/10
// thì không gì ngăn tiền bị ghi lần hai. Mã giao dịch là khoá duy nhất cả hai đường cùng hiểu.
//
// Chuẩn hoá NGHIÊM: chỉ nhận chữ-số 6–40 ký tự (mã FT…/ACSP… của ngân hàng), in hoa, bỏ khoảng trắng và dấu gạch.
// Không khớp ⇒ `null` ⇒ người gọi từ chối — đừng đoán một chuỗi lạ thành khoá chống trùng.

const HOP_LE = /^[A-Z0-9]{6,40}$/;

export function chuanHoaMaGiaoDichNganHang(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.normalize("NFKC").replace(/[\s_-]+/g, "").toUpperCase();
  return HOP_LE.test(s) ? s : null;
}

/** Cho người nhập: ô trống = không khai (bỏ qua); ô có chữ mà không hợp lệ = LỖI, không lặng lẽ bỏ. */
export function docMaGiaoDichKhaiTay(raw: unknown): { loai: "KHONG_KHAI" } | { loai: "HOP_LE"; ma: string } | { loai: "SAI_DINH_DANG" } {
  if (raw === null || raw === undefined) return { loai: "KHONG_KHAI" };
  if (typeof raw === "string" && raw.trim() === "") return { loai: "KHONG_KHAI" };
  const ma = chuanHoaMaGiaoDichNganHang(raw);
  return ma ? { loai: "HOP_LE", ma } : { loai: "SAI_DINH_DANG" };
}
