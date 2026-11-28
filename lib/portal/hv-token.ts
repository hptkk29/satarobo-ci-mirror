// lib/portal/hv-token.ts — Cổng học sinh: token CHẾ ĐỘ HỌC SINH + vé xác minh tạm. THUẦN (không server-only) để test được.
//
// Cổng học sinh chạy ngay trên tài khoản của ba mẹ. "Đang ở chế độ học sinh" KHÔNG còn suy từ đường dẫn
// (/portal/hoc-sinh/*) mà là MỘT cookie đã ký, ràng buộc cả phụ huynh lẫn con:
//   · token của người khác / bị sửa / sai chữ ký  ⇒ coi như KHÔNG ở chế độ (và trang học sinh đá về màn "Vào");
//   · token KHÔNG có hạn: hết hạn mà tự rơi về chế độ ba mẹ thì con thoát được không cần mã. Cookie sống 400 ngày
//     (trần của trình duyệt) và chỉ mất khi nhập đúng mã thoát hoặc xoá dữ liệu trình duyệt.
import { makeToken, verifyToken } from "@/lib/portal/active-site-token";

export const HV_COOKIE = "portal_hv";
/** Trần tuổi cookie của trình duyệt (RFC 6265bis) — sống càng lâu càng tốt, xem ghi chú đầu tệp. */
export const HV_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

export type CheDoHocSinh = { parentUserId: string; studentId: string; luc: number };

const MA_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function taoTokenCheDo(parentUserId: string, studentId: string, now: number, secret: string): string {
  return makeToken(`hv1|${parentUserId}|${studentId}|${Math.trunc(now)}`, secret);
}

/** `null` khi sai chữ ký / sai khuôn / id lạ. KHÔNG kiểm "có đúng người đăng nhập không" — việc của chỗ gọi. */
export function docTokenCheDo(token: string | undefined | null, secret: string): CheDoHocSinh | null {
  if (!token || token.length > 400) return null;
  const v = verifyToken(token, secret);
  if (!v) return null;
  const p = v.split("|");
  if (p.length !== 4 || p[0] !== "hv1") return null;
  const [, parentUserId, studentId, luc] = p as [string, string, string, string];
  if (!MA_ID.test(parentUserId) || !MA_ID.test(studentId)) return null;
  const n = Number(luc);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { parentUserId, studentId, luc: n };
}

// ── Vé xác minh tạm: bước 1 của "Đổi mã" (nhập mã hiện tại) / "Quên mã" (nhập mật khẩu) đã QUA thì được cấp vé,
//    bước đặt mã mới đòi vé. Vé buộc người + mục đích + hạn ngắn; mục đích khác nhau thì không dùng chéo.
export type MucDichVe = "doi" | "quen";
export const HAN_VE_MS = 10 * 60 * 1000;

export function taoVeXacMinh(parentUserId: string, mucDich: MucDichVe, now: number, secret: string): string {
  return makeToken(`ve1|${parentUserId}|${mucDich}|${Math.trunc(now) + HAN_VE_MS}`, secret);
}

export function kiemVeXacMinh(
  ve: string | undefined | null,
  parentUserId: string,
  mucDich: MucDichVe,
  now: number,
  secret: string,
): boolean {
  if (!ve || ve.length > 400) return false;
  const v = verifyToken(ve, secret);
  if (!v) return false;
  const p = v.split("|");
  if (p.length !== 4 || p[0] !== "ve1") return false;
  if (p[1] !== parentUserId || p[2] !== mucDich) return false;
  const han = Number(p[3]);
  return Number.isFinite(han) && han > now;
}
