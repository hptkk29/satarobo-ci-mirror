import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import {
  PAYOS_SIMULATED_PREFIX,
  buildCreateSignatureBase,
  createPaymentLink,
  generateProviderOrderCode,
  isPayosConfigured,
  isPayosLive,
  payosSortedQueryString,
  signCreatePayload,
  signPayosData,
  truncateDescription,
  verifyPayosSignature,
  verifyWebhookSignature,
} from "./payos";

// 03/08 — payOS: chữ ký + chế độ MÔ PHỎNG (chưa có credential thật).
// Mọi hàm ở đây THUẦN hoặc chỉ đọc env → test không cần mạng, không cần DB.

const ENV_KEYS = ["PAYOS_CLIENT_ID", "PAYOS_API_KEY", "PAYOS_CHECKSUM_KEY", "PAYOS_LIVE"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

function setCreds(live: boolean) {
  process.env.PAYOS_CLIENT_ID = "client-1";
  process.env.PAYOS_API_KEY = "api-1";
  process.env.PAYOS_CHECKSUM_KEY = "checksum-1";
  process.env.PAYOS_LIVE = live ? "true" : "false";
}

describe("cấu hình / công tắc live", () => {
  it("thiếu bất kỳ credential nào → chưa cấu hình → không live", () => {
    expect(isPayosConfigured()).toBe(false);
    expect(isPayosLive()).toBe(false);

    process.env.PAYOS_CLIENT_ID = "client-1";
    process.env.PAYOS_API_KEY = "api-1";
    expect(isPayosConfigured()).toBe(false); // còn thiếu checksum key
  });

  it("đủ credential nhưng PAYOS_LIVE≠true → vẫn MÔ PHỎNG", () => {
    setCreds(false);
    expect(isPayosConfigured()).toBe(true);
    expect(isPayosLive()).toBe(false);
  });

  it("đủ credential + PAYOS_LIVE=true → live", () => {
    setCreds(true);
    expect(isPayosLive()).toBe(true);
  });
});

describe("chữ ký tạo link", () => {
  it("chuỗi ký đúng thứ tự alphabet theo hợp đồng payOS", () => {
    expect(
      buildCreateSignatureBase({
        amount: 1_000_000,
        cancelUrl: "https://x.vn/huy",
        description: "SATA ORD1 DOT1",
        orderCode: 1756000000000123,
        returnUrl: "https://x.vn/ok",
      }),
    ).toBe(
      "amount=1000000&cancelUrl=https://x.vn/huy&description=SATA ORD1 DOT1" +
        "&orderCode=1756000000000123&returnUrl=https://x.vn/ok",
    );
  });

  it("signCreatePayload = HMAC-SHA256 của chuỗi đó", () => {
    const input = {
      amount: 500_000,
      cancelUrl: "c",
      description: "d",
      orderCode: 7,
      returnUrl: "r",
    };
    const expected = crypto
      .createHmac("sha256", "key-abc")
      .update(buildCreateSignatureBase(input))
      .digest("hex");
    expect(signCreatePayload(input, "key-abc")).toBe(expected);
  });

  it("mô tả bị cắt về giới hạn 25 ký tự của payOS", () => {
    expect(truncateDescription("  " + "A".repeat(40) + "  ")).toHaveLength(25);
  });
});

describe("chữ ký webhook (thuần)", () => {
  const data = {
    orderCode: 1756000000000123,
    amount: 1_000_000,
    description: "SATA-ORD1-DOT1",
    reference: "FT2508031234",
    virtualAccountNumber: null,
    currency: "VND",
  };

  it("sắp khoá alphabet, null → chuỗi rỗng, undefined bị loại", () => {
    const s = payosSortedQueryString({ b: 2, a: 1, z: null, u: undefined });
    expect(s).toBe("a=1&b=2&z=");
    expect(s).not.toContain("u=");
  });

  it("ký rồi kiểm lại → hợp lệ; đổi 1 ký tự → không hợp lệ", () => {
    const sig = signPayosData(data, "checksum-1");
    expect(verifyPayosSignature(data, sig, "checksum-1")).toBe(true);
    expect(verifyPayosSignature(data, sig.slice(0, -1) + "0", "checksum-1")).toBe(false);
    expect(verifyPayosSignature({ ...data, amount: 999 }, sig, "checksum-1")).toBe(false);
    expect(verifyPayosSignature(data, sig, "checksum-khac")).toBe(false);
  });

  it("chữ ký ngắn/dài khác nhau → false, không ném (timingSafeEqual)", () => {
    expect(verifyPayosSignature(data, "abc", "checksum-1")).toBe(false);
    expect(verifyPayosSignature(data, "", "checksum-1")).toBe(false);
    expect(verifyPayosSignature(null, "abc", "checksum-1")).toBe(false);
  });

  it("có checksum key (PROD) → bắt buộc chữ ký đúng", () => {
    setCreds(true);
    const sig = signPayosData(data, "checksum-1");
    expect(verifyWebhookSignature({ code: "00", data, signature: sig })).toEqual({
      ok: true,
      mode: "LIVE",
    });
    const bad = verifyWebhookSignature({ code: "00", data, signature: "sai" });
    expect(bad.ok).toBe(false);
  });

  it("chưa có checksum key → nhận payload MÔ PHỎNG, từ chối chữ ký không kiểm được", () => {
    expect(verifyWebhookSignature({ data })).toEqual({ ok: true, mode: "SIMULATED" });
    expect(
      verifyWebhookSignature({ data, signature: `${PAYOS_SIMULATED_PREFIX}abc` }),
    ).toEqual({ ok: true, mode: "SIMULATED" });
    expect(verifyWebhookSignature({ data, signature: "deadbeef" }).ok).toBe(false);
  });

  it("thiếu `data` → từ chối", () => {
    expect(verifyWebhookSignature({ code: "00", signature: "x" }).ok).toBe(false);
  });
});

describe("generateProviderOrderCode", () => {
  it("số nguyên dương, dưới trần MAX_SAFE_INTEGER", () => {
    const code = generateProviderOrderCode();
    expect(Number.isInteger(code)).toBe(true);
    expect(code).toBeGreaterThan(0);
    expect(code).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("thuần: cùng (now, rand) → cùng mã; khác khe → khác mã", () => {
    expect(generateProviderOrderCode(1_756_000_000_000, 0.123)).toBe(
      generateProviderOrderCode(1_756_000_000_000, 0.123),
    );
    expect(generateProviderOrderCode(1_756_000_000_000, 0.123)).not.toBe(
      generateProviderOrderCode(1_756_000_000_000, 0.456),
    );
  });

  it("1000 mã trong cùng mili-giây vẫn duy nhất theo khe", () => {
    const codes = new Set(
      Array.from({ length: 1000 }, (_, i) => generateProviderOrderCode(1_756_000_000_000, i / 1000)),
    );
    expect(codes.size).toBe(1000);
  });
});

describe("createPaymentLink — chế độ MÔ PHỎNG", () => {
  it("chưa cấu hình → trả payload giả có tiền tố SIMULATED-, KHÔNG gọi mạng", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await createPaymentLink({
      orderCode: 1_756_000_000_000_123,
      amount: 1_000_000,
      description: "SATA ORD1 DOT1",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.simulated).toBe(true);
    expect(res.data.providerOrderCode).toBe(1_756_000_000_000_123);
    expect(res.data.checkoutUrl).toContain(PAYOS_SIMULATED_PREFIX);
    expect(res.data.qrContent.startsWith(PAYOS_SIMULATED_PREFIX)).toBe(true);
  });

  it("có credential nhưng chưa bật live → vẫn mô phỏng (không đụng tiền thật)", async () => {
    setCreds(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await createPaymentLink({ orderCode: 12345, amount: 500_000, description: "d" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.ok && res.data.simulated).toBe(true);
  });

  it("orderCode/số tiền không hợp lệ → lỗi rõ ràng, không gọi mạng", async () => {
    const a = await createPaymentLink({ orderCode: 0, amount: 1000, description: "d" });
    expect(a.ok).toBe(false);
    const b = await createPaymentLink({ orderCode: 5, amount: 0, description: "d" });
    expect(b.ok).toBe(false);
  });

  it("live → POST đúng endpoint/header/chữ ký, đọc checkoutUrl + qrCode", async () => {
    setCreds(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "00",
          desc: "success",
          data: {
            orderCode: 999,
            checkoutUrl: "https://pay.payos.vn/web/abc",
            qrCode: "00020101021238...",
            paymentLinkId: "plink-1",
            accountNumber: "0123456789",
            accountName: "SATA ROBO",
            bin: "970415",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await createPaymentLink({
      orderCode: 999,
      amount: 1_000_000,
      description: "SATA ORD1 DOT1",
      returnUrl: "https://x.vn/ok",
      cancelUrl: "https://x.vn/huy",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.simulated).toBe(false);
    expect(res.data.checkoutUrl).toBe("https://pay.payos.vn/web/abc");
    expect(res.data.qrContent).toBe("00020101021238...");

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://api-merchant.payos.vn/v2/payment-requests");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-client-id"]).toBe("client-1");
    expect(headers["x-api-key"]).toBe("api-1");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.signature).toBe(
      signCreatePayload(
        {
          amount: 1_000_000,
          cancelUrl: "https://x.vn/huy",
          description: "SATA ORD1 DOT1",
          orderCode: 999,
          returnUrl: "https://x.vn/ok",
        },
        "checksum-1",
      ),
    );
  });

  it("live nhưng cổng trả mã lỗi → ok:false, không ném", async () => {
    setCreds(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "20", desc: "Invalid" }), { status: 200 }),
    );
    const res = await createPaymentLink({ orderCode: 9, amount: 1000, description: "d" });
    expect(res.ok).toBe(false);
  });
});
