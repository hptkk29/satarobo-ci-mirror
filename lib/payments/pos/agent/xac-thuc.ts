import "server-only";
// lib/payments/pos/agent/xac-thuc.ts — XÁC THỰC một request của máy đồng bộ (GĐ4 POS) + vỏ phản hồi chung.
//
// Hợp đồng: docs/pos-agent-api.md §3.5 (thứ tự kiểm — mã lỗi nào ra trước). Thiết kế: docs/pos-gd4-thiet-ke.md §4.
// MỌI route `app/api/pos-agent/*` gọi `xacThucYeuCauAgent(` LÀ LỜI GỌI LIB ĐẦU TIÊN (lưới [POS4-W3]).
//
// BA ĐIỀU CỐ Ý, đừng "sửa":
//  1. So chữ ký bằng `safeEqual` (thời gian hằng) — KHÔNG `===` (lưới [POS4-W3]).
//  2. Agent KHÔNG tồn tại vẫn KÝ THỬ (khoá dẫn xuất từ chính id header) rồi mới trả — cùng mã, cùng câu
//     `BAD_SIGNATURE` với chữ ký sai: không lộ agent nào tồn tại qua mã lỗi hay thời gian phản hồi.
//  3. Nonce ghi SAU khi qua chữ ký + giờ + active + tần suất: request lạ không đẻ dòng (cấy C06). Khoá duy
//     nhất `(agentId, nonce)` là cái gác thật — đúng cả khi nhiều tiến trình. P2002 ⇒ NONCE_REUSED; lỗi DB
//     khác ⇒ INTERNAL (không nuốt thành "nonce lặp" — cấy C07).
import type { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api/response";
import { rateLimit } from "@/lib/rate-limit";
import { safeEqual } from "@/lib/security/safe-equal";
import { daoKhoaAgent, masterKeyCoSan } from "./khoa";
import { bamThan, chuoiKy, kiemDinhDangHeader, kiemLechGio, kyChuoi } from "./ky";
import { HOP_DONG, TRAN_REQ_PHUT } from "./hop-dong";
import { duongDanLoi } from "./schema";
import { chamSong } from "./phien";
import { CHON_AGENT, type AgentDaXacThuc } from "./agent-chon";

// Kiểu + câu chọn sống ở `agent-chon.ts` (tránh vòng import với `phien.ts`); xuất lại cho chỗ gọi cũ.
export { CHON_AGENT };
export type { AgentDaXacThuc };

/** Mã lỗi cả request — hợp đồng §7.1. `message` tiếng Việt, `code` tiếng Anh (Doc 15). */
const LOI = {
  NOT_CONFIGURED: { status: 503, message: "Máy chủ chưa đặt khoá máy đồng bộ — thử lại sau 5 phút." },
  UNSUPPORTED_CONTRACT: { status: 400, message: "Phiên bản hợp đồng không được hỗ trợ — cập nhật extension." },
  BAD_REQUEST: { status: 400, message: "Yêu cầu sai định dạng (header, query hoặc thân)." },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "Thân yêu cầu phải là application/json." },
  BODY_TOO_LARGE: { status: 413, message: "Thân yêu cầu vượt trần — chia lô." },
  BAD_SIGNATURE: { status: 401, message: "Chữ ký không hợp lệ hoặc bí mật đã đổi — dán bí mật mới." },
  CLOCK_SKEW: { status: 401, message: "Đồng hồ máy agent lệch quá 5 phút — chỉnh theo X-Server-Time." },
  AGENT_DISABLED: { status: 401, message: "Máy đồng bộ đã bị tắt trên satarobo." },
  RATE_LIMITED: { status: 429, message: "Gửi quá nhanh — chờ theo Retry-After." },
  NONCE_REUSED: { status: 401, message: "Nonce đã dùng — ký lại với nonce mới." },
  PAYLOAD_INVALID: { status: 400, message: "Dữ liệu không đúng hợp đồng." },
  TOO_MANY_ROWS: { status: 400, message: "Quá 200 dòng một lô — chia lô." },
  INTERNAL: { status: 500, message: "Lỗi máy chủ — thử lại theo nhịp thường." },
} as const satisfies Record<string, { status: number; message: string }>;

export type MaLoiAgent = keyof typeof LOI;

function dauPhanHoi(now: Date, them?: Record<string, string>): Record<string, string> {
  // Không header CORS: chỉ service worker của extension gọi (hợp đồng §0).
  return { "X-Server-Time": String(now.getTime()), "Cache-Control": "no-store", ...them };
}

export function phanHoiOk<T>(data: T, now: Date): NextResponse {
  return ok(data, { headers: dauPhanHoi(now) });
}

export function phanHoiLoi(code: MaLoiAgent, now: Date, opts?: { field?: string; retryAfterS?: number }): NextResponse {
  const l = LOI[code];
  return fail(code, l.message, {
    status: l.status,
    ...(opts?.field ? { field: opts.field } : {}),
    headers: dauPhanHoi(now, opts?.retryAfterS !== undefined ? { "Retry-After": String(opts.retryAfterS) } : undefined),
  });
}

/** Lỗi không lường trước ⇒ 500 có cấu trúc (không để framework trả HTML). */
export function loiMayChu(err: unknown, now: Date, noi: string): NextResponse {
  console.error(`[pos-agent:${noi}]`, err);
  return phanHoiLoi("INTERNAL", now);
}

function laJson(contentType: string | null): boolean {
  const loai = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return loai === "application/json";
}

/**
 * Đọc thân theo LUỒNG, dừng ngay khi vượt trần (khuôn `lib/calls/webhook.ts`). `content-length` chỉ để từ
 * chối SỚM; khai nhỏ mà gửi lớn vẫn bị chặn ở vòng đọc. Trả BYTE (chữ ký băm đúng byte đã gửi).
 */
async function docThanCoTran(req: NextRequest, tran: number): Promise<{ ok: true; than: Uint8Array } | { ok: false }> {
  const khai = req.headers.get("content-length");
  if (khai !== null && khai.trim() !== "") {
    const n = Number(khai);
    if (!Number.isFinite(n) || n > tran) return { ok: false };
  }
  if (!req.body) return { ok: true, than: new Uint8Array(0) };
  const reader = req.body.getReader();
  const manh: Uint8Array[] = [];
  let tong = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tong += value.byteLength;
    if (tong > tran) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    manh.push(value);
  }
  const than = new Uint8Array(tong);
  let o = 0;
  for (const m of manh) {
    than.set(m, o);
    o += m.byteLength;
  }
  return { ok: true, than };
}

function laTrungKhoa(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "P2002";
}

/**
 * Hợp đồng §3.5, đúng thứ tự: cấu hình → hợp đồng → query/header/kiểu thân → trần thân → agent + chữ ký →
 * lệch giờ → active → tần suất → nonce → chạm sống. `now` BẮT BUỘC (luật 19).
 */
export async function xacThucYeuCauAgent(
  req: NextRequest,
  x: { method: "GET" | "POST"; tranThan: number; now: Date },
): Promise<{ ok: true; agent: AgentDaXacThuc; than: Uint8Array } | { ok: false; res: NextResponse }> {
  const loi = (code: MaLoiAgent, o?: { field?: string; retryAfterS?: number }) => ({
    ok: false as const,
    res: phanHoiLoi(code, x.now, o),
  });
  try {
    // 1. Thiếu master key ⇒ fail-closed, KHÔNG chạm DB.
    if (!masterKeyCoSan()) return loi("NOT_CONFIGURED");
    // 2. Phiên bản hợp đồng.
    if (req.headers.get("x-agent-contract") !== HOP_DONG) return loi("UNSUPPORTED_CONTRACT");
    // 3. Query (không được ký) · bốn header · kiểu thân.
    if (req.nextUrl.search !== "") return loi("BAD_REQUEST", { field: "query" });
    const hd = kiemDinhDangHeader((ten) => req.headers.get(ten));
    if (!hd.ok) return loi("BAD_REQUEST", { field: hd.loi });
    if (x.method === "POST" && !laJson(req.headers.get("content-type"))) return loi("UNSUPPORTED_MEDIA_TYPE");
    // 4. Trần thân. GET phải rỗng.
    const doc = await docThanCoTran(req, x.method === "GET" ? 0 : x.tranThan);
    if (!doc.ok) return x.method === "GET" ? loi("BAD_REQUEST", { field: "body" }) : loi("BODY_TOO_LARGE");

    // 5. Agent + chữ ký — không tồn tại vẫn ký thử (cân thời gian), cùng mã lỗi.
    const agent = await db.posAgent.findUnique({ where: { id: hd.agentId }, select: CHON_AGENT });
    const chuoi = chuoiKy({ method: x.method, path: req.nextUrl.pathname, ts: hd.ts, nonce: hd.nonce, bamThan: bamThan(doc.than) });
    const mong = kyChuoi(daoKhoaAgent(hd.agentId, agent?.secretVersion ?? 1), chuoi);
    const khop = safeEqual(mong, hd.sig);
    if (!agent || !khop) return loi("BAD_SIGNATURE");

    // 6. Lệch giờ — biên 300 000 ms vẫn qua.
    if (!kiemLechGio(hd.tsMs, x.now.getTime())) return loi("CLOCK_SKEW");
    // 7. Agent tắt.
    if (!agent.active) return loi("AGENT_DISABLED");
    // 8. Tần suất / agent.
    const rl = await rateLimit({ key: `pos-agent:${agent.id}`, max: TRAN_REQ_PHUT, windowMs: 60_000 });
    if (!rl.success) {
      return loi("RATE_LIMITED", { retryAfterS: Math.max(1, Math.ceil((rl.resetAt - x.now.getTime()) / 1_000)) });
    }
    // 9. Nonce — SAU mọi cổng trên.
    try {
      await db.posAgentNonce.create({ data: { agentId: agent.id, nonce: hd.nonce, createdAt: x.now } });
    } catch (err) {
      if (laTrungKhoa(err)) return loi("NONCE_REUSED");
      throw err;
    }
    // 10. Còn sống (T4) — mọi request đã ký hợp lệ, kể cả request sau đó lỗi schema.
    await chamSong(agent, x.now);
    return { ok: true, agent, than: doc.than };
  } catch (err) {
    return { ok: false, res: loiMayChu(err, x.now, "xac-thuc") };
  }
}

/**
 * Thân (đã qua trần) ⇒ JSON (UTF-8 `fatal`) ⇒ Zod strict. `tienKiem` chạy TRƯỚC schema (vd TOO_MANY_ROWS:
 * lô quá dòng là "chia lô", không phải "sửa mã").
 */
export function docThanJson<S extends z.ZodType>(
  than: Uint8Array,
  schema: S,
  now: Date,
  tienKiem?: (v: unknown) => MaLoiAgent | null,
): { ok: true; data: z.output<S> } | { ok: false; res: NextResponse } {
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(than));
  } catch {
    return { ok: false, res: phanHoiLoi("BAD_REQUEST", now, { field: "body" }) };
  }
  const truoc = tienKiem?.(v) ?? null;
  if (truoc) return { ok: false, res: phanHoiLoi(truoc, now) };
  const r = schema.safeParse(v);
  if (!r.success) {
    const dau = r.error.issues[0] as { path: readonly PropertyKey[]; code?: string; keys?: readonly string[] } | undefined;
    return { ok: false, res: phanHoiLoi("PAYLOAD_INVALID", now, dau ? { field: duongDanLoi(dau) } : undefined) };
  }
  return { ok: true, data: r.data };
}
