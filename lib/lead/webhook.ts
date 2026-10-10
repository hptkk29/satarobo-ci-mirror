import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import type { WebhookStatus } from "@prisma/client";
import { ingestLead } from "./ingest";
import { rateLimit } from "@/lib/rate-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";

// =============================================================================
// WEBHOOK INGEST HELPERS — Phase T1.4
// Xác thực shared-secret + ghi log WebhookDelivery. Dùng chung cho 3 nguồn:
// facebook / zalo / google-form.
//
// BẢO MẬT: mỗi nguồn dùng 1 secret riêng trong env (WEBHOOK_<SOURCE>_SECRET).
// - Nếu secret đã set → request PHẢI gửi đúng token qua header `x-webhook-secret`
//   hoặc query `?secret=...`, so sánh timing-safe.
// - Nếu secret CHƯA set (stub/dev) → cho qua nhưng log cảnh báo. KHÔNG để trống
//   secret trên production.
// =============================================================================

const SECRET_ENV: Record<string, string> = {
  facebook: "WEBHOOK_FACEBOOK_SECRET",
  zalo: "WEBHOOK_ZALO_SECRET",
  "google-form": "WEBHOOK_GOOGLE_FORM_SECRET",
  quatang: "WEBHOOK_QUATANG_SECRET",
};

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Xác thực request webhook theo shared-secret của nguồn.
 * Trả về { ok } — ok=false khi secret đã cấu hình nhưng token không khớp.
 */
export function verifyWebhookSecret(
  source: string,
  req: Request,
): { ok: boolean; reason?: string } {
  const envKey = SECRET_ENV[source];
  const expected = envKey ? process.env[envKey] : undefined;

  if (!expected) {
    // Fail-CLOSED trên production: thiếu secret = từ chối (caller trả 503 —
    // server cấu hình sai, KHÔNG tạo record). Dev/test giữ stub pass-through.
    if (process.env.NODE_ENV === "production") {
      console.error(
        `[webhook:${source}] THIẾU ${envKey ?? "secret"} trên production — TỪ CHỐI request (fail-closed).`,
      );
      return { ok: false, reason: "missing-secret" };
    }
    console.warn(
      `[webhook:${source}] CHƯA cấu hình ${envKey ?? "secret"} — đang chạy chế độ stub (không xác thực). Đặt secret trước khi go-live.`,
    );
    return { ok: true };
  }

  const url = new URL(req.url);
  const provided =
    req.headers.get("x-webhook-secret") ??
    url.searchParams.get("secret") ??
    "";

  return { ok: provided.length > 0 && safeEqual(provided, expected) };
}

// Nguồn webhook ký payload bằng HMAC App Secret (chuẩn Meta X-Hub-Signature-256).
const META_SIGNATURE_SOURCES = new Set(["facebook"]);

/**
 * Xác minh chữ ký `X-Hub-Signature-256` của Meta (Facebook Lead Ads / Messenger).
 * Meta gửi header `sha256=<hex>` = HMAC-SHA256(rawBody, APP_SECRET).
 *
 * - Chỉ áp dụng cho nguồn Meta (facebook); nguồn khác bỏ qua (ok).
 * - `META_APP_SECRET` CHƯA set → chế độ stub (cảnh báo + ok), để dev/test
 *   chạy được mà chưa cần secret thật. PHẢI set trước go-live webhook Meta.
 * - Đã set → bắt buộc header đúng, so sánh timing-safe. Sai/thiếu → từ chối.
 *
 * `rawBody` PHẢI là chuỗi body GỐC (chưa qua JSON.parse rồi stringify lại) — vì
 * HMAC tính trên byte gốc; reformat sẽ làm lệch chữ ký.
 */
export function verifyMetaSignature(
  source: string,
  rawBody: string,
  signatureHeader: string | null,
): { ok: boolean; reason?: string } {
  if (!META_SIGNATURE_SOURCES.has(source)) return { ok: true };

  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    // Fail-CLOSED trên production: thiếu Meta App Secret = từ chối (không bỏ qua
    // verify). Dev/test giữ stub pass-through để chạy local.
    if (process.env.NODE_ENV === "production") {
      console.error(
        `[webhook:${source}] THIẾU META_APP_SECRET trên production — TỪ CHỐI request (fail-closed).`,
      );
      return { ok: false, reason: "missing-secret" };
    }
    console.warn(
      `[webhook:${source}] CHƯA cấu hình META_APP_SECRET — bỏ qua verify X-Hub-Signature-256 (stub). Đặt Meta App Secret thật trước go-live.`,
    );
    return { ok: true };
  }

  if (!signatureHeader) return { ok: false, reason: "missing-signature" };
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeEqual(signatureHeader, expected)
    ? { ok: true }
    : { ok: false, reason: "signature-mismatch" };
}

/** Ghi 1 dòng WebhookDelivery (status mặc định RECEIVED). Trả về id. */
export async function logWebhookDelivery(input: {
  source: string;
  externalId?: string | null;
  payload: unknown;
  status?: WebhookStatus;
  errorMessage?: string | null;
}): Promise<string> {
  const row = await db.webhookDelivery.create({
    data: {
      source: input.source,
      externalId: input.externalId ?? null,
      payload: (input.payload ?? {}) as object,
      status: input.status ?? "RECEIVED",
      errorMessage: input.errorMessage ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/** Cập nhật trạng thái xử lý của 1 WebhookDelivery. */
export async function markWebhookDelivery(
  id: string,
  status: WebhookStatus,
  errorMessage?: string | null,
): Promise<void> {
  await db.webhookDelivery.update({
    where: { id },
    data: {
      status,
      errorMessage: errorMessage ?? null,
      processedAt: status === "PROCESSED" ? new Date() : undefined,
    },
  });
}

// ─── Field extraction ────────────────────────────────────────────────────────

export type ExtractedLead = {
  parentName: string;
  phone: string;
  email?: string | null;
  childName?: string | null;
  note?: string | null;
  externalId?: string | null;
};

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

/** Đọc field từ mảng {name,values}/{name,value} kiểu Facebook Lead Ads. */
function fromFieldData(payload: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const fd = payload.field_data;
  if (!Array.isArray(fd)) return out;
  for (const f of fd) {
    if (!f || typeof f !== "object") continue;
    const name = str((f as Record<string, unknown>).name);
    const raw = (f as Record<string, unknown>).values ?? (f as Record<string, unknown>).value;
    const value = Array.isArray(raw) ? str(raw[0]) : str(raw);
    if (name && value) out[name.toLowerCase()] = value;
  }
  return out;
}

/**
 * Trích các field lead từ payload nhiều dạng (flat hoặc field_data).
 * Hỗ trợ alias key tiếng Việt + tiếng Anh phổ biến. Trả về null nếu thiếu
 * parentName/phone.
 */
export function extractLeadFields(payload: unknown): ExtractedLead | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const fd = fromFieldData(p);

  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = str(p[k]) ?? fd[k.toLowerCase()];
      if (v) return v;
    }
    return undefined;
  };

  const parentName = pick(
    "parentName",
    "full_name",
    "fullName",
    "name",
    "ho_ten",
    "hoTen",
    "ten_phu_huynh",
  );
  const phone = pick(
    "phone",
    "phone_number",
    "phoneNumber",
    "so_dien_thoai",
    "sdt",
    "tel",
  );
  if (!parentName || !phone) return null;

  return {
    parentName,
    phone,
    email: pick("email", "e_mail") ?? null,
    childName: pick("childName", "child_name", "ten_con", "tenCon") ?? null,
    note: pick("note", "message", "noi_dung", "ghi_chu") ?? null,
    externalId: pick("eventId", "event_id", "leadgen_id", "id", "external_id") ?? null,
  };
}

// ─── Shared POST handler ───────────────────────────────────────────────────────

export type WebhookResult = { httpStatus: number; body: Record<string, unknown> };

/**
 * Bộ xử lý riêng của một nguồn, cắm vào thay cho `extractLeadFields` mặc định.
 *
 * Có mặt vì nguồn mới (quatang) mang nhiều trường hơn hẳn bộ chung: con + trường
 * + lớp + cơ sở + mã NV giới thiệu. Nhét hết vào `extractLeadFields` sẽ làm phình
 * hàm dùng chung của 3 nguồn đang chạy; tách adapter thì mỗi nguồn tự lo phần
 * riêng mà đường ống (rate limit → secret → log → mark) vẫn dùng chung một chỗ.
 */
export type LeadWebhookAdapter = {
  /** Khoá idempotency đọc từ payload — ghi vào `WebhookDelivery.externalId`. */
  externalId?: (payload: unknown) => string | null;
  handle: (payload: unknown) => Promise<{
    ok: boolean;
    leadId?: string;
    duplicate?: boolean;
    error?: string;
  }>;
};

/**
 * Pipeline chung cho 1 POST webhook: verify secret → log delivery → extract →
 * ingestLead → cập nhật status delivery. Trả về 200 cho cả case parse-fail/
 * duplicate (tránh provider retry bão hoà); chỉ 401 khi sai secret.
 *
 * `adapter` bỏ trống ⇒ giữ nguyên đường cũ của 3 nguồn facebook/zalo/google-form.
 */
export async function processLeadWebhook(
  source: string,
  req: Request,
  adapter?: LeadWebhookAdapter,
): Promise<WebhookResult> {
  // SEC-M04: rate-limit theo source+IP TRƯỚC mọi xử lý (chống flood Lead/WebhookDelivery/
  // LeadActivity + consent forgery). fail-soft (Upstash→memory). 60 POST/phút/IP rất rộng
  // so với webhook thật (vài lead/phút, mỗi POST có thể gộp nhiều lead).
  // IP qua luật dùng chung (28/09/2026) — bản cũ lấy phần tử ĐẦU của XFF, tức phần khách viết.
  const ip = ipChoRateLimit(req.headers);
  const rl = await rateLimit({ key: `webhook:${source}:${ip}`, max: 60, windowMs: 60_000 });
  if (!rl.success) {
    return { httpStatus: 429, body: { ok: false, error: "Quá nhiều request — thử lại sau" } };
  }
  // SEC-M04: cap body size (chống payload khổng lồ) — check Content-Length trước khi đọc.
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > 100_000) {
    return { httpStatus: 413, body: { ok: false, error: "Payload quá lớn" } };
  }

  // AC3: thiếu secret trên production → 503 (server misconfig, không tạo record);
  // token sai → 401 (request không hợp lệ).
  const secretCheck = verifyWebhookSecret(source, req);
  if (!secretCheck.ok) {
    return secretCheck.reason === "missing-secret"
      ? { httpStatus: 503, body: { ok: false, error: "Webhook chưa cấu hình secret" } }
      : { httpStatus: 401, body: { ok: false, error: "Unauthorized" } };
  }

  // Đọc raw body 1 lần — cần cho HMAC verify (chữ ký tính trên byte gốc).
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    raw = "";
  }

  const sig = verifyMetaSignature(source, raw, req.headers.get("x-hub-signature-256"));
  if (!sig.ok) {
    console.warn(`[webhook:${source}] X-Hub-Signature-256 không hợp lệ: ${sig.reason}`);
    // Thiếu META_APP_SECRET trên production → 503 (misconfig); chữ ký sai → 401.
    return sig.reason === "missing-secret"
      ? { httpStatus: 503, body: { ok: false, error: "Webhook chưa cấu hình secret" } }
      : { httpStatus: 401, body: { ok: false, error: "Chữ ký không hợp lệ" } };
  }

  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  // ── Nguồn có adapter riêng (quatang…) ────────────────────────────────────
  if (adapter) {
    const deliveryId = await logWebhookDelivery({
      source,
      externalId: adapter.externalId?.(payload) ?? null,
      payload: payload ?? {},
    });
    try {
      const result = await adapter.handle(payload);
      if (!result.ok) {
        await markWebhookDelivery(deliveryId, "FAILED", result.error ?? "Xử lý lỗi");
        return { httpStatus: 200, body: { ok: false, error: result.error } };
      }
      await markWebhookDelivery(deliveryId, result.duplicate ? "DUPLICATE" : "PROCESSED");
      return {
        httpStatus: 200,
        body: { ok: true, leadId: result.leadId, duplicate: result.duplicate ?? false },
      };
    } catch (err) {
      console.error(`[webhook:${source}] adapter error:`, err);
      await markWebhookDelivery(deliveryId, "FAILED", "Lỗi hệ thống");
      return { httpStatus: 200, body: { ok: false, error: "Lỗi hệ thống" } };
    }
  }

  const fields = extractLeadFields(payload);
  const deliveryId = await logWebhookDelivery({
    source,
    externalId: fields?.externalId ?? null,
    payload: payload ?? {},
  });

  if (!fields) {
    await markWebhookDelivery(deliveryId, "FAILED", "Thiếu parentName/phone");
    return { httpStatus: 200, body: { ok: false, error: "Payload không hợp lệ" } };
  }

  try {
    const result = await ingestLead({
      parentName: fields.parentName,
      phone: fields.phone,
      email: fields.email,
      childName: fields.childName,
      note: fields.note,
      source,
      eventId: fields.externalId ? `${source}:${fields.externalId}` : null,
    });

    if (!result.ok) {
      await markWebhookDelivery(deliveryId, "FAILED", result.error ?? "Ingest lỗi");
      return { httpStatus: 200, body: { ok: false, error: result.error } };
    }

    await markWebhookDelivery(
      deliveryId,
      result.duplicate ? "DUPLICATE" : "PROCESSED",
    );
    return {
      httpStatus: 200,
      body: { ok: true, leadId: result.leadId, duplicate: result.duplicate ?? false },
    };
  } catch (err) {
    console.error(`[webhook:${source}] ingest error:`, err);
    await markWebhookDelivery(deliveryId, "FAILED", "Lỗi hệ thống");
    return { httpStatus: 200, body: { ok: false, error: "Lỗi hệ thống" } };
  }
}
