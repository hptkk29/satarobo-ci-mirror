import "server-only";
// lib/payments/pos/agent/khoa.ts — BÍ MẬT máy đồng bộ (GĐ4 POS, T2). Nơi DUY NHẤT đọc `POS_AGENT_MASTER_KEY`
// (lưới [POS4-W5]).
//
// Đo 07/10/2026: repo KHÔNG có helper mã hoá đối xứng (`createCipheriv` / `aes-256-gcm` = 0 dòng) ⇒ không
// lưu bí mật dạng mã hoá được. Phía server cần BÍ MẬT GỐC để kiểm HMAC (một "secretHash" không kiểm được
// chữ ký) ⇒ chọn DẪN XUẤT: `agentSecret = hex(HMAC-SHA256(master, agentId + ":" + secretVersion))`.
//  · DB lộ ⇒ không lộ bí mật (DB chỉ giữ `secretVersion`).
//  · "Tạo lại secret" = `secretVersion + 1` ⇒ khoá cũ chết NGAY, không phải xoá gì.
//  · Thiếu / ngắn env ⇒ `masterKeyCoSan() = false` ⇒ API agent 503 (fail-closed), màn ẩn nút tạo.
//  · Biết trước, không phải lỗ: ai có env + agentId (header, không bí mật) dẫn xuất được khoá ⇒ env là bí
//    mật cấp hệ thống như NEXTAUTH_SECRET. Lộ env ⇒ đổi env + "Tạo lại secret" mọi agent.
//
// ⚠️ KHÔNG log, KHÔNG đưa giá trị dẫn xuất vào AuditLog / sự kiện / URL (lưới [POS4-BM-01]).
import { createHmac } from "node:crypto";

/** Độ dài tối thiểu của master key — cùng ngưỡng `lib/security/signing-key.ts`. */
const DO_DAI_TOI_THIEU = 32;

function masterKey(): string | null {
  const v = process.env.POS_AGENT_MASTER_KEY;
  return typeof v === "string" && v.length >= DO_DAI_TOI_THIEU ? v : null;
}

/** Máy chủ đã đặt master key (≥ 32 ký tự) chưa. */
export function masterKeyCoSan(): boolean {
  return masterKey() !== null;
}

/**
 * Khoá HMAC của một agent = 64 ký tự hex thường. NÉM khi thiếu master key (không bao giờ ký bằng khoá
 * rỗng — cấy C10) hoặc version không phải số nguyên ≥ 1.
 */
export function daoKhoaAgent(agentId: string, secretVersion: number): string {
  const m = masterKey();
  if (m === null) throw new Error("POS_AGENT_MASTER_KEY chưa đặt hoặc ngắn hơn 32 ký tự");
  if (!Number.isInteger(secretVersion) || secretVersion < 1) throw new Error("secretVersion không hợp lệ");
  return createHmac("sha256", Buffer.from(m, "utf8")).update(Buffer.from(`${agentId}:${secretVersion}`, "utf8")).digest("hex");
}
