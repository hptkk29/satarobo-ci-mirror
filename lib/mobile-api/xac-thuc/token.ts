import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { TIEN_TO_ACCESS, TIEN_TO_REFRESH } from "./hang-so";

/**
 * Token của API di động — hàm THUẦN (không DB, không đồng hồ).
 *
 * Dạng: `<tiền tố><mã tra>.<bí mật>` — tiền tố `sma_` (access) hoặc `smr_` (refresh); mã tra = 16 byte ngẫu nhiên viết base64url
 * (22 ký tự, cố định suốt đời phiên); bí mật = 32 byte ngẫu nhiên viết base64url (43 ký tự, đổi ở mỗi lần phát).
 * Máy chủ chỉ lưu SHA-256 của bí mật (hex 64 ký tự); so bằng `timingSafeEqual` trên hai vùng nhớ 32 byte.
 * Token là CHUỖI MỜ: không mang quyền, không mang vai trò — nguồn quyền luôn là DB (luật cứng #6 của Nền Hệ thống).
 */
export type LoaiToken = "access" | "refresh";

const MA_TRA = /^[A-Za-z0-9_-]{22}$/;
const BI_MAT = /^[A-Za-z0-9_-]{43}$/;
const BAM_HEX = /^[0-9a-f]{64}$/;

export const sinhMaTra = (): string => randomBytes(16).toString("base64url");
export const sinhBiMat = (): string => randomBytes(32).toString("base64url");

export function ghepToken(loai: LoaiToken, maTra: string, biMat: string): string {
  return `${loai === "access" ? TIEN_TO_ACCESS : TIEN_TO_REFRESH}${maTra}.${biMat}`;
}

/** Tách token. Sai dạng, sai tiền tố (kể cả access gửi vào chỗ refresh) ⇒ `null`. */
export function tachToken(raw: unknown, loai: LoaiToken): { maTra: string; biMat: string } | null {
  if (typeof raw !== "string" || raw.length > 128) return null;
  const tienTo = loai === "access" ? TIEN_TO_ACCESS : TIEN_TO_REFRESH;
  if (!raw.startsWith(tienTo)) return null;
  const phan = raw.slice(tienTo.length).split(".");
  if (phan.length !== 2) return null;
  const [maTra, biMat] = phan;
  if (!MA_TRA.test(maTra) || !BI_MAT.test(biMat)) return null;
  return { maTra, biMat };
}

/** SHA-256 của bí mật, hex 64 ký tự. Bí mật 256 bit ngẫu nhiên nên không cần muối / băm chậm. */
export const bamBiMat = (biMat: string): string => createHash("sha256").update(biMat, "utf8").digest("hex");

/** So hai băm hex bằng phép so thời gian hằng. Băm sai dạng / thiếu ⇒ false (không ném). */
export function bamKhop(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || !BAM_HEX.test(a) || !BAM_HEX.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Cặp token mới (bản rõ chỉ tồn tại trong bộ nhớ lúc phát) + băm để lưu. */
export type CapToken = {
  accessToken: string;
  refreshToken: string;
  accessHash: string;
  refreshHash: string;
};

export function phatCapToken(maTra: string): CapToken {
  const a = sinhBiMat();
  const r = sinhBiMat();
  return {
    accessToken: ghepToken("access", maTra, a),
    refreshToken: ghepToken("refresh", maTra, r),
    accessHash: bamBiMat(a),
    refreshHash: bamBiMat(r),
  };
}

/** Khoá bộ đếm: SHA-256 của `<ngăn>:<giá trị đã chuẩn hoá>` — bảng không chứa số điện thoại, email hay IP rõ. */
export const bamKhoaDem = (ngan: string, giaTri: string): string => createHash("sha256").update(`${ngan}:${giaTri}`, "utf8").digest("hex");
