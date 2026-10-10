// lib/payments/pos/agent/hop-dong.ts — HẰNG của hợp đồng POS Agent ↔ satarobo (GĐ4 POS). THUẦN.
//
// Hợp đồng: docs/pos-agent-api.md (phiên bản 1, bản sửa 1.1). Thiết kế: docs/pos-gd4-thiet-ke.md §4.2 + phụ lục
// "CHỐT HỢP ĐỒNG".
// Đổi một hằng ở đây là đổi HỢP ĐỒNG với extension đã cài trên máy agent — đọc §9 của hợp đồng trước.

/** `X-Agent-Contract` — phiên bản hợp đồng. Khác ⇒ 400 UNSUPPORTED_CONTRACT. */
export const HOP_DONG = "1";

/** |giờ máy chủ − X-Agent-Ts| tối đa. ĐÚNG 300 000 vẫn qua (biên `>`). */
export const LECH_GIO_TOI_DA_MS = 300_000;
/** Giữ nonce 15′ (≥ 10′ của hợp đồng — xem `donNonceCu`). */
export const NONCE_GIU_MS = 15 * 60_000;

/** Trần thân heartbeat / status (byte UTF-8). */
export const TRAN_THAN_NHO = 4_096;
/** Trần thân transactions (byte UTF-8). */
export const TRAN_THAN_LO = 524_288;
/** Trần số dòng một lô transactions. */
export const TRAN_DONG_LO = 200;

/**
 * Chốt hợp đồng 1.1 (07/10/2026 — RV5.4 #1/#2): TRẦN ĐỘ DÀI từng trường một dòng `transactions[i]` (số ký tự =
 * `String.length` của chuỗi ĐÃ GỬI; trường số: trần áp cho DẠNG CHUỖI). Nguồn sự thật là cột "Trần · vượt" của bảng §6.1
 * hợp đồng — lưới [POS4-HD-01] so ĐÚNG bảng đó, extension GĐ5 so CÙNG bảng ([EXT-PL-08]).
 *
 * Vượt ⇒ từ chối DÒNG `FIELD_TOO_LONG` + `field` (`truongVuotTran`, `chuanHoaDongAgent`) — KHÔNG 400 cả lô (mã TRƯỚC:
 * `z.string().max(n)` trong `dongAgentSchema` ⇒ một dòng dài làm hỏng cả lô, agent gửi lại y hệt mỗi phút).
 * `transaction_id` = trần của định dạng `^[0-9A-Za-z]{8,64}$` (vượt ⇒ `BAD_TRANSACTION_ID`); `merchant_code` vượt ⇒
 * `MERCHANT_MISMATCH` (không bao giờ bằng merchant của agent) — hai mã đó kiểm TRƯỚC trần.
 */
export const TRAN_DONG_AGENT = {
  transaction_id: 64,
  transaction_type: 128,
  transaction_detail_status: 128,
  transaction_master_status: 128,
  order_description: 4_000,
  authorization_id: 64,
  card_transaction_id: 64,
  tcb_transaction_id: 64,
  order_amount: 32,
  transaction_master_amount: 32,
  transaction_detail_amount: 32,
  fee: 32,
  tax: 32,
  currency: 16,
  transaction_time: 40,
  merchant_code: 128,
  store_code: 128,
  terminal_code: 128,
  payment_method: 64,
  service_type: 64,
  sender_card_number: 64,
  sender_card_type: 64,
  accounting_reference_id: 128,
  settlement_id: 128,
  merchant_order_id: 128,
  transaction_operation_msg: 500,
} as const;

export type KhoaDongAgent = keyof typeof TRAN_DONG_AGENT;
/** Trần request / agent / 60 giây. */
export const TRAN_REQ_PHUT = 120;

/** Mất request hợp lệ quá chừng này ⇒ sale thấy "Tạm mất kết nối" (D9). Đúng 180 000 vẫn sẵn sàng. */
export const NGUONG_MAT_KET_NOI_MS = 3 * 60_000;
/** Mất quá chừng này (trong giờ hoạt động) ⇒ cron báo admin. */
export const NGUONG_BAO_MAT_KET_NOI_MS = 5 * 60_000;

/** Sale bấm Kiểm tra: chờ agent đồng bộ tối đa chừng này (NGOÀI transaction). */
export const CHO_JOB_TOI_DA_MS = 8_000;
/** Nhịp hỏi trạng thái job trong lúc chờ. */
export const NHIP_HOI_JOB_MS = 400;
/** Job PENDING sống chừng này; cũ hơn coi như hết hạn KHI ĐỌC, cron ghi EXPIRED. */
export const JOB_SONG_MS = 2 * 60_000;
/** Phiếu thu thẻ MỞ tạo trong chừng này ⇒ agent vào chế độ nhanh (T17). */
export const PHIEU_MO_GAN_MS = 10 * 60_000;

export const NEXT_POLL_NHANH = 2_000;
export const NEXT_POLL_CHAM = 60_000;

/** Ghi `lastHeartbeatAt` tối đa một lần / chừng này (T4). */
export const CHAM_SONG_TOI_THIEU_MS = 15_000;

/** Đường dẫn bốn endpoint — chuỗi ký dùng ĐÚNG pathname (không host, không query, không `/` cuối). */
export const DUONG_DAN = {
  heartbeat: "/api/pos-agent/heartbeat",
  status: "/api/pos-agent/status",
  jobs: "/api/pos-agent/jobs",
  transactions: "/api/pos-agent/transactions",
} as const;
