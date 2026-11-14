// lib/ai-lead/ho-tro-yeu-cau-test.ts — DỰNG REQUEST CÓ KÝ cho test của cổng AI Lead (lát G). KHÔNG import từ mã chạy thật.
//
// Ký bằng đúng `ky.ts` (chuỗi ký + HMAC) nên một request dựng ở đây là request mà Agent THẬT sẽ gửi — test cho cổng ăn bằng thứ đường thật cho nó ăn (luật 9, CLAUDE.md).
import { NextRequest } from "next/server";
import { DUONG_DAN, HEADER, HOP_DONG, type TenEndpoint } from "./hop-dong";
import { bamThan, chuoiKy, kyChuoi } from "./ky";

export type TuyChonYeuCau = {
  endpoint: TenEndpoint;
  agentId: string;
  /** Khoá HMAC (64 hex) của agent. */
  khoa: string;
  /** Đối tượng (sẽ `JSON.stringify` compact) hoặc chuỗi thô (để gửi JSON hỏng / byte lạ). `undefined` = thân rỗng. */
  than?: unknown;
  ts?: string | number;
  nonce?: string;
  /** Query string KÈM dấu `?` (không ký). */
  query?: string;
  /** `null` = bỏ header. Mặc định `HOP_DONG`. */
  contract?: string | null;
  /** `null` = bỏ header. Mặc định `application/json` cho POST. */
  contentType?: string | null;
  /** Ghi đè/bổ sung header sau cùng; `null` = xoá. */
  header?: Record<string, string | null>;
  /** Ghi đè chữ ký (để sinh chữ ký sai). */
  sigGhiDe?: string;
  /** Ghi đè chuỗi dùng để KÝ phần thân (để sinh "thân gửi ≠ thân ký"). */
  thanDeKy?: string;
  method?: string;
};

let boDemNonce = 0;
export function nonceMoi(): string {
  boDemNonce += 1;
  return `nonce-test-${String(boDemNonce).padStart(10, "0")}-abcdef`;
}

export function chuoiThan(than: unknown): string {
  if (than === undefined) return "";
  return typeof than === "string" ? than : JSON.stringify(than);
}

export function taoYeuCauKy(x: TuyChonYeuCau): NextRequest {
  const method = x.method ?? (x.endpoint === "catalog" ? "GET" : "POST");
  const raw = chuoiThan(x.than);
  const ts = String(x.ts ?? Date.now());
  const nonce = x.nonce ?? nonceMoi();
  const baytKy = Buffer.from(x.thanDeKy ?? raw, "utf8");
  const chuoi = chuoiKy({ method, path: DUONG_DAN[x.endpoint], ts, nonce, bamThan: bamThan(baytKy) });
  const sig = x.sigGhiDe ?? kyChuoi(x.khoa, chuoi);

  const h = new Headers();
  if (x.contract !== null) h.set(HEADER.contract, x.contract ?? HOP_DONG);
  h.set(HEADER.agent, x.agentId);
  h.set(HEADER.ts, ts);
  h.set(HEADER.nonce, nonce);
  h.set(HEADER.sig, sig);
  if (method === "POST" && x.contentType !== null) h.set("content-type", x.contentType ?? "application/json");
  for (const [k, v] of Object.entries(x.header ?? {})) {
    if (v === null) h.delete(k);
    else h.set(k, v);
  }
  const url = `http://localhost:3000${DUONG_DAN[x.endpoint]}${x.query ?? ""}`;
  return new NextRequest(url, { method, headers: h, ...(raw === "" ? {} : { body: Buffer.from(raw, "utf8") }) });
}

/** Phản hồi → `{status, header (chữ thường), body}` để so sánh. */
export async function docPhanHoi(res: Response): Promise<{ status: number; header: Record<string, string>; body: unknown; thoRaw: string }> {
  const header: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    header[k.toLowerCase()] = v;
  });
  const thoRaw = await res.text();
  let body: unknown;
  try {
    body = thoRaw === "" ? null : JSON.parse(thoRaw);
  } catch {
    body = thoRaw;
  }
  return { status: res.status, header, body, thoRaw };
}
