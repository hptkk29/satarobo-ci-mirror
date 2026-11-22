// lib/finance/hoa-don/yeu-cau-nguoi-mua-token.ts — phần MẬT MÃ của yêu cầu thu thập thông tin người mua: sinh / băm / so khớp token, mã liên kết, dấu vân tay giá trị gốc. THUẦN (chỉ `node:crypto`), không DB, không đồng hồ.
//
// ⛔ CHỈ DÙNG Ở SERVER. Tách khỏi `yeu-cau-nguoi-mua.ts` (zod + hợp nhất ô + chống đoán + quyền — không kéo `node:crypto`) vì một biểu mẫu client có thể muốn import phần kiểm hợp lệ;
//    kéo `node:crypto` vào bundle trình duyệt là vỡ `next build` trong khi `tsc` vẫn xanh (cùng bẫy đã ghi ở `bam-nguoi-mua.ts`).
// ⛔ Không có trường giấy tờ tuỳ thân nào ở đây.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const DO_DAI_TOKEN_BYTE = 32;
/** 32 byte → base64url không đệm = đúng 43 ký tự. */
const MAU_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** Hình dạng id yêu cầu trong mã liên kết (uuid / cuid): chặn id rác trước khi chạm DB. */
export const MAU_ID_YEU_CAU = /^[A-Za-z0-9_-]{8,64}$/;

/** Token thô: 32 byte ngẫu nhiên, base64url. Chỉ trả MỘT lần cho người tạo; DB chỉ lưu `bamToken`. `nguon` để test tiêm nguồn ngẫu nhiên tất định. */
export function sinhToken(nguon: (soByte: number) => Buffer = randomBytes): string {
  const b = nguon(DO_DAI_TOKEN_BYTE);
  if (b.length !== DO_DAI_TOKEN_BYTE) throw new RangeError("Nguồn ngẫu nhiên phải trả đúng 32 byte");
  return b.toString("base64url");
}

export const laDinhDangToken = (token: unknown): token is string => typeof token === "string" && MAU_TOKEN.test(token);

/**
 * Băm token để lưu / tra: sha256 hex (64 ký tự). Token 256 bit ngẫu nhiên nên băm trần là đủ (không cần muối, không bị từ điển).
 * ⚠️ Chú thích trên model ghi "HMAC-SHA256 với khoá con dẫn xuất"; hợp đồng giao việc ghi sha256 — nếu lead muốn khoá HMAC, đổi MỘT chỗ này (chữ ký thêm tham số khoá).
 */
export function bamToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** So token do người dùng gửi với hash đã lưu, THỜI GIAN HẰNG. Token sai định dạng ⇒ false (vẫn so một lượt giả để thời gian không lộ "sai định dạng"). */
export function soKhopHash(hashDaLuu: string, token: unknown): boolean {
  const dung = laDinhDangToken(token);
  const thu = Buffer.from(bamToken(dung ? token : "0".repeat(43)), "hex");
  const luu = Buffer.from(typeof hashDaLuu === "string" ? hashDaLuu : "", "hex");
  if (luu.length !== thu.length) return false;
  return timingSafeEqual(luu, thu) && dung;
}

/** Mã liên kết công khai = `<id yêu cầu>.<token>`. Id không phải bí mật (chỉ là tay cầm để đếm số lần sai); token mới là bí mật. */
export const ghepMaLienKet = (id: string, token: string): string => `${id}.${token}`;
export function tachMaLienKet(ma: unknown): { id: string; token: string } | null {
  if (typeof ma !== "string") return null;
  const i = ma.indexOf(".");
  if (i < 1) return null;
  const id = ma.slice(0, i);
  const token = ma.slice(i + 1);
  return MAU_ID_YEU_CAU.test(id) && MAU_TOKEN.test(token) ? { id, token } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DẤU VÂN TAY GIÁ TRỊ GỐC (so xung đột từng ô lúc áp dụng — việc của lead)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Các cột của `Order` được băm lúc tạo = đúng những cột chuỗi mà bước ÁP DỤNG có thể ghi đè. Thêm cột vào `anhXaNguoiMuaSangDon` mà quên khai ở đây ⇒ áp dụng ghi đè IM LẶNG
 * giá trị kế toán đã khai (không báo «đơn đã được sửa»). Từ 02/11/2026 gồm cả CCCD ba/mẹ · SĐT ba/mẹ · tên + CCCD học viên. Ngày sinh học viên (kiểu ngày) CHƯA nằm trong băm —
 * áp dụng ghi đè nó khi phụ huynh có điền (giới hạn đã biết).
 */
export const COT_GOC = [
  "invoiceBuyerName",
  "invoiceCompanyName",
  "invoiceTaxCode",
  "invoiceEmail",
  "customerCccd",
  "invoiceParentPhone",
  "invoiceStudentName",
  "invoiceStudentCccd",
] as const;
export type CotGoc = (typeof COT_GOC)[number];
export type DonGoc = Readonly<Record<CotGoc, string | null | undefined>>;

/**
 * Băm TỪNG cột gốc của đơn, muối bằng id yêu cầu + tên cột (MST / email là dữ liệu entropy thấp — băm trần dò từ điển được). Cột trống ⇒ `null`
 * (phân biệt "trống" với "có giá trị"). Không lưu giá trị gốc ở đâu cả.
 */
export function giaTriGocHash(idYeuCau: string, don: DonGoc): Record<CotGoc, string | null> {
  const kq = {} as Record<CotGoc, string | null>;
  for (const c of COT_GOC) {
    const v = typeof don[c] === "string" ? (don[c] as string).normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase() : "";
    kq[c] = v === "" ? null : createHash("sha256").update(`${idYeuCau}\u0000${c}\u0000${v}`, "utf8").digest("hex");
  }
  return kq;
}
