// lib/ai-lead/ky.ts — CHỮ KÝ HMAC của hợp đồng AI Lead. THUẦN: không env, không DB. FORK từ `lib/payments/pos/agent/ky.ts`
// (tham số hoá tên header + trần lệch giờ) — KHÔNG import tệp POS: nó nằm dưới luật R7 và lưới [POS4-W3]/[POS4-W5].
//
// Hợp đồng: authentication-guide.md + request-response-fixtures/hmac-vectors.json (V1–V3 + đối chứng âm NEG-1..4).
//
// HAI ĐIỀU CỐ Ý, đừng "sửa":
//  1. Khoá HMAC = các byte UTF-8 của chuỗi `agentSecret` (64 ký tự hex) — KHÔNG hex-decode thành 32 byte (NEG-1).
//  2. Chuỗi ký có ĐÚNG 4 dấu "\n", không "\n" sau phần cuối (NEG-2). `X-AiLead-Contract` và `Content-Type` KHÔNG ký.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { HEADER, HEADER_HIEN_THI, HOP_DONG, RE } from "./hop-dong";

/** SHA-256 hex thường của ĐÚNG các byte thân request. Thân rỗng ⇒ e3b0…b855. */
export function bamThan(than: Uint8Array): string {
  return createHash("sha256").update(than).digest("hex");
}

/** `METHOD\nPATH\nTS\nNONCE\nBODY_SHA256_HEX`. Không chuẩn hoá gì (ký đúng như gửi). */
export function chuoiKy(x: { method: string; path: string; ts: string; nonce: string; bamThan: string }): string {
  return `${x.method}\n${x.path}\n${x.ts}\n${x.nonce}\n${x.bamThan}`;
}

/** hex(HMAC-SHA256(UTF-8(khoa), UTF-8(chuoi))) — 64 ký tự hex thường. */
export function kyChuoi(khoa: string, chuoi: string): string {
  return createHmac("sha256", Buffer.from(khoa, "utf8")).update(Buffer.from(chuoi, "utf8")).digest("hex");
}

/**
 * |nowMs − tsMs| ≤ maxMs ⇒ qua. ĐÚNG maxMs vẫn qua (biên `>` mới lỗi). `maxMs` là THAM SỐ BẮT BUỘC (không mặc định): lệch giờ là tham số
 * vận hành `ai.clockSkewMs`, và một mặc định ở đây sẽ lặng lẽ bỏ qua cấu hình.
 */
export function kiemLechGio(tsMs: number, nowMs: number, maxMs: number): boolean {
  return Math.abs(nowMs - tsMs) <= maxMs;
}

/**
 * So chữ ký bằng THỜI GIAN HẰNG. Hai chuỗi khác độ dài ⇒ false (không ném). So trên chữ thường: `kiemDinhDangHeader` đã hạ chữ ký về chữ thường,
 * còn `kyChuoi` luôn ra chữ thường.
 */
export function soChuKy(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), "utf8");
  const y = Buffer.from(b.toLowerCase(), "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** Bước 2: `X-AiLead-Contract` đúng `1`. Vắng hoặc khác ⇒ false (UNSUPPORTED_CONTRACT — bước 2 đứng TRƯỚC kiểm định dạng ở bước 3). */
export function kiemHopDong(doc: (ten: string) => string | null): boolean {
  return doc(HEADER.contract) === HOP_DONG;
}

export type HeaderAgent = { ok: true; agentId: string; ts: string; tsMs: number; nonce: string; sig: string };

/**
 * Bước 3 (một phần): kiểm ĐỊNH DẠNG bốn header ký — chưa kiểm chữ ký. `doc(ten)` đọc header theo TÊN CHỮ THƯỜNG (`Headers.get`). Chữ ký được hạ
 * chữ thường trước khi trả. Lỗi trả tên header HIỂN THỊ (`X-AiLead-…`) để làm `error.field`/log — KHÔNG kèm giá trị (có thể là bí mật).
 */
export function kiemDinhDangHeader(doc: (ten: string) => string | null): HeaderAgent | { ok: false; loi: string } {
  const agentId = doc(HEADER.agent) ?? "";
  const ts = doc(HEADER.ts) ?? "";
  const nonce = doc(HEADER.nonce) ?? "";
  const sig = doc(HEADER.sig) ?? "";
  if (!RE.agentId.test(agentId)) return { ok: false, loi: HEADER_HIEN_THI.agent };
  if (!RE.ts.test(ts)) return { ok: false, loi: HEADER_HIEN_THI.ts };
  if (!RE.nonce.test(nonce)) return { ok: false, loi: HEADER_HIEN_THI.nonce };
  if (!RE.sig.test(sig)) return { ok: false, loi: HEADER_HIEN_THI.sig };
  return { ok: true, agentId, ts, tsMs: Number(ts), nonce, sig: sig.toLowerCase() };
}
