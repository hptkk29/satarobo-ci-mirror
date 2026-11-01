// lib/events/_demo/ping-handlers.ts — A0-07: demo 2 handler cho type "demo.ping"
// (chứng minh nhiều handler + idempotent + allSettled). KHÔNG dùng ở nghiệp vụ thật.
import { on, type DomainEventLite } from "@/lib/events/registry";

/** Marker in-memory để test quan sát handler đã chạy. */
export const pingMarkers: string[] = [];
const processedA = new Set<string>();

export function resetPingDemo(): void {
  pingMarkers.length = 0;
  processedA.clear();
}

/** Handler A — idempotent theo event.id (chạy lại cùng event → hệ quả 1 lần). */
export async function handlerA(e: DomainEventLite): Promise<void> {
  if (processedA.has(e.id)) return;
  processedA.add(e.id);
  pingMarkers.push(`A:${String(e.payload.msg ?? "")}`);
}

/** Handler B — ghi marker (không idempotent, để minh hoạ). */
export async function handlerB(e: DomainEventLite): Promise<void> {
  pingMarkers.push(`B:${String(e.payload.msg ?? "")}`);
}

/** Handler luôn lỗi — minh hoạ retry/allSettled. */
export async function handlerAlwaysFail(): Promise<void> {
  throw new Error("demo handler luôn lỗi");
}

/** Đăng ký demo: thêm consumer = 1 dòng on() mỗi handler (AC5). */
export function registerPingDemo(): void {
  on("demo.ping", handlerA);
  on("demo.ping", handlerB);
}
