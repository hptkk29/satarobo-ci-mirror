// lib/payments/payos.ts — CỔNG THANH TOÁN payOS (tạo link/QR + xác thực webhook).
//
// Vì sao payOS mà không chỉ VietQR tĩnh: payOS trả `orderCode` riêng cho từng lần
// xuất QR → webhook về biết CHÍNH XÁC phiếu thu nào, không phải đoán qua nội dung
// chuyển khoản (đường SePay hiện hành, giữ làm dự phòng).
//
// ⚠️ CHƯA CÓ CREDENTIAL THẬT (chủ dự án chưa cấp). Thiếu env hoặc PAYOS_LIVE≠"true"
// → CHẾ ĐỘ MÔ PHỎNG: không gọi API ngoài, trả payload giả có tiền tố `SIMULATED-`
// để nghiệm thu/test không đụng tiền thật. Noi theo znsProvider (lib/zalo/provider.ts).
//
// Mọi hàm chữ ký đều THUẦN (nhận key làm tham số) → test được không cần mạng.
import crypto from "node:crypto";

// ── Hằng ────────────────────────────────────────────────────────────────────
export const PAYOS_PROVIDER = "PAYOS";
/** Tiền tố nhận biết dữ liệu mô phỏng — soi log/DB là biết ngay không phải tiền thật. */
export const PAYOS_SIMULATED_PREFIX = "SIMULATED-";
const CREATE_ENDPOINT = "https://api-merchant.payos.vn/v2/payment-requests";
/** payOS giới hạn `description` 25 ký tự (giả định theo tài liệu v2 — cắt cho an toàn). */
const DESCRIPTION_MAX = 25;

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** Đủ 3 credential mới coi là đã cấu hình. Thiếu 1 → mô phỏng. */
export function isPayosConfigured(): boolean {
  return Boolean(
    readEnv("PAYOS_CLIENT_ID") && readEnv("PAYOS_API_KEY") && readEnv("PAYOS_CHECKSUM_KEY"),
  );
}

/** Chỉ gọi API THẬT khi đã cấu hình VÀ bật công tắc `PAYOS_LIVE="true"`. */
export function isPayosLive(): boolean {
  return isPayosConfigured() && process.env.PAYOS_LIVE === "true";
}

export function payosChecksumKey(): string {
  return readEnv("PAYOS_CHECKSUM_KEY");
}

// ── Chữ ký ──────────────────────────────────────────────────────────────────
/**
 * Chuỗi ký của payload webhook: các khoá của `data` SẮP XẾP ALPHABET rồi nối
 * `k=v&k2=v2`.
 *
 * GIẢ ĐỊNH (theo SDK chính thức @payos/node — `convertObjToQueryStr`):
 *  - khoá có giá trị `undefined` bị LOẠI khỏi chuỗi;
 *  - `null` / chuỗi "null" / "undefined" quy về chuỗi rỗng;
 *  - mảng được JSON.stringify sau khi sắp khoá từng phần tử;
 *  - số/boolean nối theo dạng chuỗi mặc định của JS.
 * Nếu payOS đổi quy ước, chỉ phải sửa đúng hàm này.
 */
export function payosSortedQueryString(data: Record<string, unknown>): string {
  return Object.keys(data)
    .sort()
    .filter((k) => data[k] !== undefined)
    .map((k) => {
      let value: unknown = data[k];
      if (Array.isArray(value)) {
        value = JSON.stringify(
          value.map((el) =>
            el && typeof el === "object"
              ? Object.keys(el as Record<string, unknown>)
                  .sort()
                  .reduce<Record<string, unknown>>((acc, key) => {
                    acc[key] = (el as Record<string, unknown>)[key];
                    return acc;
                  }, {})
              : el,
          ),
        );
      }
      if (value === null || value === "null" || value === "undefined") value = "";
      return `${k}=${String(value)}`;
    })
    .join("&");
}

/** HMAC-SHA256 hex của chuỗi `raw` với checksum key. */
export function payosHmac(raw: string, checksumKey: string): string {
  return crypto.createHmac("sha256", checksumKey).update(raw).digest("hex");
}

/** Chữ ký của `data` webhook (thuần). */
export function signPayosData(data: Record<string, unknown>, checksumKey: string): string {
  return payosHmac(payosSortedQueryString(data), checksumKey);
}

export type CreateSignatureInput = {
  amount: number;
  cancelUrl: string;
  description: string;
  orderCode: number;
  returnUrl: string;
};

/**
 * Chuỗi ký của yêu cầu TẠO link — payOS quy định CỐ ĐỊNH thứ tự alphabet:
 * `amount=…&cancelUrl=…&description=…&orderCode=…&returnUrl=…`
 * (đây là hợp đồng riêng của endpoint create, KHÁC quy tắc "sort mọi khoá" của webhook).
 */
export function buildCreateSignatureBase(input: CreateSignatureInput): string {
  return (
    `amount=${input.amount}` +
    `&cancelUrl=${input.cancelUrl}` +
    `&description=${input.description}` +
    `&orderCode=${input.orderCode}` +
    `&returnUrl=${input.returnUrl}`
  );
}

export function signCreatePayload(input: CreateSignatureInput, checksumKey: string): string {
  return payosHmac(buildCreateSignatureBase(input), checksumKey);
}

/** So sánh chữ ký chống timing-attack (độ dài lệch → false, không ném). */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Kiểm chữ ký `data` (THUẦN — không đọc env, không mạng). */
export function verifyPayosSignature(
  data: Record<string, unknown> | null | undefined,
  signature: string | null | undefined,
  checksumKey: string,
): boolean {
  if (!data || !signature || !checksumKey) return false;
  return safeEqualHex(signPayosData(data, checksumKey), signature);
}

export type PayosWebhookBody = {
  code?: string;
  desc?: string;
  success?: boolean;
  data?: Record<string, unknown> | null;
  signature?: string | null;
};

export type WebhookVerification =
  | { ok: true; mode: "LIVE" | "SIMULATED" }
  | { ok: false; reason: string };

/**
 * Xác thực webhook payOS (body đầy đủ `{ code, desc, data, signature }`).
 *
 * - CÓ checksum key → bắt buộc chữ ký đúng (đường PROD).
 * - THIẾU checksum key → chế độ MÔ PHỎNG: chấp nhận khi không kèm chữ ký hoặc chữ
 *   ký mang tiền tố `SIMULATED-`. Chữ ký "thật" mà không có key để kiểm → TỪ CHỐI
 *   (không giả vờ xác thực được). Đây là lối cho nghiệm thu khi chưa có credential;
 *   trên prod credential luôn có nên nhánh này không chạm tới.
 */
export function verifyWebhookSignature(
  body: PayosWebhookBody,
  checksumKey: string = payosChecksumKey(),
): WebhookVerification {
  if (!body || typeof body !== "object" || !body.data) {
    return { ok: false, reason: "Thiếu trường `data` trong payload" };
  }
  const signature = (body.signature ?? "").trim();

  if (!checksumKey) {
    if (!signature || signature.startsWith(PAYOS_SIMULATED_PREFIX)) {
      return { ok: true, mode: "SIMULATED" };
    }
    return { ok: false, reason: "Chưa cấu hình PAYOS_CHECKSUM_KEY — không kiểm được chữ ký" };
  }
  if (!verifyPayosSignature(body.data, signature, checksumKey)) {
    return { ok: false, reason: "Chữ ký không hợp lệ" };
  }
  return { ok: true, mode: "LIVE" };
}

// ── orderCode ───────────────────────────────────────────────────────────────
/**
 * `orderCode` của payOS là SỐ NGUYÊN duy nhất theo merchant (≤ Number.MAX_SAFE_INTEGER).
 * Sinh = mili-giây × 1000 + số ngẫu nhiên 0..999 → 1.7e15, còn xa trần 9.0e15, và
 * 1000 khe/ms đủ chống trùng cho nhịp bấm "Xuất QR" của sale.
 * Thuần (nhận `now`/`rand`) để test tính xác định.
 */
export function generateProviderOrderCode(now: number = Date.now(), rand?: number): number {
  const slot = Math.floor((rand ?? Math.random()) * 1000) % 1000;
  return now * 1000 + slot;
}

// ── Tạo link thanh toán ─────────────────────────────────────────────────────
export type CreatePaymentLinkInput = {
  orderCode: number;
  amount: number;
  description: string;
  expiresAt?: Date | null;
  returnUrl?: string;
  cancelUrl?: string;
};

export type PayosPaymentLink = {
  /** true = dữ liệu MÔ PHỎNG, không phải link thật. */
  simulated: boolean;
  providerOrderCode: number;
  checkoutUrl: string;
  /** Chuỗi EMVCo để render QR (payOS trả ở `data.qrCode`). */
  qrContent: string;
  paymentLinkId: string | null;
  accountNumber: string | null;
  accountName: string | null;
  bin: string | null;
  amount: number;
  description: string;
};

export type CreatePaymentLinkResult =
  | { ok: true; data: PayosPaymentLink }
  | { ok: false; error: string };

/** Cắt mô tả về giới hạn payOS (giữ nguyên khoảng trắng ở giữa, bỏ 2 đầu). */
export function truncateDescription(raw: string): string {
  return raw.trim().slice(0, DESCRIPTION_MAX);
}

function simulatedLink(input: CreatePaymentLinkInput, description: string): PayosPaymentLink {
  const marker = `${PAYOS_SIMULATED_PREFIX}${input.orderCode}`;
  return {
    simulated: true,
    providerOrderCode: input.orderCode,
    checkoutUrl: `https://simulated.payos.local/checkout/${marker}`,
    qrContent: `${marker}|amount=${input.amount}|desc=${description}`,
    paymentLinkId: marker,
    accountNumber: `${PAYOS_SIMULATED_PREFIX}ACC`,
    accountName: "SIMULATED PAYOS",
    bin: null,
    amount: input.amount,
    description,
  };
}

/**
 * Tạo link/QR thanh toán. Chưa live → trả dữ liệu MÔ PHỎNG (không gọi mạng).
 *
 * GIẢ ĐỊNH hợp đồng payOS v2:
 *  - `POST https://api-merchant.payos.vn/v2/payment-requests`
 *  - header `x-client-id`, `x-api-key`
 *  - body `{ orderCode, amount, description, cancelUrl, returnUrl, expiredAt?, signature }`
 *    với `expiredAt` = Unix timestamp GIÂY.
 *  - response `{ code: "00", desc, data: { bin, accountNumber, accountName, amount,
 *    description, orderCode, paymentLinkId, status, checkoutUrl, qrCode }, signature }`
 */
export async function createPaymentLink(
  input: CreatePaymentLinkInput,
): Promise<CreatePaymentLinkResult> {
  const description = truncateDescription(input.description);
  if (!Number.isInteger(input.orderCode) || input.orderCode <= 0) {
    return { ok: false, error: "PAYOS_INVALID_ORDER_CODE" };
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "PAYOS_INVALID_AMOUNT" };
  }

  if (!isPayosLive()) {
    return { ok: true, data: simulatedLink(input, description) };
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://satarobo.vn").replace(/\/+$/, "");
  const returnUrl = input.returnUrl ?? `${base}/thanh-toan/ket-qua`;
  const cancelUrl = input.cancelUrl ?? `${base}/thanh-toan/huy`;
  const amount = Math.round(input.amount);

  const signature = signCreatePayload(
    { amount, cancelUrl, description, orderCode: input.orderCode, returnUrl },
    payosChecksumKey(),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(CREATE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": readEnv("PAYOS_CLIENT_ID"),
        "x-api-key": readEnv("PAYOS_API_KEY"),
      },
      body: JSON.stringify({
        orderCode: input.orderCode,
        amount,
        description,
        cancelUrl,
        returnUrl,
        ...(input.expiresAt ? { expiredAt: Math.floor(input.expiresAt.getTime() / 1000) } : {}),
        signature,
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as {
      code?: string;
      desc?: string;
      data?: Record<string, unknown> | null;
    } | null;

    if (!json || json.code !== "00" || !json.data) {
      return { ok: false, error: `PAYOS_ERR_${json?.code ?? res.status}:${json?.desc ?? "unknown"}` };
    }
    const d = json.data;
    const str = (k: string): string | null => (typeof d[k] === "string" ? (d[k] as string) : null);
    return {
      ok: true,
      data: {
        simulated: false,
        providerOrderCode: Number(d.orderCode ?? input.orderCode),
        checkoutUrl: str("checkoutUrl") ?? "",
        qrContent: str("qrCode") ?? "",
        paymentLinkId: str("paymentLinkId"),
        accountNumber: str("accountNumber"),
        accountName: str("accountName"),
        bin: str("bin"),
        amount,
        description,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "PAYOS_FETCH_FAILED" };
  } finally {
    clearTimeout(timer);
  }
}
