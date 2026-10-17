import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// =============================================================================
// Cụm C6 — MISA AMIS sync (SKELETON). Bật/tắt qua IntegrationConfig. KHÔNG push
// API thật khi tắt hoặc thiếu credential. Mọi lần đều ghi IntegrationLog.
// =============================================================================

const PROVIDER = "MISA";

/** Có đủ credential MISA không (env). */
export function isMisaConfigured(): boolean {
  return Boolean(process.env.MISA_CLIENT_ID && process.env.MISA_CLIENT_SECRET && process.env.MISA_API_URL);
}

/** Gửi thật chỉ khi configured + MISA_LIVE=true (tránh push nhầm). */
export function isMisaLive(): boolean {
  return isMisaConfigured() && process.env.MISA_LIVE === "true";
}

/** Lấy/khởi tạo config bật-tắt (mặc định tắt). */
export async function getMisaConfig(): Promise<{ isEnabled: boolean }> {
  const cfg = await db.integrationConfig.findUnique({
    where: { provider: PROVIDER },
    select: { isEnabled: true },
  });
  return { isEnabled: cfg?.isEnabled ?? false };
}

export async function setMisaEnabled(isEnabled: boolean): Promise<void> {
  await db.integrationConfig.upsert({
    where: { provider: PROVIDER },
    update: { isEnabled },
    create: { provider: PROVIDER, isEnabled },
  });
}

export interface MisaSyncInput {
  action: string; // "PUSH_INVOICE", "PUSH_PAYMENT", ...
  payload: Record<string, unknown>;
}

export interface MisaSyncResult {
  ok: boolean;
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  logId: string;
}

/**
 * Đẩy dữ liệu sang MISA. Tắt config / thiếu credential → SKIPPED (không push, không lỗi).
 * Bật + có credential nhưng chưa live → mô phỏng SUCCESS (KHÔNG gọi API thật).
 */
export async function syncToMisa(input: MisaSyncInput): Promise<MisaSyncResult> {
  const req = (input.payload ?? {}) as Prisma.InputJsonValue;
  const { isEnabled } = await getMisaConfig();

  // 1) Tắt hoặc thiếu credential → SKIPPED.
  if (!isEnabled || !isMisaConfigured()) {
    const log = await db.integrationLog.create({
      data: {
        provider: PROVIDER,
        direction: "PUSH",
        action: input.action,
        status: "SKIPPED",
        requestPayload: req,
        errorMessage: !isEnabled ? "MISA sync đang tắt" : "Thiếu credential MISA",
      },
      select: { id: true },
    });
    return { ok: true, status: "SKIPPED", logId: log.id };
  }

  // 2) Bật + có credential nhưng chưa live → mô phỏng (không gọi API thật).
  if (!isMisaLive()) {
    const log = await db.integrationLog.create({
      data: {
        provider: PROVIDER,
        direction: "PUSH",
        action: input.action,
        status: "SUCCESS",
        requestPayload: req,
        responsePayload: { simulated: true } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { ok: true, status: "SUCCESS", logId: log.id };
  }

  // 3) Live: TODO tích hợp MISA AMIS thật khi go-live:
  //   POST {MISA_API_URL}/... với OAuth client credentials.
  // Hiện chưa có API thật → FAILED rõ ràng (không ném lỗi).
  const log = await db.integrationLog.create({
    data: {
      provider: PROVIDER,
      direction: "PUSH",
      action: input.action,
      status: "FAILED",
      requestPayload: req,
      errorMessage: "MISA_LIVE_NOT_IMPLEMENTED",
    },
    select: { id: true },
  });
  return { ok: false, status: "FAILED", logId: log.id };
}
