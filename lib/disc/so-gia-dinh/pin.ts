import "server-only";
/**
 * MÃ PIN 4 SỐ để thoát «chế độ trẻ em» (doc 18, mục 8): bé cầm máy của bố mẹ làm bài, muốn rời màn khoá phải có PIN của chủ sổ.
 *
 * ⚠️ Đây là hàng rào TRẢI NGHIỆM (trẻ không tự bấm ra), KHÔNG phải ranh giới bảo mật: phiên đăng nhập vẫn là của chủ sổ.
 * Băm bằng scrypt có muối; so bằng `timingSafeEqual`; sai 5 lần ⇒ khoá 15 phút. Không bao giờ log PIN.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SO_LAN_SAI_TOI_DA = 5;
export const PHUT_KHOA_PIN = 15;

export function bamPin(pin: string, muoi: Buffer = randomBytes(16)): string {
  const h = scryptSync(pin, muoi, 32);
  return `${muoi.toString("base64url")}.${h.toString("base64url")}`;
}

export function kiemPin(pin: string, luu: string): boolean {
  const [m, h] = luu.split(".");
  if (!m || !h) return false;
  try {
    const muoi = Buffer.from(m, "base64url");
    const dich = Buffer.from(h, "base64url");
    // Chuỗi lưu hợp lệ luôn có muối 16 byte + băm 32 byte; ngắn hơn là hỏng (muối/băm rỗng sẽ khiến mọi PIN «khớp»).
    if (muoi.length < 8 || dich.length < 16) return false;
    const thu = scryptSync(pin, muoi, dich.length);
    return dich.length === thu.length && timingSafeEqual(dich, thu);
  } catch {
    return false;
  }
}

export type TrangThaiPin = { readonly pinSai: number; readonly khoaDen: Date | null };

/** Còn bị khoá không (tại `bayGio`). */
export function dangKhoaPin(t: TrangThaiPin, bayGio: Date): boolean {
  return t.khoaDen !== null && t.khoaDen.getTime() > bayGio.getTime();
}

/** Sau MỘT lần sai: số lần mới + hạn khoá (nếu chạm ngưỡng). */
export function sauLanSai(t: TrangThaiPin, bayGio: Date): { readonly pinSai: number; readonly khoaDen: Date | null } {
  const sai = t.pinSai + 1;
  return sai >= SO_LAN_SAI_TOI_DA
    ? { pinSai: 0, khoaDen: new Date(bayGio.getTime() + PHUT_KHOA_PIN * 60_000) }
    : { pinSai: sai, khoaDen: null };
}
