import "server-only";
// lib/ai-lead/dich-vu/idempotency.ts — IDEMPOTENCY của cổng AI Lead (error-codes.md §3 bước 17; lead-intake-guide.md §7.4).
//
//  · Cùng (agent, key) + cùng nội dung ⇒ phát lại ĐÚNG phản hồi cũ (thân + meta giữ nguyên, kể cả receiptId/requestId) kèm `Idempotent-Replay: true`.
//  · Cùng key khác nội dung ⇒ 409 IDEMPOTENCY_CONFLICT.
//
// CƠ CHẾ TRANH CHẤP (20 yêu cầu song song cùng key ⇒ đúng 1 lần ghi):
//   câu ĐẦU TIÊN của giao dịch nghiệp vụ là `createMany({ skipDuplicates })` (= `INSERT … ON CONFLICT DO NOTHING`) vào AiLeadRequest với phản hồi tạm.
//   Kẻ đến sau CHẶN ở chỉ mục duy nhất tới khi kẻ thắng commit (phản hồi thật đã được ghi CÙNG giao dịch) hoặc rollback. Commit ⇒ INSERT báo 0 dòng ⇒ đọc lại và phát lại;
//   rollback ⇒ kẻ chờ trở thành kẻ thắng mới. Không có P2002 nào trong giao dịch (P2002 làm hỏng cả giao dịch Postgres — không bắt-và-đi-tiếp được).
//   Phản hồi tạm (status 0) KHÔNG BAO GIỜ thấy được từ ngoài: nó chỉ tồn tại trong giao dịch chưa commit.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { TenEndpoint } from "../hop-dong";

/** Thân phản hồi 200 đã dựng — chính thứ lưu và phát lại. */
export type ThanOk = { ok: true; data: unknown; meta: { requestId: string; serverTime: number } };

export function dungThanOk(ctx: { requestId: string; nowMs: number }, data: unknown): ThanOk {
  return { ok: true, data, meta: { requestId: ctx.requestId, serverTime: ctx.nowMs } };
}

/** JSON chuẩn hoá: khoá đối tượng sắp tăng dần (mảng giữ thứ tự) — hai thân khác khoảng trắng/thứ tự khoá vẫn là CÙNG nội dung. */
export function chuanHoaJson(v: unknown): string {
  const sap = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sap);
    if (x !== null && typeof x === "object") {
      return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sap((x as Record<string, unknown>)[k])]));
    }
    return x;
  };
  return JSON.stringify(sap(v));
}

/** SHA-256 hex của (endpoint + JSON chuẩn hoá của thân ĐÃ qua zod). */
export function bamNoiDung(endpoint: TenEndpoint, body: unknown): string {
  return createHash("sha256").update(`${endpoint}\n${chuanHoaJson(body)}`, "utf8").digest("hex");
}

/** Khoá + băm của yêu cầu, hoặc `null` với endpoint không có khoá (catalog · heartbeat). */
// Kiểu CẤU TRÚC (không import `NguCanhYeuCau` từ xac-thuc.ts): xac-thuc.ts đã import tệp này, import ngược là vòng — dependency-cruiser `no-circular` (error) đỏ ở CI (28/10/2026), kể cả `import type`.
export function khoaIdempotencyCua(ctx: { endpoint: TenEndpoint; body: unknown }): { key: string; hash: string } | null {
  const b = ctx.body as { idempotencyKey?: unknown } | null;
  if (!b || typeof b.idempotencyKey !== "string") return null;
  return { key: b.idempotencyKey, hash: bamNoiDung(ctx.endpoint, ctx.body) };
}

export type KetQuaTraCuu =
  | { loai: "moi" }
  | { loai: "phat-lai"; body: ThanOk }
  | { loai: "xung-dot" };

/**
 * Phản hồi lưu dưới dạng CHUỖI JSON bọc trong `{ r }`, không phải đối tượng JSON thẳng: cột `Json` của Postgres là `jsonb` và jsonb SẮP LẠI thứ tự khoá
 * (ngắn trước dài sau) — phát lại từ jsonb sẽ ra thân KHÁC thứ tự khoá so với bản gốc (đã đo ở [AIL-DT-01]). Lưu chuỗi ⇒ phát lại ĐÚNG từng byte như lần đầu.
 */
export function dongGoiThan(body: ThanOk): { r: string } {
  return { r: JSON.stringify(body) };
}
export function moGoiThan(luu: unknown): ThanOk {
  const r = (luu as { r?: unknown } | null)?.r;
  if (typeof r !== "string") throw new Error("AiLeadRequest: responseBody không đúng định dạng lưu");
  return JSON.parse(r) as ThanOk;
}

function docBangGhi(cu: { endpoint: string; requestHash: string; responseBody: unknown }, endpoint: string, hash: string): KetQuaTraCuu {
  if (cu.endpoint !== endpoint || cu.requestHash !== hash) return { loai: "xung-dot" };
  return { loai: "phat-lai", body: moGoiThan(cu.responseBody) };
}

/** Tra cứu NHANH ngoài giao dịch (đường phát lại phổ biến: agent gửi lại sau timeout). Không khoá gì — tranh chấp thật được giải ở `giuKhoaTrongTx`. */
export async function traCuuIdempotency(agentId: string, endpoint: TenEndpoint, key: string, hash: string): Promise<KetQuaTraCuu> {
  const cu = await db.aiLeadRequest.findUnique({
    where: { agentId_idempotencyKey: { agentId, idempotencyKey: key } },
    select: { endpoint: true, requestHash: true, responseStatus: true, responseBody: true },
  });
  // Dòng tạm (status 0) không thể thấy từ ngoài; nếu lỡ thấy thì coi như chưa có (an toàn: giao dịch kế sẽ giải bằng khoá chỉ mục).
  if (!cu || cu.responseStatus === 0) return { loai: "moi" };
  return docBangGhi(cu, endpoint, hash);
}

type Tx = Prisma.TransactionClient;

/**
 * CÂU ĐẦU TIÊN của giao dịch. `moi` ⇒ ta giữ khoá, được phép ghi; còn lại ⇒ DỪNG, KHÔNG ghi gì (trả kết quả ra ngoài giao dịch).
 */
export async function giuKhoaTrongTx(tx: Tx, x: { agentId: string; key: string; endpoint: TenEndpoint; hash: string }): Promise<KetQuaTraCuu> {
  const r = await tx.aiLeadRequest.createMany({
    data: [{ agentId: x.agentId, idempotencyKey: x.key, endpoint: x.endpoint, requestHash: x.hash, responseStatus: 0, responseBody: {} }],
    skipDuplicates: true,
  });
  if (r.count === 1) return { loai: "moi" };
  const cu = await tx.aiLeadRequest.findUnique({
    where: { agentId_idempotencyKey: { agentId: x.agentId, idempotencyKey: x.key } },
    select: { endpoint: true, requestHash: true, responseStatus: true, responseBody: true },
  });
  // Không thể xảy ra (vừa báo trùng mà không đọc thấy): ném để vỏ trả 500/503 thay vì ghi đôi.
  if (!cu || cu.responseStatus === 0) throw new Error("AiLeadRequest: báo trùng khoá nhưng không đọc thấy bản ghi");
  return docBangGhi(cu, x.endpoint, x.hash);
}

/** Ghi phản hồi thật vào dòng đã giữ — CÙNG giao dịch với phép ghi nghiệp vụ. */
export async function ghiPhanHoiTrongTx(tx: Tx, x: { agentId: string; key: string; status: number; body: ThanOk }): Promise<void> {
  const r = await tx.aiLeadRequest.updateMany({
    where: { agentId: x.agentId, idempotencyKey: x.key, responseStatus: 0 },
    data: { responseStatus: x.status, responseBody: dongGoiThan(x.body) },
  });
  // Dòng tạm mất ⇒ giao dịch lỗi (rollback) chứ không phải âm thầm không lưu phản hồi.
  if (r.count !== 1) throw new Error("AiLeadRequest: không ghi được phản hồi vào dòng đã giữ");
}

/** Lỗi báo cho vỏ giao dịch chạy LẠI cả giao dịch (xung đột lạc quan / khoá duy nhất). */
export class ChayLaiGiaoDich extends Error {
  constructor(readonly lyDo: string) {
    super("chay-lai");
    this.name = "ChayLaiGiaoDich";
  }
}

const TRAN_THU_LAI = 3;

function nenChayLai(err: unknown): boolean {
  if (err instanceof ChayLaiGiaoDich) return true;
  const code = (err as { code?: unknown } | null)?.code;
  // P2002 (khoá duy nhất — một giao dịch song song thắng) · P2034 (xung đột ghi/tuần tự): chạy lại TOÀN BỘ giao dịch, không "bắt rồi đi tiếp".
  return code === "P2002" || code === "P2034";
}

/** Chạy `fn` trong một giao dịch có trần thời gian; chạy lại tối đa 3 lượt khi gặp xung đột. */
export async function giaoDichCoThuLai<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let cuoi: unknown;
  for (let i = 0; i < TRAN_THU_LAI; i++) {
    try {
      return await db.$transaction(fn, { maxWait: 10_000, timeout: 20_000 });
    } catch (err) {
      cuoi = err;
      if (!nenChayLai(err)) throw err;
    }
  }
  throw cuoi;
}
