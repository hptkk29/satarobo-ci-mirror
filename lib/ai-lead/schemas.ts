// lib/ai-lead/schemas.ts — SCHEMA zod của hợp đồng AI Lead Gateway. THUẦN. Nguồn sự thật: api-contract-v1.yaml (components.schemas).
//
// Hai nhóm:
//  · REQUEST (5 cái) — `.strictObject`: khoá lạ ⇒ lỗi (PAYLOAD_INVALID). Đây là những gì route PARSE.
//  · RESPONSE (6 cái) — Admin KHÔNG parse chúng khi chạy; chúng để (1) test nhà cung cấp [L1 provider] khẳng định mỗi phản hồi Admin phát ra đúng
//    hợp đồng, (2) fixture 77–79 (phản hồi SAI) bị từ chối đúng. Quy tắc if/then của YAML được viết thành `discriminatedUnion` theo `status`.
//
// ⚠️ Không có ô nào nhận văn bản tự do: mọi chuỗi bị khoá bởi pattern + độ dài. Phía Admin vẫn coi `fbName`/`phoneRaw`/`mid`/… là DỮ LIỆU KHÔNG TIN CẬY
// (escape khi hiển thị, không đưa vào lời nhắc cho mô hình).
import { z } from "zod";
import {
  AN_TOAN_CUNG,
  CAPABILITIES,
  DETAIL_CODES,
  FB_NAME_SOURCES,
  HANDOFF_REASONS,
  INCIDENT_CATEGORIES,
  INTENTS,
  MA_LOI,
  MOI_TRUONG,
  RE,
  SEVERITIES,
  TRANG_THAI_CONTRACT,
  TRANG_THAI_PAGE,
  doDaiKyTu,
} from "./hop-dong";

// ─── Nguyên tử ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const pageId = z.string().regex(RE.pageId);
const psid = z.string().regex(RE.psid);
const mid = z.string().regex(RE.mid);
const idempotencyKey = z.string().regex(RE.idempotencyKey);
/** KIND (phần trước dấu `:` đầu tiên) của một idempotencyKey đã qua regex. */
const kindCuaKhoa = (k: string) => k.slice(0, k.indexOf(":"));
const testRunId = z.string().regex(RE.testRunId);
const dateTime = z.iso.datetime({ offset: true });
const requestIdSchema = z.string().regex(RE.requestId);
const receipt = z.string().regex(RE.receipt);
const timestampMs = z.number().int();

/** `fbName`: 1–100 KÝ TỰ UNICODE (không phải đơn vị UTF-16), không toàn khoảng trắng, cấm Cc/Cf/Zl/Zp. */
const fbName = z
  .string()
  .regex(RE.fbName)
  .refine((s) => doDaiKyTu(s) >= 1 && doDaiKyTu(s) <= 100, { message: "fbName phải dài 1–100 ký tự" });

const conversation = z
  .strictObject({
    pageId,
    psid,
    fbName: fbName.nullish(),
    fbNameSource: z.enum(FB_NAME_SOURCES).optional(),
    inboxThreadId: z.string().regex(RE.inboxThreadId).nullish(),
  })
  // YAML: `if fbName là chuỗi then required fbNameSource`. `fbName: null` không đòi nguồn.
  .superRefine((c, ctx) => {
    if (typeof c.fbName === "string" && c.fbNameSource === undefined) {
      ctx.addIssue({ code: "custom", path: ["fbNameSource"], message: "fbNameSource bắt buộc khi có fbName" });
    }
  });

// ─── REQUEST ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const leadIntakeRequestSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    idempotencyKey,
    conversation,
    intent: z.enum(INTENTS),
    candidate: z.strictObject({
      phoneRaw: z.string().max(32).regex(RE.phoneRaw).optional(),
      campusCode: z.string().regex(RE.campusCode).optional(),
      consent: z
        .strictObject({
          contactAllowed: z.literal(true),
          messageMid: mid,
        })
        .optional(),
    }),
    evidence: z
      .strictObject({
        phoneMessageMid: mid.optional(),
        campusMessageMid: mid.optional(),
      })
      .optional(),
    catalogVersion: z.number().int().min(1).optional(),
    testRunId: testRunId.optional(),
  })
  // YAML allOf: mỗi trường có mặt trong `candidate` phải có `mid` bằng chứng tương ứng.
  .superRefine((r, ctx) => {
    // Hợp đồng (yaml IdempotencyKey): `/lead-intakes` dùng KIND = intent. Khoá của endpoint khác (HANDOFF/INCIDENT) hoặc của intent khác bị từ chối — nếu không, một khoá HANDOFF gửi nhầm vào đây
    // chiếm khoá và lần gọi /handoffs thật sau đó ăn IDEMPOTENCY_CONFLICT.
    if (kindCuaKhoa(r.idempotencyKey) !== r.intent) {
      ctx.addIssue({ code: "custom", path: ["idempotencyKey"], message: "KIND của idempotencyKey phải bằng intent" });
    }
    const can = (truong: "phoneMessageMid" | "campusMessageMid", coDuLieu: boolean) => {
      if (!coDuLieu) return;
      if (r.evidence === undefined) {
        ctx.addIssue({ code: "custom", path: ["evidence"], message: "evidence bắt buộc khi candidate có dữ liệu" });
      } else if (r.evidence[truong] === undefined) {
        ctx.addIssue({ code: "custom", path: ["evidence", truong], message: `${truong} bắt buộc` });
      }
    };
    can("phoneMessageMid", r.candidate.phoneRaw !== undefined);
    can("campusMessageMid", r.candidate.campusCode !== undefined);
  });

export const handoffRequestSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    idempotencyKey,
    conversation,
    reasonCode: z.enum(HANDOFF_REASONS),
    testRunId: testRunId.optional(),
  })
  .superRefine((r, ctx) => {
    if (kindCuaKhoa(r.idempotencyKey) !== "HANDOFF") ctx.addIssue({ code: "custom", path: ["idempotencyKey"], message: "KIND của idempotencyKey phải là HANDOFF" });
  });

export const incidentRequestSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    idempotencyKey,
    pageId: pageId.optional(),
    category: z.enum(INCIDENT_CATEGORIES),
    severity: z.enum(SEVERITIES),
    detailCode: z.enum(DETAIL_CODES),
    occurredAt: dateTime,
    correlationId: z.string().regex(RE.correlationId).optional(),
  })
  .superRefine((r, ctx) => {
    if (kindCuaKhoa(r.idempotencyKey) !== "INCIDENT") ctx.addIssue({ code: "custom", path: ["idempotencyKey"], message: "KIND của idempotencyKey phải là INCIDENT" });
  });

export const heartbeatRequestSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  environment: z.enum(MOI_TRUONG),
  agentVersion: z.string().regex(RE.agentVersion),
  buildSha: z.string().regex(RE.buildSha),
  contractHash: z.string().regex(RE.contractHash),
  catalogVersionSeen: z.number().int().min(1).nullish(),
  capabilities: z
    .array(z.enum(CAPABILITIES))
    .refine((a) => new Set(a).size === a.length, { message: "capabilities không được trùng" }),
  pages: z
    .array(z.strictObject({ pageId, lastWebhookEventAt: dateTime.nullable() }))
    .max(50),
  probeAck: z.strictObject({ probeId: z.string().regex(RE.probeId), nonce: z.string().regex(RE.nonce) }).nullish(),
  sentAt: dateTime,
});

export type LeadIntakeRequest = z.infer<typeof leadIntakeRequestSchema>;
export type HandoffRequest = z.infer<typeof handoffRequestSchema>;
export type IncidentRequest = z.infer<typeof incidentRequestSchema>;
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

// ─── RESPONSE ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const meta = z.strictObject({ requestId: requestIdSchema, serverTime: timestampMs });

const askFields = z.union([
  z.tuple([z.literal("phone")]),
  z.tuple([z.literal("campus")]),
  z.tuple([z.literal("phone"), z.literal("campus")]),
]);

const duLieuIntake = z.discriminatedUnion("status", [
  z.strictObject({ receiptId: receipt, status: z.literal("ACCEPTED"), nextAction: z.literal("ACKNOWLEDGE_GENERIC") }),
  z.strictObject({ receiptId: receipt, status: z.literal("NEED_INFO"), nextAction: z.literal("ASK_FIELDS"), askFields }),
  z.strictObject({ receiptId: receipt, status: z.literal("HUMAN_QUEUED"), nextAction: z.literal("TELL_STAFF_WILL_CONTACT") }),
  z.strictObject({
    receiptId: receipt,
    status: z.literal("INVALID_SELECTION"),
    nextAction: z.literal("RE_ASK_CAMPUS"),
    refreshCatalog: z.literal(true),
  }),
]);

export const leadIntakeResponseSchema = z.strictObject({ ok: z.literal(true), data: duLieuIntake, meta });

const duLieuHandoff = z.discriminatedUnion("handoffStatus", [
  z.strictObject({
    receiptId: receipt,
    handoffStatus: z.literal("QUEUED"),
    ownerMode: z.literal("HANDOFF_REQUESTED"),
    nextAction: z.literal("SEND_HOLDING_MESSAGE"),
  }),
  z.strictObject({
    receiptId: receipt,
    handoffStatus: z.literal("ALREADY_QUEUED"),
    ownerMode: z.literal("HANDOFF_REQUESTED"),
    nextAction: z.literal("STAY_SILENT"),
  }),
  z.strictObject({
    receiptId: receipt,
    handoffStatus: z.literal("ALREADY_HUMAN_OWNED"),
    ownerMode: z.enum(["HUMAN_ACTIVE", "PAUSED"]),
    nextAction: z.literal("STAY_SILENT"),
  }),
]);

export const handoffResponseSchema = z.strictObject({ ok: z.literal(true), data: duLieuHandoff, meta });

export const incidentResponseSchema = z.strictObject({
  ok: z.literal(true),
  data: z.strictObject({ receiptId: receipt, accepted: z.literal(true) }),
  meta,
});

export const heartbeatResponseSchema = z.strictObject({
  ok: z.literal(true),
  data: z.strictObject({
    serverTime: timestampMs,
    nextHeartbeatSeconds: z.number().int().min(15).max(90),
    contractStatus: z.enum(TRANG_THAI_CONTRACT),
    latestCatalogVersion: z.number().int().min(1),
    pages: z.array(z.strictObject({ pageId, state: z.enum(TRANG_THAI_PAGE) })),
    probe: z
      .strictObject({
        probeId: z.string().regex(RE.probeId),
        nonce: z.string().regex(RE.nonce),
        expiresAt: dateTime,
      })
      .nullable(),
  }),
  meta,
});

const catalogCampus = z.strictObject({
  campusCode: z.string().regex(RE.campusCode),
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(400),
  acceptingLeads: z.boolean(),
});

export const catalogResponseSchema = z.strictObject({
  ok: z.literal(true),
  data: z.strictObject({
    catalogVersion: z.number().int().min(1),
    publishedAt: dateTime,
    maxAgeSeconds: z.number().int().min(30).max(3_600),
    etag: z.string().max(AN_TOAN_CUNG.etagToiDaKyTu),
    pages: z.array(z.strictObject({ pageId, campuses: z.array(catalogCampus) })),
  }),
  meta,
});

export const errorEnvelopeSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.enum(Object.keys(MA_LOI) as [keyof typeof MA_LOI, ...(keyof typeof MA_LOI)[]]),
    message: z.string().max(300),
    field: z.string().max(200).optional(),
    requestId: requestIdSchema,
  }),
});

/** Tên schema (như trong `fixture.validates`) → schema. Test provider tra theo tên này. */
export const SCHEMA_THEO_TEN = {
  LeadIntakeRequest: leadIntakeRequestSchema,
  HandoffRequest: handoffRequestSchema,
  IncidentRequest: incidentRequestSchema,
  HeartbeatRequest: heartbeatRequestSchema,
  LeadIntakeResponse: leadIntakeResponseSchema,
  HandoffResponse: handoffResponseSchema,
  IncidentResponse: incidentResponseSchema,
  HeartbeatResponse: heartbeatResponseSchema,
  CatalogResponse: catalogResponseSchema,
  ErrorEnvelope: errorEnvelopeSchema,
} as const;

// ─── Phụ trợ ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * `error.field` từ lỗi zod ĐẦU TIÊN: đường dẫn khoá gây lỗi, ví dụ `candidate.sourceId`, `evidence.phoneMessageMid`, `pages[0].pageId`.
 * Khoá LẠ (unrecognized_keys) ⇒ gắn tên khoá lạ vào đường dẫn cha. KHÔNG BAO GIỜ trả giá trị (có thể là PII). Cắt ở 200 ký tự (trần của hợp đồng).
 * Không có đường dẫn (lỗi gốc, ví dụ JSON không phải object) ⇒ `undefined`.
 */
export function moTaTruongLoi(err: z.ZodError): string | undefined {
  const issue = err.issues[0];
  if (!issue) return undefined;
  const seg: PropertyKey[] = [...issue.path];
  if (issue.code === "unrecognized_keys" && issue.keys.length > 0) seg.push(issue.keys[0]!);
  if (seg.length === 0) return undefined;
  let s = "";
  for (const p of seg) {
    if (typeof p === "number") s += `[${p}]`;
    else s += s === "" ? String(p) : `.${String(p)}`;
  }
  return s.slice(0, 200);
}

/**
 * P9: `occurredAt` của sự cố lệch quá 24 giờ so với giờ server ⇒ PAYLOAD_INVALID (`field = occurredAt`). Tách khỏi schema vì cần `nowMs`
 * (hàm thuần, nhận giờ vào). Chuỗi không phân tích được ⇒ false.
 */
export function occurredAtTrongHanMuc(occurredAt: string, nowMs: number): boolean {
  const t = Date.parse(occurredAt);
  return Number.isFinite(t) && Math.abs(nowMs - t) <= AN_TOAN_CUNG.occurredAtLechToiDaMs;
}

/** Cổng nhận `testRunId` (bước 13): có `testRunId` mà môi trường PROD ⇒ TEST_ONLY_FIELD. Hàm thuần để route và test dùng chung. */
export function testRunIdBiCam(body: { testRunId?: string | undefined }, moiTruong: "TEST" | "PROD"): boolean {
  return moiTruong === "PROD" && body.testRunId !== undefined;
}
