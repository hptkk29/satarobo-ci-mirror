/**
 * Ký request tới satarobo — HMAC-SHA256 ĐÚNG hợp đồng `docs/pos-agent-api.md` §3:
 *
 *   chuỗi ký = METHOD + "\n" + PATH + "\n" + TS + "\n" + NONCE + "\n" + hex(sha256(thân UTF-8))
 *   khoá     = các byte UTF-8 của chuỗi agentSecret 64 ký tự (KHÔNG hex-decode)
 *   chữ ký   = hex thường của HMAC-SHA256(khoá, UTF-8(chuỗi ký))
 *
 * Dùng WebCrypto (`crypto.subtle`) — chạy được trong service worker MV3 và trong Node của bộ
 * test. Test vector V1–V3 + hai đối chứng âm ở `test/ky.test.ts`.
 */

const enc = new TextEncoder();

export const SHA256_RONG = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const AGENT_ID_RE = /^[a-z0-9]{20,40}$/;
const BI_MAT_RE = /^[0-9a-f]{64}$/;
const TS_RE = /^[0-9]{13}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const DUONG_RE = /^\/[A-Za-z0-9/_.-]*$/;

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error("WebCrypto không khả dụng");
  return c.subtle;
}

export async function sha256Hex(s: string): Promise<string> {
  return hex(await subtle().digest("SHA-256", enc.encode(s)));
}

export async function hmacSha256Hex(khoa: string, thongDiep: string): Promise<string> {
  const k = await subtle().importKey("raw", enc.encode(khoa), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await subtle().sign("HMAC", k, enc.encode(thongDiep)));
}

export function dungChuoiKy(phuongThuc: string, duongDan: string, ts: string, nonce: string, bamThan: string): string {
  return `${phuongThuc}\n${duongDan}\n${ts}\n${nonce}\n${bamThan}`;
}

export interface HeaderKy {
  "X-Agent-Contract": "1";
  "X-Agent-Id": string;
  "X-Agent-Ts": string;
  "X-Agent-Nonce": string;
  "X-Agent-Sig": string;
}

export interface DauVaoKy {
  agentId: string;
  biMat: string;
  phuongThuc: "GET" | "POST";
  /** pathname đúng như gửi: bắt đầu "/", không host, không query, không "/" cuối. */
  duongDan: string;
  /** Chuỗi thân ĐÚNG như sẽ gửi ("" cho GET). */
  than: string;
  ts: string;
  nonce: string;
}

/** Trả bộ header đã ký. Đầu vào sai hợp đồng ⇒ NÉM (lỗi mã của extension, không gửi đi). */
export async function kyYeuCau(d: DauVaoKy): Promise<HeaderKy> {
  if (!AGENT_ID_RE.test(d.agentId)) throw new Error("agentId sai định dạng");
  if (!BI_MAT_RE.test(d.biMat)) throw new Error("agentSecret sai định dạng");
  if (d.phuongThuc !== "GET" && d.phuongThuc !== "POST") throw new Error("method không hỗ trợ");
  if (!DUONG_RE.test(d.duongDan) || (d.duongDan.length > 1 && d.duongDan.endsWith("/"))) {
    throw new Error("path sai hợp đồng (có query / '/' cuối / ký tự lạ)");
  }
  if (!TS_RE.test(d.ts)) throw new Error("X-Agent-Ts phải đúng 13 chữ số");
  if (!NONCE_RE.test(d.nonce)) throw new Error("X-Agent-Nonce sai định dạng");
  if (d.phuongThuc === "GET" && d.than !== "") throw new Error("GET phải có thân rỗng");
  const bam = d.than === "" ? SHA256_RONG : await sha256Hex(d.than);
  const sig = await hmacSha256Hex(d.biMat, dungChuoiKy(d.phuongThuc, d.duongDan, d.ts, d.nonce, bam));
  return {
    "X-Agent-Contract": "1",
    "X-Agent-Id": d.agentId,
    "X-Agent-Ts": d.ts,
    "X-Agent-Nonce": d.nonce,
    "X-Agent-Sig": sig,
  };
}

/** Nonce mới cho MỖI request: 16 byte ngẫu nhiên ⇒ 32 hex thường (hợp đồng §3.1). */
export function taoNonce(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
