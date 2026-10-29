// lib/ai-lead/phan-hoi.ts — KHUNG phản hồi của cổng AI Lead (hợp đồng: `{ok,data,meta}` / `{ok:false,error}`).
//
// Đi qua `lib/api/response.ts` (lint `elearning/no-bare-next-response` áp cho `app/api/ai-lead-agent/**`): KHÔNG `NextResponse.json` trần.
// Khác khuôn POS: `meta` BẮT BUỘC có `{requestId, serverTime}` (YAML `Meta`), và `requestId` do Admin sinh ĐỘ DÀI CỐ ĐỊNH (P1).
//
// ⚠️ `requestId` / `receiptId` NGẪU NHIÊN, độ dài cố định, KHÔNG dẫn xuất từ SĐT/hồ sơ/hội thoại. Dẫn xuất ⇒ hai nhánh nghiệp vụ khác nhau có thể
// phân biệt được qua chuỗi này — phá nguyên tắc trung tính N1. Test [AIL-PH-02] ghim độ dài.
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { AN_TOAN_CUNG, MA_LOI, MA_LOI_CO_RETRY_AFTER, type MaLoi } from "./hop-dong";

function hexNgauNhien(doDai: number): string {
  // 2 ký tự hex / byte. Ký tự hex ⊂ [a-z0-9] của hợp đồng.
  return randomBytes(Math.ceil(doDai / 2)).toString("hex").slice(0, doDai);
}

/** `req_` + ĐÚNG 24 ký tự [0-9a-f]. */
export function taoRequestId(): string {
  return `req_${hexNgauNhien(AN_TOAN_CUNG.doDaiRequestId)}`;
}

/** `rct_` + ĐÚNG 24 ký tự [0-9a-f]. Biên nhận ĐỤC: không mang ý nghĩa nghiệp vụ. */
export function taoReceiptId(): string {
  return `rct_${hexNgauNhien(AN_TOAN_CUNG.doDaiReceiptId)}`;
}

export type NguCanhPhanHoi = {
  requestId: string;
  /** Giờ máy chủ (ms) — dùng cho `X-Server-Time` và `meta.serverTime`. TRUYỀN VÀO, không tự đọc đồng hồ (test đóng băng được). */
  nowMs: number;
};

/** Header có trên MỌI phản hồi (kể cả lỗi và 304): `X-Server-Time` + `Cache-Control: no-store`. */
export function dauChung(nowMs: number, them?: Record<string, string>): Record<string, string> {
  return { "X-Server-Time": String(nowMs), "Cache-Control": "no-store", ...them };
}

/** 200 thành công. `headers` thêm (ví dụ `Idempotent-Replay: true`) ghi đè header chung nếu trùng khoá. */
export function phanHoiOk<T>(data: T, ctx: NguCanhPhanHoi, headers?: Record<string, string>): NextResponse {
  return ok(data, {
    meta: { requestId: ctx.requestId, serverTime: ctx.nowMs },
    headers: dauChung(ctx.nowMs, headers),
  });
}

/**
 * Lỗi theo bảng 18 mã. `message` lấy từ `MA_LOI` — Agent KHÔNG parse nó, nhưng nó phải ổn định và KHÔNG phân biệt được "agent lạ" với "chữ ký sai".
 * `Retry-After` (số nguyên giây ≥ 1) LUÔN có với RATE_LIMITED / TEMP_UNAVAILABLE, và KHÔNG BAO GIỜ có với mã khác.
 */
export function phanHoiLoi(code: MaLoi, ctx: NguCanhPhanHoi, opts?: { field?: string; retryAfterS?: number }): NextResponse {
  const l = MA_LOI[code];
  const them = MA_LOI_CO_RETRY_AFTER.has(code)
    ? { "Retry-After": String(Math.max(1, Math.ceil(opts?.retryAfterS ?? 1))) }
    : undefined;
  return fail(code, l.message, {
    status: l.status,
    requestId: ctx.requestId,
    ...(opts?.field ? { field: opts.field } : {}),
    headers: dauChung(ctx.nowMs, them),
  });
}

/** `GET /catalog` 200: `ETag` + `Cache-Control: private, max-age=<maxAgeSeconds>` (hợp đồng cho phép khác `no-store` riêng ở đây). */
export function phanHoiCatalog<T>(data: T, ctx: NguCanhPhanHoi, x: { etag: string; maxAgeSeconds: number }): NextResponse {
  return ok(data, {
    meta: { requestId: ctx.requestId, serverTime: ctx.nowMs },
    headers: {
      "X-Server-Time": String(ctx.nowMs),
      "Cache-Control": `private, max-age=${x.maxAgeSeconds}`,
      ETag: x.etag,
    },
  });
}

/** `GET /catalog` 304 (thân rỗng) — vẫn mang `X-Server-Time` + Cache-Control. `new NextResponse` hợp lệ với lint (chỉ cấm `.json` trần). */
export function phanHoi304(nowMs: number, x: { etag: string; maxAgeSeconds: number }): NextResponse {
  return new NextResponse(null, {
    status: 304,
    headers: {
      "X-Server-Time": String(nowMs),
      "Cache-Control": `private, max-age=${x.maxAgeSeconds}`,
      ETag: x.etag,
    },
  });
}
