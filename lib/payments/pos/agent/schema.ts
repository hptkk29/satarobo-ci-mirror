// lib/payments/pos/agent/schema.ts — THÂN request của hợp đồng POS Agent (GĐ4 POS). THUẦN (Zod).
//
// Hợp đồng: docs/pos-agent-api.md §4 + §6.1. Mọi object STRICT: khoá lạ ⇒ 400 PAYLOAD_INVALID kèm
// `error.field` = đường dẫn khoá (vd `transactions[3].sender_card_name`).
//
// ⚠️ Dòng giao dịch: schema CHỈ canh KIỂU + TẬP KHOÁ (whitelist §6.1 trừ `sender_card_name` và `device_id`
// — lưới [POS4-W7] so ĐÚNG tập). Thiếu trường / sai định dạng NGHIỆP VỤ (mã GD, giờ, tiền, merchant) và — từ bản
// sửa 1.1 — ĐỘ DÀI là việc của `chuanHoaDongAgent`: từ chối TỪNG DÒNG (API §7.2), không đánh rơi cả lô vì một dòng.
import { z } from "zod";
import { laThoiDiemCoMui } from "../kieu";
import { TRAN_DONG_LO } from "./hop-dong";

/**
 * ISO-8601 CÓ offset (`+07:00` hoặc `Z`) và là mốc có thật. Rà đối kháng bản gộp (RVG-04): "có thật" = so lại TỪNG thành
 * phần (`laThoiDiemCoMui`, V3 của GĐ3) — mã TRƯỚC hỏi `!isNaN(Date.parse(s))` mà V8 CUỘN "2026-02-30" sang 02/03 và
 * nhận "24:00" / offset "+25:00".
 */
export const isoCoOffset = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/, "Cần ISO-8601 có offset")
  .refine(laThoiDiemCoMui, "Mốc thời gian không có thật");

const MA_LY_DO = /^[A-Z][A-Z0-9_]{1,63}$/;

export const heartbeatSchema = z
  .object({
    extensionVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/),
    sessionState: z.enum(["READY", "EXPIRED", "UNKNOWN"]),
    sessionExpiresAt: isoCoOffset.nullable(),
    sessionExpiresSource: z.enum(["ACCESS_TOKEN", "SESSION"]).nullable().optional(),
    lastSyncedAt: isoCoOffset.nullable(),
    profileName: z.string().max(64).optional(),
  })
  .strict();
export type ThanHeartbeat = z.infer<typeof heartbeatSchema>;

export const statusSchema = z
  .object({
    state: z.enum(["SESSION_READY", "SESSION_EXPIRED", "ERROR"]),
    reason: z.string().regex(MA_LY_DO),
    occurredAt: isoCoOffset,
    profileName: z.string().max(64).optional(),
    sessionExpiresAt: isoCoOffset.nullable().optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
  })
  .strict();
export type ThanStatus = z.infer<typeof statusSchema>;

/**
 * Chốt hợp đồng 1.1 (07/10/2026 — RV5.4 #2): schema lô canh KIỂU + TẬP KHOÁ, KHÔNG canh độ dài. Trần độ dài là
 * luật DÒNG (`TRAN_DONG_AGENT` + `truongVuotTran` ⇒ `FIELD_TOO_LONG`). Mã TRƯỚC: `z.string().max(n)` ở đây ⇒ một
 * dòng dài là 400 CẢ LÔ — dòng tốt cùng lô cũng không vào sổ, agent gửi lại y hệt mỗi phút (ca [POS4-HD-02],
 * [POS4-HD-RT], [POS4-CHOT-01/02]). Thân lô vẫn bị chặn ở trần BYTE của route (`TRAN_THAN_LO`).
 */
const chuoi = z.string().nullable().optional();
const so = z.union([z.number(), z.string()]).nullable().optional();

/**
 * MỘT dòng `transactions[i]` — đúng các khoá API §6.1 (giữ tên portal). KHÔNG có `sender_card_name` (tên
 * chủ thẻ) và `device_id` (trùng tên `deviceId` của PHIÊN portal — D10, T10): gửi là 400 cả lô.
 */
export const dongAgentSchema = z
  .object({
    transaction_id: chuoi,
    transaction_type: chuoi,
    transaction_detail_status: chuoi,
    transaction_master_status: chuoi,
    order_description: chuoi,
    authorization_id: chuoi,
    card_transaction_id: chuoi,
    tcb_transaction_id: chuoi,
    order_amount: so,
    transaction_master_amount: so,
    transaction_detail_amount: so,
    fee: so,
    tax: so,
    currency: chuoi,
    transaction_time: chuoi,
    merchant_code: chuoi,
    store_code: chuoi,
    terminal_code: chuoi,
    payment_method: chuoi,
    service_type: chuoi,
    sender_card_number: chuoi,
    sender_card_type: chuoi,
    accounting_reference_id: chuoi,
    settlement_id: chuoi,
    merchant_order_id: chuoi,
    transaction_operation_msg: chuoi,
  })
  .strict();
export type DongAgentTho = z.infer<typeof dongAgentSchema>;

/** Tập khoá của một dòng — lưới [POS4-W7] so ĐÚNG tập này với hợp đồng. */
export const KHOA_DONG_AGENT: readonly string[] = Object.keys(dongAgentSchema.shape);

const GIO_VN_CUA_SO = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export const loGiaoDichSchema = z
  .object({
    syncId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    batchIndex: z.number().int().min(0).max(999),
    final: z.boolean(),
    windowFrom: z.string().regex(GIO_VN_CUA_SO),
    windowTo: z.string().regex(GIO_VN_CUA_SO),
    jobIds: z.array(z.string().regex(/^[a-z0-9]{20,40}$/)).max(50),
    transactions: z.array(dongAgentSchema).max(TRAN_DONG_LO),
  })
  .strict()
  .refine((v) => v.final || v.jobIds.length === 0, {
    path: ["jobIds"],
    message: "Lô final:false phải gửi jobIds rỗng",
  });
export type ThanLoGiaoDich = z.infer<typeof loGiaoDichSchema>;

/** Lô > 200 dòng ⇒ TOO_MANY_ROWS (mã riêng — agent phải CHIA LÔ, không phải sửa mã). Hỏi TRƯỚC schema. */
export function quaTranDong(than: unknown): boolean {
  if (typeof than !== "object" || than === null) return false;
  const ds = (than as { transactions?: unknown }).transactions;
  return Array.isArray(ds) && ds.length > TRAN_DONG_LO;
}

/** Đường dẫn khoá của một lỗi Zod: `transactions[3].sender_card_name` · `jobIds` · `accessToken`. */
export function duongDanLoi(issue: { path: readonly PropertyKey[]; code?: string; keys?: readonly string[] }): string {
  const phan = [...issue.path];
  if (issue.code === "unrecognized_keys" && issue.keys && issue.keys.length > 0) phan.push(issue.keys[0]!);
  let s = "";
  for (const p of phan) {
    if (typeof p === "number") s += `[${p}]`;
    else s += s === "" ? String(p) : `.${String(p)}`;
  }
  return s;
}
