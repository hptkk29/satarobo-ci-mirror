/**
 * Payload giao dịch gửi satarobo — WHITELIST cứng theo hợp đồng `docs/pos-agent-api.md` §6.1.
 *
 * Luật (D10 + §6.3): CHỈ các khoá dưới, giá trị string | number | null đúng kiểu; KHÔNG
 * `sender_card_name`, KHÔNG `device_id` của dòng, KHÔNG BAO GIỜ header / cookie / token /
 * deviceId của phiên portal. Server strict (khoá lạ ⇒ 400 cả lô) nhưng extension KHÔNG dựa
 * vào server: tự lọc ở đây, và `timKhoaCam` là chốt chặn cuối ngay trước khi ký + gửi.
 *
 * Thứ tự khoá = thứ tự bảng §6.1 (test [EXT-PL-01] đọc chính bảng hợp đồng để so) ⇒ thân V3
 * của test vector dựng lại được ĐÚNG từng byte.
 */

export const KHOA_GIAO_DICH = [
  "transaction_id",
  "transaction_type",
  "transaction_detail_status",
  "transaction_master_status",
  "order_description",
  "authorization_id",
  "card_transaction_id",
  "tcb_transaction_id",
  "order_amount",
  "transaction_master_amount",
  "transaction_detail_amount",
  "fee",
  "tax",
  "currency",
  "transaction_time",
  "merchant_code",
  "store_code",
  "terminal_code",
  "payment_method",
  "service_type",
  "sender_card_number",
  "sender_card_type",
  "accounting_reference_id",
  "settlement_id",
  "merchant_order_id",
  "transaction_operation_msg",
] as const;

export type KhoaGiaoDich = (typeof KHOA_GIAO_DICH)[number];
export type GiaTriDong = string | number | null;
export type DongGiaoDich = { [K in KhoaGiaoDich]?: GiaTriDong };

/** Khoá CẤM ở MỌI độ sâu của mọi thân gửi satarobo (so chữ thường). */
export const KHOA_CAM: readonly string[] = [
  "sender_card_name",
  "device_id",
  "deviceid",
  "x-device-id",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "token",
  "x-api-auth",
  "x-api-payment",
  "authorization",
  "cookie",
  "set-cookie",
  "permissions",
  "user",
  "password",
  "matkhau",
];
const KHOA_CAM_SET = new Set(KHOA_CAM);

/** Cách làm vừa trần của một khoá: `cat` = giữ đúng N ký tự đầu · `null` = gửi `null`. */
export interface TranTruong {
  tran: number;
  qua: "cat" | "null";
}

/**
 * HỢP ĐỒNG 1.1 (chốt GĐ4 ↔ GĐ5, 07/10/2026) — trần độ dài từng khoá = ĐÚNG cột "Trần · vượt (agent)" bảng §6.1 của
 * `docs/pos-agent-api.md`; máy chủ GĐ4 dùng CÙNG cột (`TRAN_DONG_AGENT`). Lưới [EXT-PL-08] đọc thẳng bảng hợp đồng
 * và so cả 26 khoá (máy chủ: [POS4-HD-01]). Đổi một số ở đây mà không đổi hợp đồng ⇒ lưới đỏ.
 *
 *   · Trần = số ký tự `String.length` của chuỗi ĐÃ GỬI (sau trim); trường số: trần áp cho DẠNG CHUỖI — number JSON
 *     không có trần độ dài.
 *   · Vượt ⇒ `cat` = giữ đúng N ký tự đầu · `null` = gửi null. Máy chủ 1.1 từ chối DÒNG vượt trần (`FIELD_TOO_LONG`)
 *     — extension đúng hợp đồng KHÔNG BAO GIỜ gặp mã đó; gặp là extension lệch hợp đồng (báo `/status` một lần).
 *   · Bốn khoá BẮT BUỘC `cat` (null = máy chủ BỎ một phép kiểm — fail-open): hai trạng thái (null ⇒ trạng thái
 *     còn lại một mình quyết "Thành công") · `currency` (vắng ⇒ coi như VND) · `store_code` (vắng ⇒ không đối chiếu
 *     `maCuaHang`). Bản cắt dài N ≥ 16 ký tự nên không bao giờ trùng một giá trị hợp lệ ⇒ fail-closed.
 *   · Mã TRƯỚC 1.1 (RV5): chép tay theo `dongAgentSchema` 1.0 — 64 cho mọi mã, `null` cho cả hai trạng thái và
 *     `store_code` (fail-open), lệch máy chủ 1.1 ở 10 khoá.
 */
export const TRAN_GIAO_DICH: Readonly<Record<KhoaGiaoDich, TranTruong>> = {
  transaction_id: { tran: 64, qua: "null" },
  transaction_type: { tran: 128, qua: "null" },
  transaction_detail_status: { tran: 128, qua: "cat" },
  transaction_master_status: { tran: 128, qua: "cat" },
  order_description: { tran: 4000, qua: "cat" },
  authorization_id: { tran: 64, qua: "null" },
  card_transaction_id: { tran: 64, qua: "null" },
  tcb_transaction_id: { tran: 64, qua: "null" },
  order_amount: { tran: 32, qua: "null" },
  transaction_master_amount: { tran: 32, qua: "null" },
  transaction_detail_amount: { tran: 32, qua: "null" },
  fee: { tran: 32, qua: "null" },
  tax: { tran: 32, qua: "null" },
  currency: { tran: 16, qua: "cat" },
  transaction_time: { tran: 40, qua: "null" },
  merchant_code: { tran: 128, qua: "null" },
  store_code: { tran: 128, qua: "cat" },
  terminal_code: { tran: 128, qua: "null" },
  payment_method: { tran: 64, qua: "null" },
  service_type: { tran: 64, qua: "null" },
  sender_card_number: { tran: 64, qua: "null" },
  sender_card_type: { tran: 64, qua: "null" },
  accounting_reference_id: { tran: 128, qua: "null" },
  settlement_id: { tran: 128, qua: "null" },
  merchant_order_id: { tran: 128, qua: "null" },
  transaction_operation_msg: { tran: 500, qua: "cat" },
};

/** Kiểu giá trị của từng khoá (hợp đồng §6.1, cột "Kiểu"): chuỗi · số tiền nguyên VND · số (thuế). */
const LOAI: Readonly<Record<KhoaGiaoDich, "chuoi" | "tien" | "so">> = {
  transaction_id: "chuoi",
  transaction_type: "chuoi",
  transaction_detail_status: "chuoi",
  transaction_master_status: "chuoi",
  order_description: "chuoi",
  authorization_id: "chuoi",
  card_transaction_id: "chuoi",
  tcb_transaction_id: "chuoi",
  order_amount: "tien",
  transaction_master_amount: "tien",
  transaction_detail_amount: "tien",
  fee: "tien",
  tax: "so",
  currency: "chuoi",
  transaction_time: "chuoi",
  merchant_code: "chuoi",
  store_code: "chuoi",
  terminal_code: "chuoi",
  payment_method: "chuoi",
  service_type: "chuoi",
  sender_card_number: "chuoi",
  sender_card_type: "chuoi",
  accounting_reference_id: "chuoi",
  settlement_id: "chuoi",
  merchant_order_id: "chuoi",
  transaction_operation_msg: "chuoi",
};

/** Số tiền: number nguyên hữu hạn, hoặc chuỗi chữ số (chấp nhận đuôi ".0") — §6.1. */
const TIEN_CHUOI = /^-?\d{1,15}(?:\.0+)?$/;
const SO_CHUOI = /^-?\d{1,15}(?:\.\d{1,6})?$/;

function chuanHoaGiaTri(k: KhoaGiaoDich, v: unknown): GiaTriDong {
  if (v === null || v === undefined) return null;
  const { tran, qua } = TRAN_GIAO_DICH[k];
  const loai = LOAI[k];
  if (loai === "tien" || loai === "so") {
    const re = loai === "tien" ? TIEN_CHUOI : SO_CHUOI;
    if (typeof v === "number") return Number.isFinite(v) ? v : null; // number JSON: không có trần độ dài
    if (typeof v === "string") {
      const s = v.trim();
      if (!re.test(s)) return null;
      if (s.length <= tran) return s;
      // "6732000.000…" dài: bỏ đuôi ".0…" — CÙNG giá trị, dưới trần (chuẩn hoá như trim, TRƯỚC khi đo).
      // Không còn dưới trần ⇒ null. KHÔNG BAO GIỜ cắt chữ số (cắt = đổi số tiền).
      const gon = s.replace(/\.0+$/, "");
      return gon.length <= tran ? gon : null;
    }
    return null;
  }
  let s: string;
  if (typeof v === "string") s = v.trim();
  else if (typeof v === "number" && Number.isFinite(v)) s = String(v);
  else return null; // boolean / object / mảng: KHÔNG gửi cấu trúc lồng
  if (s === "") return null;
  if (s.length > tran) return qua === "cat" ? s.slice(0, tran) : null;
  if (k === "sender_card_number") return cheSoThe(s);
  return s;
}

/**
 * Che số thẻ: portal ĐÃ che (6 đầu + 4 cuối ⇒ 10 chữ số thấy được) thì giữ nguyên; lỡ trả số
 * ĐẦY ĐỦ (> 10 chữ số) thì che lại trước khi rời máy agent.
 */
export function cheSoThe(s: string): string {
  const so = s.replace(/\D/g, "");
  if (so.length <= 10) return s;
  return `${so.slice(0, 6)}******${so.slice(-4)}`;
}

/** Một dòng portal ⇒ dòng hợp đồng §6.1 (chỉ khoá whitelist có mặt ở nguồn). Không phải object ⇒ null. */
export function chuanHoaGiaoDich(row: unknown): DongGiaoDich | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const nguon = row as Record<string, unknown>;
  const ra: DongGiaoDich = {};
  for (const k of KHOA_GIAO_DICH) {
    if (!Object.prototype.hasOwnProperty.call(nguon, k) || nguon[k] === undefined) continue;
    ra[k] = chuanHoaGiaTri(k, nguon[k]);
  }
  return ra;
}

/** Đường dẫn của khoá CẤM đầu tiên ở bất kỳ độ sâu nào (không phân biệt hoa thường); không có ⇒ null. */
export function timKhoaCam(v: unknown, duong = ""): string | null {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = timKhoaCam(v[i], `${duong}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  if (v && typeof v === "object") {
    for (const [k, con] of Object.entries(v as Record<string, unknown>)) {
      const day = duong ? `${duong}.${k}` : k;
      if (KHOA_CAM_SET.has(k.toLowerCase())) return day;
      const r = timKhoaCam(con, day);
      if (r) return r;
    }
  }
  return null;
}
