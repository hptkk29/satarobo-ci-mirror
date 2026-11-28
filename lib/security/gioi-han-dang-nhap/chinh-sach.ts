/**
 * CHÍNH SÁCH GIỚI HẠN ĐĂNG NHẬP DÙNG CHUNG WEB + MOBILE (B4, 17/11/2026) — nối sau cờ `LOGIN_LIMITER_V2` (mặc định TẮT; chỉ local/TEST được bật).
 * Bản đề xuất B3.5 đã được SỬA ở phần "thiết bị quen" (xem dưới) trước khi triển khai.
 *
 * Hiện trạng khi cờ TẮT (không đổi): web `rateLimit()` 10/phút/IP + 5/phút/định danh; mobile `AuthAttemptCounter` cùng ngưỡng; hai kho tách rời, đếm cả lượt đúng.
 *
 * Khi cờ BẬT — bốn lớp đếm lượt SAI (lượt đúng được hoàn lại), cửa sổ 15 phút, MỘT kho dùng chung (bảng `AuthAttemptCounter`):
 *   L1  cặp (định danh, IP)   ≤ 5    chặn đúng cặp đó: kẻ xấu từ IP X không khoá được nạn nhân đăng nhập từ IP Y.
 *   L2  IP tổng               ≤ 40   chặn phun mật khẩu rải nhiều tài khoản; cả NAT trung tâm vẫn dư chỗ.
 *   L3  định danh toàn cục    ≤ 20   chặn dò PHÂN TÁN (nhiều IP). Vượt ngưỡng: CHỈ cặp "đã từng đăng nhập thành công" được thử thêm — và chỉ `quenToiDa` lượt.
 *   L4  IP tổng lượt          ≤ 300  trần chống lạm dụng thô (không hoàn lại).
 *
 * ⚠️ SỬA SO VỚI ĐỀ XUẤT B3.5 (chủ dự án yêu cầu 17/11/2026): bản đề xuất cho "thiết bị quen" (mobile: `maThietBi` từng có phiên) VƯỢT QUA L3. Đó là lỗ hổng:
 *   · `maThietBi` do CLIENT tự khai — kẻ dò chỉ cần biết/đoán một UUID đã từng dùng (hoặc thử lần lượt) là qua cổng; một ID khai báo KHÔNG phải bằng chứng thiết bị.
 *   · "quen" được miễn TOÀN BỘ L3 ⇒ không còn giới hạn nào với kẻ có ID đó.
 * Bản này: (1) KHÔNG nhận bất kỳ định danh thiết bị nào từ client; (2) "quen" = bằng chứng do MÁY CHỦ quan sát — `gh:ok:<băm(định danh|IP)>` chỉ được ghi SAU MỘT LẦN ĐĂNG NHẬP
 * THÀNH CÔNG (đã so đúng mật khẩu); kẻ không biết mật khẩu không tạo được dấu ấy; (3) cặp quen vẫn bị L1, L2, L4 và một trần RIÊNG `quenToiDa` (3 lượt/cửa sổ) ở L3 — KHÔNG bao giờ được miễn trừ hoàn toàn;
 * (4) dấu ấy gắn với CẶP (định danh, IP) nên một dấu ấy ở IP này không mở cửa cho IP khác. Hệ quả chấp nhận: chủ tài khoản đổi mạng đúng lúc tài khoản đang bị dò phân tán sẽ phải chờ hết cửa sổ.
 *
 * Quy tắc xuyên suốt:
 *   · Khoá đếm là BĂM của giá trị CHUẨN HOÁ (SĐT canonical / email thường); không lưu SĐT/email/IP thô.
 *   · IP lấy ở `ipChoRateLimit` / `getClientIp` (nền tảng-aware): đổi `X-Forwarded-For` / `User-Agent` mỗi lượt KHÔNG đổi khoá.
 *   · Không đếm được (lỗi kho) ⇒ TỪ CHỐI tạm, không cho qua. Chặn trả CÙNG một câu cho tài khoản có/không tồn tại.
 *   · Giám sát: mỗi lần chặn tăng bộ đếm ẩn danh `gh:chan:<lý do>` (cửa sổ 1 giờ) — đọc bằng `docGiamSat`.
 */
export const CHINH_SACH_DE_XUAT = {
  cuaSoMs: 15 * 60_000,
  capDinhDanhIp: 5,
  ipSai: 40,
  dinhDanhToanCuc: 20,
  ipLuot: 300,
  /** Lượt thêm cho cặp ĐÃ TỪNG thành công khi L3 đã vượt ngưỡng (trần RIÊNG, không miễn trừ). */
  quenToiDa: 3,
  /** Dấu ấy "đã từng thành công" sống bao lâu (30 ngày). */
  hanTinCayMs: 30 * 24 * 3_600_000,
  /** Cửa sổ bộ đếm giám sát. */
  giamSatMs: 3_600_000,
} as const;

export type ChinhSach = {
  readonly cuaSoMs: number;
  readonly capDinhDanhIp: number;
  readonly ipSai: number;
  readonly dinhDanhToanCuc: number;
  readonly ipLuot: number;
  readonly quenToiDa: number;
  readonly hanTinCayMs: number;
  readonly giamSatMs: number;
};
export type LyDoChan = "dinh-danh-ip" | "ip" | "dinh-danh-toan-cuc" | "dinh-danh-toan-cuc-quen" | "ip-luot";
export const MOI_LY_DO_CHAN: readonly LyDoChan[] = ["dinh-danh-ip", "ip", "dinh-danh-toan-cuc", "dinh-danh-toan-cuc-quen", "ip-luot"];
