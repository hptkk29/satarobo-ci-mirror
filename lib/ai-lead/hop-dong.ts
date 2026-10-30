// lib/ai-lead/hop-dong.ts — HẰNG của hợp đồng AI Lead Gateway (Agent Messenger ↔ Admin). THUẦN: không env, không DB, không `server-only`.
//
// Nguồn sự thật: docs/ai-lead-admin/integration-handoff/api-contract-v1.yaml (+ error-codes.md cho thứ tự kiểm §3 và bảng 18 mã).
// Thiết kế: docs/ai-lead-admin/03-Architecture/design.md. Tệp này CHỈ GIỮ HẰNG; luật nghiệp vụ nằm ở `trang-thai.ts`, chữ ký ở `ky.ts`.
//
// Đổi một hằng ở đây là đổi HỢP ĐỒNG với Agent đã triển khai — đọc `compatibility-and-change-policy.md` trước. Lưới `[AIL-HD-*]`
// (hop-dong.test.ts) so tệp này với tệp YAML bản sao ở tests/fixtures/ai-lead/ để hai bên không trôi khỏi nhau.

/** `X-AiLead-Contract` — giá trị DUY NHẤT hiện hành. Khác (kể cả vắng) ⇒ 400 UNSUPPORTED_CONTRACT (bước 2). */
export const HOP_DONG = "1";

/** Tên header, chữ thường (`Headers.get` không phân biệt hoa thường). Chuỗi ký KHÔNG chứa `contract`. */
export const HEADER = {
  contract: "x-ailead-contract",
  agent: "x-ailead-agent",
  ts: "x-ailead-ts",
  nonce: "x-ailead-nonce",
  sig: "x-ailead-sig",
} as const;

/** Dạng hiển thị trong thông báo lỗi (header trả về cho người vận hành đọc). */
export const HEADER_HIEN_THI = {
  contract: "X-AiLead-Contract",
  agent: "X-AiLead-Agent",
  ts: "X-AiLead-Ts",
  nonce: "X-AiLead-Nonce",
  sig: "X-AiLead-Sig",
} as const;

/** Pathname ĐẦY ĐỦ như gửi — chuỗi ký dùng đúng chuỗi này (không host, không query, không `/` cuối). */
export const DUONG_DAN = {
  catalog: "/api/ai-lead-agent/v1/catalog",
  leadIntakes: "/api/ai-lead-agent/v1/lead-intakes",
  handoffs: "/api/ai-lead-agent/v1/handoffs",
  incidents: "/api/ai-lead-agent/v1/incidents",
  heartbeats: "/api/ai-lead-agent/v1/heartbeats",
} as const;

export type TenEndpoint = keyof typeof DUONG_DAN;

/** Nhóm hạn mức (P8): lưu lượng khách công khai KHÔNG được làm cạn hạn mức của heartbeat/handoff. */
export type NhomHanMuc = "catalog" | "intake" | "control";

export const NHOM_HAN_MUC: Readonly<Record<TenEndpoint, NhomHanMuc>> = {
  catalog: "catalog",
  leadIntakes: "intake",
  handoffs: "control",
  incidents: "control",
  heartbeats: "control",
};

// ─── Biểu thức chính quy của hợp đồng (CHÉP ĐÚNG từ YAML — lưới [AIL-HD-02] so từng cái) ────────────────────────────────
export const RE = {
  /** `X-AiLead-Agent`. */
  agentId: /^[a-z0-9]{20,40}$/,
  /** `X-AiLead-Ts` — đúng 13 chữ số (epoch ms). */
  ts: /^[0-9]{13}$/,
  nonce: /^[A-Za-z0-9_-]{16,64}$/,
  sig: /^[0-9a-fA-F]{64}$/,
  pageId: /^[A-Za-z0-9_-]{5,64}$/,
  psid: /^[A-Za-z0-9_-]{5,64}$/,
  /** `mid` của tin Messenger làm bằng chứng. */
  mid: /^[A-Za-z0-9_=.:+/-]{8,256}$/,
  idempotencyKey: /^(CONSULTATION_REQUEST|ENROLLMENT_REQUEST|TRIAL_CLASS_REQUEST|HANDOFF|INCIDENT):[0-9a-f]{40}:v[1-9][0-9]{0,2}$/,
  /** `rct_…` — biên nhận đục. */
  receipt: /^rct_[a-z0-9]{12,40}$/,
  /** `req_…` — khung hợp đồng cho phép 12–40; Admin phát ĐÚNG 24 ký tự (`AN_TOAN_CUNG.doDaiRequestId`). */
  requestId: /^req_[a-z0-9]{12,40}$/,
  probeId: /^prb_[a-z0-9]{12,40}$/,
  campusCode: /^[A-Z0-9_-]{2,16}$/,
  inboxThreadId: /^[A-Za-z0-9_-]{4,128}$/,
  /** KHÔNG cờ `u`: giữ nguyên nghĩa của YAML (JSON Schema pattern). */
  phoneRaw: /^(?=.*[0-9])[0-9+().\- \u00A0]{1,32}$/,
  testRunId: /^[A-Za-z0-9_-]{8,64}$/,
  agentVersion: /^[0-9A-Za-z.+-]{1,32}$/,
  buildSha: /^[0-9a-f]{7,40}$/,
  contractHash: /^[0-9a-f]{64}$/,
  correlationId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  /**
   * Tên Facebook: cấm toàn khoảng trắng và mọi ký tự nhóm Unicode Cc, Cf (kể cả độ rộng 0 / ZWJ), Zl, Zp. CÓ cờ `u` (như ECMA-262 của YAML).
   * Độ dài 1–100 tính theo KÝ TỰ UNICODE (code point), không theo đơn vị UTF-16 — dùng `doDaiKyTu`.
   */
  fbName: /^(?!\s*$)[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u,
} as const;

/** Số ký tự Unicode (code point) — khớp cách ajv/JSON Schema đếm `maxLength`, khác `String.length` với emoji. */
export function doDaiKyTu(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

// ─── Danh sách ĐÓNG của hợp đồng ────────────────────────────────────────────────────────────────────────────────────────
export const INTENTS = ["CONSULTATION_REQUEST", "ENROLLMENT_REQUEST", "TRIAL_CLASS_REQUEST"] as const;
export const FB_NAME_SOURCES = ["META_PROFILE_API", "WEBHOOK_PAYLOAD", "CUSTOMER_STATED"] as const;
export const HANDOFF_REASONS = [
  "CUSTOMER_REQUESTED_HUMAN",
  "OUT_OF_SCOPE",
  "COMPLAINT_OR_SENSITIVE",
  "PRICE_OR_PAYMENT",
  "AI_UNCERTAIN",
  "REPEATED_FAILURE",
  "SYSTEM_UNAVAILABLE",
  "INTAKE_PAUSED",
] as const;
export const INCIDENT_CATEGORIES = [
  "WEBHOOK_FAILURE",
  "META_API_ERROR",
  "TOKEN_INVALID",
  "GATEWAY_CLIENT_ERROR",
  "MODEL_ERROR",
  "POLICY_BLOCKED",
  "CATALOG_STALE",
  "OTHER",
] as const;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
/** 16 mã — danh sách ĐÓNG (mã ngoài danh sách ⇒ PAYLOAD_INVALID). */
export const DETAIL_CODES = [
  "SIGNATURE_MISMATCH",
  "WEBHOOK_TIMEOUT",
  "WEBHOOK_NO_EVENTS",
  "META_RATE_LIMITED",
  "META_API_ERROR",
  "TOKEN_EXPIRED",
  "TOKEN_REVOKED",
  "GATEWAY_5XX_PERSISTENT",
  "GATEWAY_RETRY_EXHAUSTED",
  "CATALOG_FETCH_FAILED",
  "CATALOG_STALE_OVER_LIMIT",
  "MODEL_TIMEOUT",
  "MODEL_OUTPUT_REJECTED",
  "POLICY_BLOCKED_OUTPUT",
  "CONTRACT_DRIFT",
  "OTHER_UNSPECIFIED",
] as const;
export const CAPABILITIES = ["CATALOG_FETCH", "LEAD_INTAKE", "HANDOFF", "INCIDENT_REPORT"] as const;
export const MOI_TRUONG = ["TEST", "PROD"] as const;
export const TRANG_THAI_CONTRACT = ["COMPATIBLE", "DEPRECATED", "INCOMPATIBLE"] as const;
export const TRANG_THAI_PAGE = ["ENABLED", "PAUSED"] as const;

export const TRANG_THAI_LEAD_INTAKE = ["ACCEPTED", "NEED_INFO", "HUMAN_QUEUED", "INVALID_SELECTION"] as const;
export const HANH_DONG_LEAD_INTAKE = ["ACKNOWLEDGE_GENERIC", "ASK_FIELDS", "TELL_STAFF_WILL_CONTACT", "RE_ASK_CAMPUS"] as const;
/** `askFields` — thứ tự CỐ ĐỊNH `phone` trước `campus`; chỉ ba tổ hợp được phép. */
export const TRUONG_HOI_TIEP = ["phone", "campus"] as const;
export const TRANG_THAI_HANDOFF = ["QUEUED", "ALREADY_QUEUED", "ALREADY_HUMAN_OWNED"] as const;
export const OWNER_MODE = ["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"] as const;
export const HANH_DONG_HANDOFF = ["SEND_HOLDING_MESSAGE", "STAY_SILENT"] as const;

// ─── 18 mã lỗi (error-codes.md §2) ──────────────────────────────────────────────────────────────────────────────────────
export const MA_LOI = {
  BAD_REQUEST: { status: 400, message: "Yêu cầu sai định dạng (header bắt buộc hoặc query string)." },
  UNSUPPORTED_CONTRACT: { status: 400, message: "Phiên bản hợp đồng không được hỗ trợ." },
  PAYLOAD_INVALID: { status: 400, message: "Dữ liệu gửi lên không đúng hợp đồng." },
  BODY_TOO_LARGE: { status: 413, message: "Thân yêu cầu vượt quá giới hạn." },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "Thân yêu cầu phải là application/json." },
  // CÙNG mã, CÙNG câu cho "sai chữ ký" và "agent không tồn tại" — không lộ agent nào có thật (P1).
  BAD_SIGNATURE: { status: 401, message: "Chữ ký không hợp lệ." },
  CLOCK_SKEW: { status: 401, message: "Đồng hồ lệch quá 5 phút so với máy chủ." },
  NONCE_REUSED: { status: 401, message: "Nonce đã được sử dụng." },
  AGENT_DISABLED: { status: 401, message: "Agent đã bị tắt trên máy chủ." },
  PAGE_NOT_ALLOWED: { status: 403, message: "Agent không được phép phục vụ Page này." },
  PAGE_PAUSED: { status: 403, message: "Page đang được tạm dừng nhận hồ sơ." },
  ENVIRONMENT_MISMATCH: { status: 403, message: "Môi trường khai báo không khớp với khoá." },
  TEST_ONLY_FIELD: { status: 400, message: "Trường chỉ dành cho môi trường TEST." },
  IDEMPOTENCY_CONFLICT: { status: 409, message: "idempotencyKey đã dùng cho một nội dung khác." },
  RATE_LIMITED: { status: 429, message: "Vượt hạn mức yêu cầu." },
  NOT_CONFIGURED: { status: 503, message: "Cổng AI Lead chưa được cấu hình." },
  TEMP_UNAVAILABLE: { status: 503, message: "Hệ thống tạm thời chưa nhận được yêu cầu, hãy thử lại." },
  INTERNAL_ERROR: { status: 500, message: "Lỗi không lường trước phía máy chủ." },
} as const satisfies Record<string, { status: number; message: string }>;

export type MaLoi = keyof typeof MA_LOI;

/** Mã có header `Retry-After` (số nguyên giây ≥ 1). */
export const MA_LOI_CO_RETRY_AFTER: ReadonlySet<MaLoi> = new Set<MaLoi>(["RATE_LIMITED", "TEMP_UNAVAILABLE"]);

/**
 * Thứ tự server kiểm (error-codes.md §3) — nguồn DUY NHẤT. Cùng một request hỏng ở hai chỗ chỉ trả mã của bước đứng trước. Hai hàng "14" chia
 * một bước (NOT_ALLOWED trước PAUSED). Lưới `[AIL-HD-05]` ghim thứ tự này; `xac-thuc.ts` (lát G) PHẢI đi đúng thứ tự.
 *
 * ⚠️ `xac-thuc.ts` còn BỐN bước PHỤ không có hàng ở bảng này (không thêm mã nào ngoài 18 mã): (0) cờ cổng tắt ⇒ 404 JSON `NOT_FOUND`, đứng trước bước 1; (5b) hạn mức theo IP ⇒ `RATE_LIMITED`
 * ngay sau bước 5, TRƯỚC khi tra DB; (8a) Agent TEST trên máy chủ PROD ⇒ `AGENT_DISABLED` ngay sau bước 8; (8b) cổng PROD đóng ⇒ `NOT_CONFIGURED` sau 8a, TRƯỚC bước 9. Vị trí của chúng được ghim bởi
 * `[AIL-XT-02b]` (xac-thuc.test.ts) — đổi chỗ một bước phụ làm đổi mã mà người gọi thấy, nên không được lặng lẽ.
 */
export const THU_TU_KIEM: readonly { buoc: number; ma: MaLoi }[] = [
  { buoc: 1, ma: "NOT_CONFIGURED" },
  { buoc: 2, ma: "UNSUPPORTED_CONTRACT" },
  { buoc: 3, ma: "BAD_REQUEST" },
  { buoc: 4, ma: "BODY_TOO_LARGE" },
  { buoc: 5, ma: "UNSUPPORTED_MEDIA_TYPE" },
  { buoc: 6, ma: "BAD_SIGNATURE" },
  { buoc: 7, ma: "CLOCK_SKEW" },
  { buoc: 8, ma: "AGENT_DISABLED" },
  { buoc: 9, ma: "RATE_LIMITED" },
  { buoc: 10, ma: "NONCE_REUSED" },
  { buoc: 11, ma: "PAYLOAD_INVALID" },
  { buoc: 12, ma: "ENVIRONMENT_MISMATCH" },
  { buoc: 13, ma: "TEST_ONLY_FIELD" },
  { buoc: 14, ma: "PAGE_NOT_ALLOWED" },
  { buoc: 14, ma: "PAGE_PAUSED" },
  { buoc: 15, ma: "UNSUPPORTED_CONTRACT" },
  { buoc: 16, ma: "RATE_LIMITED" },
  { buoc: 17, ma: "IDEMPOTENCY_CONFLICT" },
  { buoc: 18, ma: "TEMP_UNAVAILABLE" },
  { buoc: 18, ma: "INTERNAL_ERROR" },
];

// ─── Mặc định của tham số `ai.*` (OD-04: số TẠM, chưa đo) — registry.ts lấy từ ĐÂY, đừng gõ lại số ─────────────────────────
export const MAC_DINH_CAI_DAT = {
  heartbeatSeconds: 60,
  staleMultiplier: 3,
  rateCatalogPerMin: 30,
  rateIntakePerMin: 120,
  rateIntakePerPsidPerMin: 30,
  rateControlPerMin: 60,
  rateNewConversationsPerDayPerPage: 500,
  bodyMaxBytes: 8_192,
  clockSkewMs: 300_000,
  nonceTtlMinutes: 15,
  catalogMaxAgeSeconds: 300,
  probeTtlMinutes: 10,
  slaClaimMinutes: 30,
  slaResolveMinutes: 240,
  draftExpireHours: 72,
  queueMaxAgeHours: 24,
  /** Bằng chứng kiểm chứng PASS (L1–L4) hết hiệu lực sau chừng này giờ (trước đây là hằng cứng 7 ngày trong ket-noi.ts). */
  verifyTtlHours: 168,
  /** Agent im lặng quá chừng này giờ ⇒ DISCONNECTED (trước đây hằng cứng 24 giờ). */
  disconnectHours: 24,
  /** Giữ bản ghi idempotency (khung phát lại của hợp đồng) chừng này ngày rồi xoá (trước đây hằng cứng 7 ngày trong don-dep.ts). */
  requestRetentionDays: 7,
  /** Nhật ký TỪ CHỐI 400/401/429… dạng BỘ ĐẾM GỘP (không IP/header/body/chữ ký). TẮT mặc định — bật là quyết định của Owner (xem docs/ai-lead-admin/06-Monitoring/reject-log-design.md). */
  rejectLogEnabled: false,
  /** Giữ bộ đếm từ chối chừng này ngày rồi xoá. Số TẠM — chưa được Owner/Pháp chế duyệt; chỉ có tác dụng khi `rejectLogEnabled` bật. */
  rejectLogRetentionDays: 30,
  prodEnabled: false,
  consentPolicyStatus: "PENDING_LEGAL",
  takeoverNeedsAgentConfirmation: true,
  /** Tự tạo lead khi hồ sơ đã đủ ba điều kiện. Mặc định TẮT: giai đoạn pilot duyệt 100% (roadmap A §10.2). */
  autoCreateEnabled: false,
  inboxLinkTemplate: "",
} as const;

export const TRANG_THAI_CHINH_SACH_DONG_Y = ["PENDING_LEGAL", "APPROVED"] as const;
export type TrangThaiChinhSachDongY = (typeof TRANG_THAI_CHINH_SACH_DONG_Y)[number];

/** Biên cho phép Quản trị chỉnh `ai.heartbeatSeconds` — khớp `nextHeartbeatSeconds` của hợp đồng (min 15, max 90). */
export const BIEN_HEARTBEAT_GIAY = { min: 15, max: 90 } as const;
/** Biên `maxAgeSeconds` của catalog theo hợp đồng. */
export const BIEN_CATALOG_MAX_AGE_GIAY = { min: 30, max: 3_600 } as const;

/** Giới hạn AN TOÀN CỨNG — KHÔNG phải tham số vận hành (OD-04): cấu hình sai cũng không vượt được. */
export const AN_TOAN_CUNG = {
  /** Trần tuyệt đối của `ai.bodyMaxBytes`, dù cấu hình thế nào. */
  tranThanTuyetDoiByte: 65_536,
  /** `AI_LEAD_AGENT_MASTER_KEY` ngắn hơn ⇒ coi như CHƯA cấu hình (cùng ngưỡng signing-key.ts). */
  khoaGocToiThieuKyTu: 32,
  /** Độ dài CỐ ĐỊNH của phần sau `req_` / `rct_` (P1: không dẫn xuất từ SĐT/hồ sơ, không lộ nhánh nghiệp vụ qua độ dài). */
  doDaiRequestId: 24,
  doDaiReceiptId: 24,
  /** `occurredAt` của sự cố lệch quá chừng này so với giờ server ⇒ PAYLOAD_INVALID (P9). */
  occurredAtLechToiDaMs: 24 * 3_600_000,
  /** Mặc định `If-None-Match` tối đa (YAML: maxLength 128). */
  etagToiDaKyTu: 128,
} as const;

/**
 * Danh tính CỦA FIXTURE (P4) — bị CHẶN CỨNG ở mọi môi trường: lúc khởi động và lúc cấp khoá. Gói bàn giao công khai trong repo gương, nên ai cũng biết
 * các giá trị này; một agent PROD mang `agentId` này là một cửa sau.
 */
export const DANH_TINH_FIXTURE = {
  tienToAgentId: "cm9ailagenttest",
  /** Secret trong hmac-vectors.json (64 hex). */
  agentSecrets: ["00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"],
  pageIds: ["104500000000001", "999999999999999"],
} as const;

/** `true` nếu BẤT KỲ giá trị truyền vào là danh tính của fixture. Truyền cái nào có cái đó. */
export function laDanhTinhFixture(x: { agentId?: string; pageId?: string; agentSecret?: string }): boolean {
  if (x.agentId !== undefined && x.agentId.startsWith(DANH_TINH_FIXTURE.tienToAgentId)) return true;
  if (x.pageId !== undefined && (DANH_TINH_FIXTURE.pageIds as readonly string[]).includes(x.pageId)) return true;
  if (x.agentSecret !== undefined && (DANH_TINH_FIXTURE.agentSecrets as readonly string[]).includes(x.agentSecret)) return true;
  return false;
}

// ─── Mẫu link mở hội thoại Facebook (OD-03) ─────────────────────────────────────────────────────────────────────────────
const HOST_LINK_DUOC_PHEP: ReadonlySet<string> = new Set(["facebook.com", "business.facebook.com"]);
const CHO_GIU_CHO_THREAD = "{threadId}";

/**
 * Kiểm mẫu link `ai.inboxLinkTemplate`. Rỗng = hợp lệ (nghĩa là KHÔNG có nút). Khác rỗng phải: https · host đúng `facebook.com` hoặc
 * `business.facebook.com` (không subdomain khác, không `facebook.com.evil.test`) · không mang tài khoản/mật khẩu · chứa `{threadId}` và KHÔNG ở phần host ·
 * dài ≤ 300. Trả `null` nếu hợp lệ, hoặc câu lỗi tiếng Việt.
 *
 * Vì sao chặt: mẫu do quản trị gõ, nhưng `inboxThreadId` chèn vào là LỜI KHAI CỦA AGENT — nếu host không bị khoá thì một mẫu sai/bị sửa biến nút
 * "Mở hội thoại Facebook" thành điều hướng ra ngoài (open redirect) có kèm dữ liệu khách.
 */
export function kiemMauLinkHoiThoai(mau: string): string | null {
  if (mau === "") return null;
  if (mau.length > 300) return "Mẫu link dài quá 300 ký tự.";
  if (!mau.includes(CHO_GIU_CHO_THREAD)) return "Mẫu link phải chứa {threadId}.";
  const sauGiaoThuc = mau.startsWith("https://") ? mau.slice("https://".length) : null;
  if (sauGiaoThuc === null) return "Mẫu link phải bắt đầu bằng https://.";
  const phanHost = sauGiaoThuc.split(/[/?#]/, 1)[0] ?? "";
  if (phanHost.includes("{") || phanHost.includes("}")) return "{threadId} không được nằm trong phần tên miền.";
  let url: URL;
  try {
    url = new URL(mau.split(CHO_GIU_CHO_THREAD).join("THREADID"));
  } catch {
    return "Mẫu link không phải đường dẫn hợp lệ.";
  }
  if (url.username !== "" || url.password !== "") return "Mẫu link không được chứa tên đăng nhập hoặc mật khẩu.";
  if (url.port !== "") return "Mẫu link không được chỉ định cổng.";
  if (!HOST_LINK_DUOC_PHEP.has(url.hostname)) return "Chỉ chấp nhận tên miền facebook.com hoặc business.facebook.com.";
  return null;
}

/** Dựng link từ mẫu ĐÃ kiểm + `inboxThreadId` (đã khớp RE.inboxThreadId). Mẫu rỗng/không hợp lệ hoặc thread lạ ⇒ `null` (KHÔNG hiện nút). */
export function dungLinkHoiThoai(mau: string, inboxThreadId: string | null | undefined): string | null {
  if (mau === "" || !inboxThreadId) return null;
  if (kiemMauLinkHoiThoai(mau) !== null) return null;
  if (!RE.inboxThreadId.test(inboxThreadId)) return null;
  return mau.split(CHO_GIU_CHO_THREAD).join(encodeURIComponent(inboxThreadId));
}
