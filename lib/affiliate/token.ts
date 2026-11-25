// lib/affiliate/token.ts — MÃ CÔNG KHAI (public token) của một link / QR / mã giới thiệu. Đặc tả Affiliate §16–§17, §21, §64.
//
// Token KHÔNG phải bí mật xác thực — nó nằm trong URL, in trên QR, ai cũng thấy. Việc của nó là: (1) không đoán được từ token này ra token kia
// (không số thứ tự, không chứa id/SĐT/tên); (2) thu hồi và xoay được (mỗi token là MỘT dòng `AffiliateTrackingAsset`, thu hồi = đổi trạng thái);
// (3) đủ entropy để dò mò hàng loạt trên endpoint công khai không khả thi khi đã có giới hạn tần suất.
//
// 10 ký tự Crockford base32 = 50 bit. Ví dụ trong đặc tả (6 ký tự = 30 bit ≈ 1 tỉ) quá ngắn để đứng sau một endpoint không đăng nhập; 10 ký tự vẫn gõ tay
// được cho trường hợp CODE (đọc cho khách qua điện thoại). Alphabet bỏ I L O U để khỏi nhầm với 1 0 và tránh chữ tục.
//
// THUẦN trừ `sinhToken()` (nguồn ngẫu nhiên của hệ điều hành). `chuanHoaToken` là CỔNG: token lạ/hỏng/giả mạo ⇒ null và nơi gọi trả CÙNG một câu như token hết hạn
// (không lộ "token này từng tồn tại").
import { randomBytes } from "node:crypto";

export const DO_DAI_TOKEN = 10;
/** Crockford base32 (không I L O U). */
export const BANG_CHU_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Trần độ dài đầu vào được xét — chuỗi dài hơn là rác/cố ý, bỏ ngay không chuẩn hoá. */
const TRAN_DAU_VAO = 32;

/** Dựng token từ các byte ngẫu nhiên (đủ `DO_DAI_TOKEN` byte; mỗi byte lấy 5 bit thấp). THUẦN — tách khỏi nguồn ngẫu nhiên để test được. */
export function tokenTuByte(bytes: Uint8Array): string {
  if (bytes.length < DO_DAI_TOKEN) throw new Error(`Cần ít nhất ${DO_DAI_TOKEN} byte để dựng token`);
  let ra = "";
  for (let i = 0; i < DO_DAI_TOKEN; i += 1) ra += BANG_CHU_CROCKFORD[bytes[i]! & 31];
  return ra;
}

/** Token mới từ nguồn ngẫu nhiên mật mã của hệ điều hành. */
export function sinhToken(): string {
  return tokenTuByte(randomBytes(DO_DAI_TOKEN));
}

/**
 * Chuẩn hoá chữ người dùng/URL mang tới về token: bỏ khoảng trắng và gạch ngang (người đọc qua điện thoại hay chia nhóm "K8F2-9XQ4-7M"), HOA, và
 * quy ước Crockford (O→0, I/L→1). Trả `null` nếu KHÔNG đúng `DO_DAI_TOKEN` ký tự trong bảng chữ — không "sửa" tiếp, không cắt bớt.
 */
export function chuanHoaToken(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > TRAN_DAU_VAO) return null;
  const s = raw.replace(/[\s-]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  if (s.length !== DO_DAI_TOKEN) return null;
  for (const ch of s) if (!BANG_CHU_CROCKFORD.includes(ch)) return null;
  return s;
}

/** Định dạng để ĐỌC/IN (nhóm 4-4-2). Chỉ để hiển thị — luôn lưu và so token dạng liền. */
export function dinhDangTokenDeDoc(token: string): string {
  return token.length === DO_DAI_TOKEN ? `${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8)}` : token;
}
