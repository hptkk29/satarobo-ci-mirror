/**
 * SEC-12 (V8.45) — CHẶN MẬT KHẨU QUÁ YẾU khi phụ huynh ĐẶT / ĐỔI mật khẩu qua app (kích hoạt OTP · đặt lại OTP · đổi mật khẩu).
 *
 * Trước đây luật chỉ là «8–72 ký tự» (`12345678` hợp lệ); thanh độ mạnh ở web chỉ là gợi ý. HÀM THUẦN, không DB / mạng — gọi ở MÁY CHỦ (client không được tin).
 * Cố ý KHÔNG đòi «hoa+thường+số+ký tự đặc biệt» (người dùng là phụ huynh, ép luật phức tạp sinh mật khẩu dán giấy / quên): chỉ chặn những mật khẩu mà kẻ thử mật khẩu phổ biến
 * sẽ gõ ĐẦU TIÊN — dãy phổ biến, lặp một ký tự / một cụm ngắn, dãy số tăng/giảm, từ thông dụng (+ số), và mật khẩu CHỨA số điện thoại / phần tên email của CHÍNH tài khoản.
 * Trả MỘT câu chung (không nói luật nào bắt) để không dạy kẻ dò. Phạm vi: mobile (web chưa nối — web còn `min 8` ở các server action, sửa là việc riêng của luồng web).
 */
export const CAU_MAT_KHAU_YEU = "Mật khẩu quá dễ đoán — hãy chọn mật khẩu khác (tránh dãy số, số điện thoại hay từ thông dụng).";

const PHO_BIEN = new Set([
  "12345678", "123456789", "1234567890", "12345678910", "87654321", "987654321", "0987654321", "11111111", "22222222", "33333333", "44444444", "55555555", "66666666", "77777777", "88888888",
  "99999999", "00000000", "11223344", "12341234", "123123123", "12345679", "13579246", "1q2w3e4r", "1qaz2wsx", "qwertyui", "qwertyuiop", "asdfghjk", "asdfghjkl", "zxcvbnm1", "abcd1234",
  "abcdefgh", "abc12345", "a1234567", "aa123456", "password", "passw0rd", "iloveyou", "letmein1", "welcome1", "monkey123", "dragon123", "football", "baseball", "superman", "trustno1",
  "matkhau1", "matkhau12", "matkhau123", "matkhau1234", "mat khau", "satarobo", "satarobo1", "satarobo123", "sata1234", "sata12345", "robot123", "robot1234", "robotics", "phuhuynh", "phuhuynh1",
  "phuhuynh123", "hocsinh1", "hocsinh123", "danang123", "danang2026", "vietnam123", "admin123", "admin1234", "test1234", "12345qwert", "qwert12345", "00001111", "11112222", "20262026",
]);
const TU_GOC = /^(password|passw0rd|matkhau|satarobo|sata|robot|admin|qwerty|abc|iloveyou|phuhuynh|hocsinh|danang|vietnam|welcome|letmein|test|user|guest|login)\d{0,8}[!@#$.]{0,2}$/;

const chuanHoa = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

function laDayTangGiam(s: string): boolean {
  if (!/^\d{6,}$/.test(s)) return false;
  let tang = true;
  let giam = true;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d !== 1 && !(s[i - 1] === "9" && s[i] === "0")) tang = false;
    if (d !== -1 && !(s[i - 1] === "0" && s[i] === "9")) giam = false;
  }
  return tang || giam;
}

export type BoiCanhMatKhau = { sdt?: string | null; email?: string | null };

/** `null` = chấp nhận được; chuỗi = lý do (luôn là `CAU_MAT_KHAU_YEU`). */
export function lyDoMatKhauYeu(matKhau: string, boiCanh: BoiCanhMatKhau = {}): string | null {
  const m = chuanHoa(matKhau.trim());
  if (!m) return CAU_MAT_KHAU_YEU;
  if (PHO_BIEN.has(m) || TU_GOC.test(m)) return CAU_MAT_KHAU_YEU;
  if (/^(.)\1+$/.test(m)) return CAU_MAT_KHAU_YEU; // một ký tự lặp
  if (m.length >= 8 && /^(.{1,4})\1+$/.test(m)) return CAU_MAT_KHAU_YEU; // một cụm ≤ 4 ký tự lặp (abababab, 12341234)
  if (laDayTangGiam(m)) return CAU_MAT_KHAU_YEU;
  const so = m.replace(/\D/g, "");
  const sdt = (boiCanh.sdt ?? "").replace(/\D/g, "");
  if (sdt.length >= 9 && so.length >= 8) {
    const quocGia = sdt.startsWith("84") ? sdt.slice(2) : sdt.replace(/^0/, ""); // 9 số cuối
    if (quocGia.length >= 9 && so.includes(quocGia)) return CAU_MAT_KHAU_YEU;
  }
  const dau = chuanHoa((boiCanh.email ?? "").split("@")[0] ?? "");
  if (dau.length >= 4 && m.includes(dau)) return CAU_MAT_KHAU_YEU;
  return null;
}
