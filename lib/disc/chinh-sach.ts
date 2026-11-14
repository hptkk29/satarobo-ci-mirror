/**
 * Hằng chính sách DISC — THUẦN (không import node:crypto, không DB) để cả client lẫn server import được.
 * Con số nào do pháp chế/owner chốt thì đổi Ở ĐÂY, một chỗ.
 */

/** Hạn giữ bài CHƯA nhận (claim). Chính sách chính thức do pháp chế chốt (L-5); đây là mặc định an toàn ngắn. */
export const NGAY_GIU_BAI_CHUA_NHAN = 90;

/** Số lần thử "mã nhận" tối đa cho MỘT dòng trước khi khoá nhận (chống đoán mã sau khi đã qua OTP). */
export const TOI_DA_LAN_THU_MA = 5;

/** Trần số câu trả lời mỗi bài — chặn payload phình to; bộ đề thật có ít hơn nhiều. */
export const TOI_DA_CAU_TRA_LOI = 200;

/**
 * Trần số BÀI MỚI trong cửa sổ trượt — lưới thứ hai ở tầng dịch vụ, chạy bằng DB, độc lập với bộ đếm tần suất của
 * route (bộ đếm đó rơi về bộ nhớ-theo-tiến-trình khi Upstash chết, nên không phải trần toàn cục). Đếm cả bài đã
 * xoá/hết hạn/thu hồi để kẻ spam không "xả" bộ đếm bằng cách để chủ số bấm xoá.
 *
 * N6 — HAI trần, vì trần theo SĐT một mình là đòn bẩy DoS + oracle với chủ số thật (5 bài giả khoá chủ số 24h):
 *  · THEO CẶP (SĐT, IP băm HMAC): kẻ gõ 5 lần chỉ khoá được CHÍNH IP của hắn với SĐT đó; chủ số từ IP khác không bị ảnh hưởng.
 *    Chạm trần này trả `QUA_NHIEU_YEU_CAU` — thông tin chỉ nói về IP của chính người gọi, không lộ gì về SĐT.
 *  · TRẦN CỨNG THEO SĐT (mọi IP): chỉ để chặn lạm dụng cực đoan. Chạm trần này trả `LUU_THAT_BAI` — Y HỆT mọi lỗi lưu
 *    khác, để từ IP sạch không thể hỏi "SĐT này đã bị dùng nhiều lần chưa". Còn lại: kẻ có ≥6 IP vẫn khoá được chủ số
 *    (30 bài/24h) — chỉ Turnstile/CAPTCHA ở cổng vào mới đóng hẳn (việc hạ tầng của owner, xem 06 §G.2-N6).
 */
export const TOI_DA_BAI_MOI_THEO_CAP = 5;
export const TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG = 30;
export const CUA_SO_DEM_BAI_THEO_SDT_MS = 24 * 60 * 60_000;

/** Khoá idempotency tối thiểu 22 ký tự base64url (≥ 128 bit nếu sinh ngẫu nhiên; UUID 36 ký tự cũng qua). */
export const DO_DAI_TOI_THIEU_KHOA_IDEM = 22;
export const DO_DAI_TOI_DA_KHOA_IDEM = 128;
export const MAU_KHOA_IDEM = /^[A-Za-z0-9_-]+$/;

/** Mặc định khi chiến dịch client gửi không nằm trong danh sách trắng. */
export const CHIEN_DICH_MAC_DINH = "DISC";

/**
 * Danh sách TRẮNG chiến dịch. Client chọn chuỗi → server KHÔNG tin: lạ ⇒ CHIEN_DICH_MAC_DINH.
 * Đây là nhãn kênh để đếm, không phải nguồn lead và không dính tới hoa hồng. Thêm kênh = thêm vào đây
 * (marketing yêu cầu), không nới regex.
 */
export const CHIEN_DICH_CHO_PHEP: readonly string[] = ["DISC", "DISC_QR", "DISC_FACEBOOK", "DISC_ZALO", "DISC_EMAIL", "DISC_TRUONG"];

export function chienDichHopLe(raw: unknown): string {
  return typeof raw === "string" && CHIEN_DICH_CHO_PHEP.includes(raw) ? raw : CHIEN_DICH_MAC_DINH;
}

/**
 * S-04 — CẦU CHÌ NGÂN SÁCH toàn cục theo ngày (không theo IP/SĐT). Trần theo IP yếu đi khi kẻ gọi xoay IP (IPv6 /64 đã gộp, nhưng
 * botnet IPv4 thì không) hoặc khi Upstash chết (bộ đếm rơi về bộ nhớ-theo-tiến-trình); cầu chì này đặt MỘT số tổng cho cả hệ thống
 * để lượt tấn công không đốt vô hạn OTP ZNS / lead rác. Chạm trần ⇒ route trả thông điệp CHUNG (không nói "đã chạm trần toàn cục").
 * Cấu hình bằng env (số nguyên dương); không đặt/không hợp lệ ⇒ mặc định bên dưới. Mặc định rộng hơn nhiều lần lưu lượng thật
 * (vài chục bài/ngày) để không chặn người dùng thật, đủ thấp để chặn đợt xả.
 */
export const TRAN_BAI_MOI_TOAN_CUC_MAC_DINH = 3000;
export const TRAN_OTP_CLAIM_TOAN_CUC_MAC_DINH = 1500;
export const CUA_SO_TRAN_TOAN_CUC_MS = 24 * 60 * 60_000;

/** Đọc trần từ env: chỉ nhận số nguyên dương thập phân thuần ("500"); mọi giá trị khác (rỗng, "abc", "0", "-5", "1e3", "12.5") ⇒ mặc định. */
export function docTranToanCuc(raw: string | undefined, macDinh: number): number {
  if (typeof raw !== "string" || !/^[1-9]\d{0,8}$/.test(raw.trim())) return macDinh;
  return Number(raw.trim());
}
