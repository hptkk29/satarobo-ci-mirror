/**
 * THẺ MỞ KHOÁ của hộp «để lại thông tin» (07/11/2026) — thiết kế: «Miễn phí · một lần cho cả trang» (Tủ sách + Sức khỏe dùng chung).
 *
 * Người dùng để lại thông tin MỘT lần ⇒ máy chủ đặt cookie httpOnly mang thẻ này ⇒ các đường cần mở khoá (tải sách, xem kết quả, tải PDF)
 * kiểm thẻ ở MÁY CHỦ. Vì sao máy chủ kiểm chứ không dựa vào cờ ở trình duyệt: cờ ở trình duyệt chỉ là «lời hứa suông» — ai mở DevTools cũng
 * bật được; tệp sách ở R2 chỉ ký link cho người có thẻ hợp lệ.
 *
 * Thẻ KHÔNG mang SĐT/tên/lead (cookie không được chở dữ liệu cá nhân): chỉ `{ v, e: hết hạn (giây), n: nguồn lần đầu }` + HMAC-SHA256.
 * Đây là cổng MỀM (ai có thẻ thì tải được; cho phép chia sẻ link thẻ là rủi ro đã chấp nhận) — mục tiêu là thu lead, không phải DRM.
 * THUẦN: khoá và đồng hồ được TIÊM (test không đọc đồng hồ thật — luật 19).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_MO_KHOA = "sr_ctt";
/** 180 ngày: đủ lâu để «một lần» đúng nghĩa với phụ huynh quay lại đọc tiếp, đủ ngắn để không thành thẻ vĩnh viễn. */
export const TUOI_THE_MO_KHOA_GIAY = 180 * 24 * 3600;

type Noi = { v: 1; e: number; n: string };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const ky = (payloadB64: string, khoa: string) => createHmac("sha256", khoa).update(`ctt.v1.${payloadB64}`).digest();

export function kyTheMoKhoa(p: { nguon: string; bayGio: Date; khoa: string; tuoiGiay?: number }): string {
  const noi: Noi = { v: 1, e: Math.floor(p.bayGio.getTime() / 1000) + (p.tuoiGiay ?? TUOI_THE_MO_KHOA_GIAY), n: p.nguon.slice(0, 20) };
  const payload = b64(JSON.stringify(noi));
  return `${payload}.${b64(ky(payload, p.khoa))}`;
}

export type KetQuaThe = { ok: true; nguon: string; hetHanLuc: number } | { ok: false; lyDo: "THIEU" | "SAI_DANG" | "SAI_CHU_KY" | "HET_HAN" };

export function kiemTheMoKhoa(the: string | null | undefined, p: { bayGio: Date; khoa: string }): KetQuaThe {
  if (!the) return { ok: false, lyDo: "THIEU" };
  const phan = the.split(".");
  if (phan.length !== 2 || !phan[0] || !phan[1] || the.length > 400) return { ok: false, lyDo: "SAI_DANG" };
  const [payload, chuKy] = phan as [string, string];
  const mong = ky(payload, p.khoa);
  let co: Buffer;
  try {
    co = Buffer.from(chuKy, "base64url");
  } catch {
    return { ok: false, lyDo: "SAI_DANG" };
  }
  if (co.length !== mong.length || !timingSafeEqual(co, mong)) return { ok: false, lyDo: "SAI_CHU_KY" };
  let noi: Noi;
  try {
    noi = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Noi;
  } catch {
    return { ok: false, lyDo: "SAI_DANG" };
  }
  if (noi?.v !== 1 || typeof noi.e !== "number" || typeof noi.n !== "string") return { ok: false, lyDo: "SAI_DANG" };
  if (noi.e <= Math.floor(p.bayGio.getTime() / 1000)) return { ok: false, lyDo: "HET_HAN" };
  return { ok: true, nguon: noi.n, hetHanLuc: noi.e };
}
