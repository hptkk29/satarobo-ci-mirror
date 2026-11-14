/**
 * Phần CLIENT-SAFE của mã nhận: khoá localStorage + đọc/ghi an toàn. Không import mã server.
 * Trang lưu kết quả ghi mã vào đây sau khi server cấp (`ghiMaNhanLocal`); form nhận bài đọc ra để tự điền.
 * localStorage có thể ném (chế độ riêng tư / chặn dữ liệu) ⇒ MỌI truy cập bọc try/catch, mất cũng không sao
 * (người dùng vẫn có mã trên màn hình / bản in).
 *
 * N13 (máy dùng chung): mã có HẠN. Giá trị giữ nguyên là chuỗi mã thô ở `sr.disc.maNhan`; thời điểm ghi nằm ở khoá
 * kèm `sr.disc.maNhan.luc`. Thiếu mốc (bản ghi cũ trước khi có hạn) hoặc quá `HAN_MA_NHAN_LOCAL_MS` ⇒ coi như hết hạn,
 * XOÁ và trả null. Người dùng còn xoá được ngay bằng `xoaMaNhanLocal` (nút "Xoá dữ liệu DISC trên máy này").
 */
export const KHOA_LOCAL_MA_NHAN = "sr.disc.maNhan";
export const KHOA_LOCAL_MA_NHAN_LUC = "sr.disc.maNhan.luc";
/** 3 ngày: đủ để quay lại nhận bài sau khi chờ mã xác minh; không đủ để một máy công cộng giữ mãi. */
export const HAN_MA_NHAN_LOCAL_MS = 3 * 24 * 3_600_000;

function hauToLuc(khoa: string): string {
  return khoa === KHOA_LOCAL_MA_NHAN ? KHOA_LOCAL_MA_NHAN_LUC : `${khoa}.luc`;
}

export function xoaMaNhanLocal(khoa: string = KHOA_LOCAL_MA_NHAN): void {
  try {
    window.localStorage.removeItem(khoa);
    window.localStorage.removeItem(hauToLuc(khoa));
  } catch {
    /* bỏ qua */
  }
}

export function docMaNhanLocal(khoa: string = KHOA_LOCAL_MA_NHAN, now: number = Date.now()): string | null {
  try {
    const v = window.localStorage.getItem(khoa);
    if (!v) return null;
    const luc = Number(window.localStorage.getItem(hauToLuc(khoa)));
    if (!Number.isFinite(luc) || luc <= 0 || now - luc > HAN_MA_NHAN_LOCAL_MS || luc - now > 3_600_000) {
      xoaMaNhanLocal(khoa);
      return null;
    }
    return v.length <= 32 ? v : null;
  } catch {
    return null;
  }
}

export function ghiMaNhanLocal(ma: string, khoa: string = KHOA_LOCAL_MA_NHAN, now: number = Date.now()): void {
  try {
    window.localStorage.setItem(khoa, ma);
    window.localStorage.setItem(hauToLuc(khoa), String(now));
  } catch {
    /* bỏ qua */
  }
}
