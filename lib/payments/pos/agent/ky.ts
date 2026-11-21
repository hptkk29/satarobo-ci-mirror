// lib/payments/pos/agent/ky.ts — CHỮ KÝ HMAC của hợp đồng POS Agent (GĐ4 POS). THUẦN: không env, không DB.
//
// Hợp đồng: docs/pos-agent-api.md §3 (chốt, có test vector V1–V3 — `tests/fixtures/pos/agent-hmac-vectors.json`).
// Extension GĐ5 ký bằng WebCrypto; tệp này dùng `node:crypto` — hai bên PHẢI ra cùng chữ ký (ca [POS4-KY-01]).
//
// HAI ĐIỀU CỐ Ý, đừng "sửa":
//  1. Khoá HMAC = các byte UTF-8 của chuỗi `agentSecret` (64 ký tự hex) — KHÔNG hex-decode thành 32 byte (T3).
//     Hex-decode cho chữ ký `603836a5…` thay vì `de599aaf…` của V1 (đối chứng âm [POS4-KY-03]).
//  2. Chuỗi ký có ĐÚNG 4 dấu "\n", không "\n" sau phần cuối. `X-Agent-Contract` và `Content-Type` KHÔNG ký.
import { createHash, createHmac } from "node:crypto";
import { LECH_GIO_TOI_DA_MS } from "./hop-dong";

/** SHA-256 hex thường của ĐÚNG các byte thân request. Thân rỗng ⇒ e3b0…b855. */
export function bamThan(than: Uint8Array): string {
  return createHash("sha256").update(than).digest("hex");
}

/** `METHOD\nPATH\nTS\nNONCE\nBODY_SHA256_HEX` — hợp đồng §3.2. Không chuẩn hoá gì (ký đúng như gửi). */
export function chuoiKy(x: { method: string; path: string; ts: string; nonce: string; bamThan: string }): string {
  return `${x.method}\n${x.path}\n${x.ts}\n${x.nonce}\n${x.bamThan}`;
}

/** hex(HMAC-SHA256(UTF-8(khoa), UTF-8(chuoi))) — 64 ký tự hex thường. */
export function kyChuoi(khoa: string, chuoi: string): string {
  return createHmac("sha256", Buffer.from(khoa, "utf8")).update(Buffer.from(chuoi, "utf8")).digest("hex");
}

/** |nowMs − tsMs| ≤ 300 000 ⇒ qua. ĐÚNG 300 000 vẫn qua (hợp đồng §3.5 bước 6). */
export function kiemLechGio(tsMs: number, nowMs: number): boolean {
  return Math.abs(nowMs - tsMs) <= LECH_GIO_TOI_DA_MS;
}

const RE_ID = /^[a-z0-9]{20,40}$/;
const RE_TS = /^[0-9]{13}$/;
const RE_NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const RE_SIG = /^[0-9a-fA-F]{64}$/;

export type HeaderAgent = { ok: true; agentId: string; ts: string; tsMs: number; nonce: string; sig: string };

/**
 * Kiểm ĐỊNH DẠNG bốn header của hợp đồng §3.1 — chưa kiểm chữ ký. `doc(ten)` đọc header (không phân biệt
 * hoa thường — `Headers.get`). Chữ ký được hạ chữ thường trước khi trả (server so bằng chữ thường).
 */
export function kiemDinhDangHeader(doc: (ten: string) => string | null): HeaderAgent | { ok: false; loi: string } {
  const agentId = doc("x-agent-id") ?? "";
  const ts = doc("x-agent-ts") ?? "";
  const nonce = doc("x-agent-nonce") ?? "";
  const sig = doc("x-agent-sig") ?? "";
  if (!RE_ID.test(agentId)) return { ok: false, loi: "X-Agent-Id" };
  if (!RE_TS.test(ts)) return { ok: false, loi: "X-Agent-Ts" };
  if (!RE_NONCE.test(nonce)) return { ok: false, loi: "X-Agent-Nonce" };
  if (!RE_SIG.test(sig)) return { ok: false, loi: "X-Agent-Sig" };
  return { ok: true, agentId, ts, tsMs: Number(ts), nonce, sig: sig.toLowerCase() };
}
