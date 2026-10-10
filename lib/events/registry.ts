// lib/events/registry.ts — A0-07: đăng ký handler theo type (Doc 15 §4.5).
// Thêm consumer = 1 dòng on(type, handler). Nhiều handler/1 type. THUẦN (test được).

export type DomainEventLite = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};
export type EventHandler = (event: DomainEventLite) => Promise<void>;

const handlers = new Map<string, EventHandler[]>();

/** Đăng ký 1 handler cho type. */
export function on(type: string, handler: EventHandler): void {
  const list = handlers.get(type);
  if (list) list.push(handler);
  else handlers.set(type, [handler]);
}

export function getHandlers(type: string): EventHandler[] {
  return handlers.get(type) ?? [];
}

/** Chỉ dùng trong test — xoá toàn bộ handler đã đăng ký. */
export function clearHandlers(): void {
  handlers.clear();
}

/** Quyết định trạng thái sau khi chạy handlers (THUẦN, test được). */
export function decideOutcome(input: {
  anyFailed: boolean;
  attempts: number;
  maxAttempts: number;
}): "DONE" | "PENDING" | "FAILED" {
  if (!input.anyFailed) return "DONE";
  return input.attempts >= input.maxAttempts ? "FAILED" : "PENDING";
}
