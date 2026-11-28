import { createHmac, timingSafeEqual } from "node:crypto";

import { getSigningSecret } from "@/lib/security/signing-key";

/**
 * LIÊN KẾT KÝ NGẮN HẠN tải PHIẾU THU (V8.10): app không gửi được `Authorization` khi mở bằng trình duyệt hệ thống, nên cấp một URL tự chứa chữ ký (HMAC-SHA256 theo khoá ký của hệ thống, tiền tố tách miền).
 * Token = base64url(JSON {u: userId, p: paymentId, e: hết hạn ms}) + "." + chữ ký. Ràng buộc người dùng + khoản + hạn; KHÔNG chứa studentId/số tiền/PII.
 * Quyền KHÔNG nằm trong token: nơi đổi token vẫn KIỂM LẠI sở hữu (khoản phải thuộc con của đúng phụ huynh `u` ở thời điểm tải) nên thu hồi liên kết giữa chừng ⇒ vô hiệu; token chỉ chứng minh «máy chủ đã cấp cho người này, còn hạn».
 * THUẦN (nhận `now`): test đóng băng được. TTL tối đa 300 giây.
 */
export const TTL_LIEN_KET_PHIEU_THU_GIAY = 300;
const MIEN = "phieu-thu-dl|v1|";

export type NoiDungLienKet = { u: string; p: string; e: number };

const ky = (payload: string): string => createHmac("sha256", getSigningSecret()).update(MIEN + payload).digest("base64url");

export function taoLienKetPhieuThu(userId: string, paymentId: string, now: Date, ttlGiay = TTL_LIEN_KET_PHIEU_THU_GIAY): { token: string; hetHanLuc: Date } {
  const ttl = Math.min(Math.max(1, Math.floor(ttlGiay)), TTL_LIEN_KET_PHIEU_THU_GIAY);
  const e = now.getTime() + ttl * 1000;
  const payload = Buffer.from(JSON.stringify({ u: userId, p: paymentId, e } satisfies NoiDungLienKet)).toString("base64url");
  return { token: `${payload}.${ky(payload)}`, hetHanLuc: new Date(e) };
}

export type KetQuaKiemLienKet = { ok: true; userId: string; paymentId: string } | { ok: false; ly: "DINH_DANG" | "CHU_KY" | "HET_HAN" };

export function kiemLienKetPhieuThu(token: string, now: Date): KetQuaKiemLienKet {
  if (typeof token !== "string" || token.length > 600) return { ok: false, ly: "DINH_DANG" };
  const cham = token.indexOf(".");
  if (cham <= 0 || cham === token.length - 1) return { ok: false, ly: "DINH_DANG" };
  const payload = token.slice(0, cham);
  const chuKy = token.slice(cham + 1);
  const dung = Buffer.from(ky(payload));
  const co = Buffer.from(chuKy);
  if (dung.length !== co.length || !timingSafeEqual(dung, co)) return { ok: false, ly: "CHU_KY" };
  let nd: Partial<NoiDungLienKet>;
  try {
    nd = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<NoiDungLienKet>;
  } catch {
    return { ok: false, ly: "DINH_DANG" };
  }
  if (typeof nd.u !== "string" || typeof nd.p !== "string" || typeof nd.e !== "number" || !nd.u || !nd.p) return { ok: false, ly: "DINH_DANG" };
  if (nd.e < now.getTime() || nd.e > now.getTime() + TTL_LIEN_KET_PHIEU_THU_GIAY * 1000 + 5000) return { ok: false, ly: "HET_HAN" }; // quá hạn HOẶC hạn dài bất thường (không do máy chủ cấp)
  return { ok: true, userId: nd.u, paymentId: nd.p };
}
