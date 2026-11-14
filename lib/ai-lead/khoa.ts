// lib/ai-lead/khoa.ts — BÍ MẬT của Agent AI Lead. Nơi DUY NHẤT đọc `process.env.AI_LEAD_AGENT_MASTER_KEY` (lưới [AIL-KH-W1]).
//
// Cùng mô hình với `lib/payments/pos/agent/khoa.ts` (T2): server cần BÍ MẬT GỐC để kiểm HMAC nên KHÔNG lưu băm; chọn DẪN XUẤT
//   agentSecret = hex(HMAC-SHA256(master, "ailead:<agentId>:<secretVersion>"))
//  · DB lộ ⇒ không lộ bí mật (DB chỉ giữ `secretVersion`). "Xoay khoá" = `secretVersion + 1` ⇒ khoá cũ chết NGAY (OD-05).
//  · Tiền tố "ailead:" tách miền: cùng master nhưng khác ngữ cảnh ⇒ khác khoá. Prod và test PHẢI dùng master KHÁC NHAU (xem .env.example).
//  · Thiếu / ngắn env ⇒ `daoKhoaAgent` trả null ⇒ route trả 503 NOT_CONFIGURED (fail-closed); KHÔNG BAO GIỜ ký bằng khoá rỗng.
//
// ⚠️ KHÔNG log, KHÔNG đưa giá trị dẫn xuất vào AuditLog / sự kiện / URL.
import { createHmac } from "node:crypto";
import { AN_TOAN_CUNG } from "./hop-dong";

/** Master key hợp lệ (≥ 32 ký tự) hoặc `null`. Đọc env MỖI LẦN gọi (test đổi env được; không cache). */
function layMaster(): string | null {
  const v = process.env.AI_LEAD_AGENT_MASTER_KEY;
  return typeof v === "string" && v.length >= AN_TOAN_CUNG.khoaGocToiThieuKyTu ? v : null;
}

/** Máy chủ đã đặt master key hợp lệ chưa. `false` ⇒ cổng máy trả 503 NOT_CONFIGURED. */
export function masterKeyCoSan(): boolean {
  return layMaster() !== null;
}

/** Chuỗi ngữ cảnh dẫn xuất. Xuất ra để test và để MỘT nơi quyết định định dạng. */
export function nguCanhDanXuat(agentId: string, secretVersion: number): string {
  return `ailead:${agentId}:${secretVersion}`;
}

/**
 * Khoá HMAC của một agent = 64 ký tự hex thường. Trả `null` khi THIẾU master key (route ⇒ 503) — KHÔNG ném, vì "chưa cấu hình" là trạng thái
 * bình thường phải xử lý bằng mã lỗi chứ không phải ngoại lệ. NÉM khi `secretVersion` không phải số nguyên ≥ 1 (lỗi lập trình, không phải cấu hình).
 */
export function daoKhoaAgent(agentId: string, secretVersion: number): string | null {
  if (!Number.isInteger(secretVersion) || secretVersion < 1) throw new Error("secretVersion không hợp lệ");
  const m = layMaster();
  if (m === null) return null;
  return createHmac("sha256", Buffer.from(m, "utf8")).update(Buffer.from(nguCanhDanXuat(agentId, secretVersion), "utf8")).digest("hex");
}

/**
 * Khoá GIẢ cho agent KHÔNG tồn tại (P1): vẫn tính HMAC để thời gian xử lý không phân biệt được "agent lạ" với "chữ ký sai". Dẫn xuất từ master
 * với miền riêng ⇒ không bao giờ trùng khoá thật; khi thiếu master vẫn trả một chuỗi cố định (đường đó đã bị chặn ở bước 1, đây chỉ là lưới an toàn).
 */
export function khoaGiaChoAgentLa(agentId: string): string {
  const m = layMaster() ?? "ailead-khoa-gia-khong-co-master-key-0000";
  return createHmac("sha256", Buffer.from(m, "utf8")).update(Buffer.from(`ailead:khong-ton-tai:${agentId}`, "utf8")).digest("hex");
}
