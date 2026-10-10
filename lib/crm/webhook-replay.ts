// lib/crm/webhook-replay.ts — R1-11: replay WebhookDelivery FAILED (OI-20).
// Re-xử lý payload đã lưu; idempotent (recordIncomingMessage dedupe theo mid) → không tạo trùng.
import type { WebhookDelivery } from "@prisma/client";
import { db } from "@/lib/db";
import { ingestMessengerEvents } from "@/lib/crm/meta-webhook";

export class ReplayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReplayError";
    this.code = code;
  }
}

export async function getFailedDeliveries(take = 100): Promise<WebhookDelivery[]> {
  return db.webhookDelivery.findMany({
    where: { status: "FAILED" },
    orderBy: { receivedAt: "desc" },
    take,
  });
}

/** Payload đã lưu là JSON tự do — về lại `Record<string,string>` để map lại. */
function asFormPayload(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}

/**
 * Replay phiếu form Sale bị chặn (honeypot dính hoặc map hỏng).
 *
 * Ca thật cần đến: ô bẫy bot bị trình quản lý mật khẩu tự điền ⇒ lead THẬT bị
 * vứt. Payload đã lưu nguyên nên dựng lại được — nhưng phải BỎ ô bẫy đi, không
 * thì replay lại rơi vào đúng cái bẫy cũ.
 */
async function replaySaleForm(payload: unknown): Promise<number> {
  const { mapSaleForm, SALE_FORM_HONEYPOT } = await import("@/lib/lead/intake/map-sale-form");
  const { ingestIntakeLead } = await import("@/lib/lead/intake/ingest");

  const fields = asFormPayload(payload);
  delete fields[SALE_FORM_HONEYPOT];

  const mapped = mapSaleForm(fields);
  if (!mapped.ok) throw new ReplayError("PAYLOAD_INVALID", mapped.error);

  const result = await ingestIntakeLead(mapped.lead, {
    source: "sale-form",
    actorName: "Hệ thống (gửi lại phiếu Sale)",
  });
  if (!result.ok) {
    throw new ReplayError("INGEST_FAILED", result.error ?? "Không tạo được lead.");
  }
  // Trùng SĐT thì không đẻ lead mới — vẫn coi là xử lý xong, không phải lỗi.
  return result.duplicate ? 0 : 1;
}

/** Replay 1 delivery: re-xử lý theo source. Idempotent (C11.2/C11.3). */
export async function replayDelivery(deliveryId: string): Promise<{ created: number }> {
  const d = await db.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!d) throw new ReplayError("DELIVERY_NOT_FOUND", "Không tìm thấy bản ghi webhook.");

  let created: number;
  switch (d.source) {
    case "facebook-messenger":
      created = await ingestMessengerEvents(d.payload);
      break;
    case "sale-form":
      created = await replaySaleForm(d.payload);
      break;
    // 29/08/2026 — hai nguồn "misa-mirror" / "misa-mirror-app" ĐÃ GỠ cùng luồng
    // MISA. Bản ghi CŨ trên PROD vẫn còn, và chúng rơi xuống nhánh mặc định bên
    // dưới: báo "chưa hỗ trợ replay" thay vì gửi lại vào một hệ đã ngừng dùng.
    // Cố ý KHÔNG xoá dữ liệu cũ — đó là vết của những phiếu từng hỏng.
    default:
      throw new ReplayError("SOURCE_UNSUPPORTED", `Chưa hỗ trợ replay source "${d.source}".`);
  }

  await db.webhookDelivery.update({
    where: { id: d.id },
    data: { status: "PROCESSED", processedAt: new Date(), retryCount: { increment: 1 }, errorMessage: null },
  });
  return { created };
}
