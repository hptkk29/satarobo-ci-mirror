// lib/payments/pos/tach-ma-pos.ts — Tách mã phiếu 5 ký tự khỏi ghi chú giao dịch thẻ. THUẦN.
//
// ⚠️ CỐ Ý KHÔNG dùng `docMemo` / cửa sổ trượt. `docMemo` quét trên chuỗi đã BỎ dấu cách vì nội
// dung chuyển khoản ngân hàng hay dính liền (`MBVCB.123...`). Ghi chú trên máy POS thì do NHÂN
// VIÊN gõ, có dấu cách thật — nên ranh giới token là thông tin đáng tin, và vứt nó đi chỉ làm
// tăng ứng viên giả (5 ký tự bất kỳ trong tên khách / dãy số có thể lọt checksum với xác suất
// ~1/27). Ở đây mã phải là MỘT TOKEN nguyên vẹn: dài đúng 5 và qua `maHopLe`.
// Lưới `[POS-W2]` ghim việc tầng POS chỉ truyền cho `thuTheoPhieuGop` đúng một token.
import { DAI_MA, maHopLe } from "@/lib/payments/ma-phieu";

/**
 * Tên / họ / chữ tiếng Việt KHÔNG DẤU dài 5 ký tự mà nhân viên hay gõ vào ghi chú. Mã phiếu là
 * một TOKEN nguyên vẹn — nên một tên người gõ nguyên chữ cũng là token nguyên vẹn, và một số
 * tên lọt `maHopLe` (đo 29/09: KHANG, HUYNH, CHANH — "Huỳnh" là họ top-10). Hệ quả khi không
 * loại: "Huynh Khang ZDZ4A" ra 3 mã ⇒ mất khớp; "Hoc phi be Khang" (quên mã) ra đúng 1 mã
 * `KHANG` ⇒ đi khớp một phiếu KHÁC nhà nếu phiếu `KHANG` đang mở trùng số tiền.
 *
 * Chỉ giữ những chữ THẬT SỰ qua `maHopLe` (lọc lúc nạp module) — danh sách thô dài hơn cũng vô
 * hại. Cái giá: phiếu mang đúng mã `KHANG`/`HUYNH`/`CHANH` sẽ không bao giờ tự khớp qua POS mà
 * rơi vào CAN_XU_LY — an toàn (xử lý tay), không mất tiền. Ca `[POS-T10]`.
 */
const CHU_THUONG_GAP_THO = (
  "KHANG HUYNH CHANH THANH TRANG TRUNG PHUNG QUANG HOANG KHANH PHONG NHUNG NGOAN THUAN CUONG " +
  "DUONG LUONG PHUOC HUONG THANG GIANG KHOAI NGHIA THINH TUONG VUONG DOANH HOANH TRINH CHUNG " +
  "THONG TUYEN TUYET KHUAT NGOAI TRUOC CHIEN THIEN THIEU THUAT THUOC CHINH QUYNH CHUAN KHOAN " +
  "PHIEU LUYEN DUYEN HUYEN QUYET SANG BINH LINH MINH HIEU TUAN KHOA NGOC NHAT DIEP DUNG THUY"
).split(" ");
const CHU_THUONG_GAP: ReadonlySet<string> = new Set(
  CHU_THUONG_GAP_THO.filter((c) => c.length === DAI_MA && maHopLe(c)),
);

/** Ký tự không phải chữ/số ở HAI ĐẦU token (dấu câu, ngoặc, nháy…). Giữa token thì giữ. */
const VIEN_KHONG_CHU_SO = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Chữ thường gặp (tên người…) — `tachMaPos` loại; Việc 3 (`sai-ma.ts`) cũng cần để không coi là "mã của phiếu khác". */
export function laChuThuongGap(token: string): boolean {
  return CHU_THUONG_GAP.has(token);
}

/**
 * TOKEN của một ghi chú — MỘT phép duy nhất cho mọi nơi hiểu "ghi chú có những gì" [Việc 3, 09/10/2026]: tách theo
 * khoảng trắng, cắt dấu câu hai đầu, IN HOA, bỏ token rỗng; GIỮ thứ tự và trùng lặp (người gọi tự khử trùng).
 *
 * `tachMaPos` (đường tiền) và `phanLoaiSaiMa` (nút "Tôi nhập sai mã") cùng đi qua đây: hai nơi hiểu "token" khác nhau
 * là một giao dịch tự khớp ở nơi này và bị coi là gõ sai ở nơi kia. Ca `[HN3-02]` + lưới `[HN3-W*]` ghim việc này.
 */
export function tachTokenGhiChu(dienGiai: string | null): string[] {
  if (!dienGiai) return [];
  const ra: string[] = [];
  for (const tho of dienGiai.split(/\s+/)) {
    const token = tho.replace(VIEN_KHONG_CHU_SO, "").toUpperCase();
    if (token !== "") ra.push(token);
  }
  return ra;
}

/**
 * Mọi mã phiếu hợp lệ trong ghi chú, IN HOA, khử trùng, giữ thứ tự xuất hiện.
 * Người gọi quyết định: 0 mã / ≥2 mã ⇒ cần xử lý tay; đúng 1 mã ⇒ đi khớp.
 */
export function tachMaPos(dienGiai: string | null): string[] {
  const ra: string[] = [];
  for (const token of tachTokenGhiChu(dienGiai)) {
    if (token.length !== DAI_MA || !maHopLe(token) || CHU_THUONG_GAP.has(token)) continue;
    if (!ra.includes(token)) ra.push(token);
  }
  return ra;
}
