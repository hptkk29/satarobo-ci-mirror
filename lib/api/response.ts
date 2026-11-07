// API-09 — Contract response CHUẨN (Doc 15): success { ok, data, meta } · error
// { ok:false, error:{ code(EN), message(VI), field?, requestId } }. 1 nguồn để route
// MỚI dùng nhất quán; route cũ migrate DẦN (đổi shape = đổi behavior với caller/client
// → phải kiểm caller trước, không sweep mù). Dùng NextResponse.
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export type ApiMeta = Record<string, unknown>;

/** success chuẩn: { ok:true, data, meta? }. status mặc định 200. */
export function ok<T>(data: T, opts?: { meta?: ApiMeta; status?: number; headers?: HeadersInit }) {
  return NextResponse.json(
    { ok: true as const, data, ...(opts?.meta ? { meta: opts.meta } : {}) },
    { status: opts?.status ?? 200, headers: opts?.headers },
  );
}

/** error chuẩn: { ok:false, error:{ code, message, field?, requestId } }. status mặc định 400. */
export function fail(
  code: string,
  message: string,
  opts?: { status?: number; field?: string; requestId?: string; headers?: HeadersInit },
) {
  return NextResponse.json(
    {
      ok: false as const,
      error: {
        code,
        message,
        ...(opts?.field ? { field: opts.field } : {}),
        requestId: opts?.requestId ?? randomUUID(),
      },
    },
    { status: opts?.status ?? 400, headers: opts?.headers },
  );
}
