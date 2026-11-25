import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// Cô lập hàm crypto khỏi db/ingest (chỉ test verifyMetaSignature).
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("./ingest", () => ({ ingestLead: vi.fn() }));

import { verifyMetaSignature, verifyWebhookSecret } from "./webhook";

const RAW = JSON.stringify({ object: "page", entry: [{ id: "1", time: 1 }] });

function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyMetaSignature (X-Hub-Signature-256)", () => {
  const orig = process.env.META_APP_SECRET;
  afterEach(() => {
    if (orig === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = orig;
    vi.restoreAllMocks();
  });

  it("nguồn không phải Meta → luôn ok (không áp dụng chữ ký)", () => {
    process.env.META_APP_SECRET = "whatever";
    expect(verifyMetaSignature("zalo", RAW, null).ok).toBe(true);
    expect(verifyMetaSignature("google-form", RAW, "sha256=bad").ok).toBe(true);
  });

  it("chưa cấu hình secret → stub: ok kèm cảnh báo", () => {
    delete process.env.META_APP_SECRET;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(verifyMetaSignature("facebook", RAW, null).ok).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("có secret + chữ ký đúng → ok", () => {
    const secret = "stub_app_secret_32_hex_placeholder";
    process.env.META_APP_SECRET = secret;
    expect(verifyMetaSignature("facebook", RAW, sign(secret, RAW)).ok).toBe(true);
  });

  it("có secret nhưng thiếu header → từ chối (missing-signature)", () => {
    process.env.META_APP_SECRET = "secret";
    const r = verifyMetaSignature("facebook", RAW, null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing-signature");
  });

  it("chữ ký sai (sai secret) → từ chối (signature-mismatch)", () => {
    process.env.META_APP_SECRET = "real_secret";
    const r = verifyMetaSignature("facebook", RAW, sign("wrong_secret", RAW));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("signature-mismatch");
  });

  it("body bị sửa 1 byte sau khi ký → từ chối", () => {
    const secret = "real_secret";
    process.env.META_APP_SECRET = secret;
    const goodSig = sign(secret, RAW);
    const tampered = RAW.replace('"page"', '"PAGE"');
    expect(verifyMetaSignature("facebook", tampered, goodSig).ok).toBe(false);
  });
});

describe("[R7-00-AC3] webhook fail-CLOSED khi thiếu secret trên production", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("verifyMetaSignature: prod + thiếu META_APP_SECRET → từ chối (missing-secret)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("META_APP_SECRET", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = verifyMetaSignature("facebook", RAW, null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing-secret");
    expect(err).toHaveBeenCalled();
  });

  it("verifyWebhookSecret: prod + thiếu WEBHOOK_FACEBOOK_SECRET → từ chối (missing-secret)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEBHOOK_FACEBOOK_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const req = new Request("https://x.test/api/public/webhook/facebook");
    const r = verifyWebhookSecret("facebook", req);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing-secret");
  });

  it("dev/test: thiếu secret → stub ok (không chặn local)", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WEBHOOK_FACEBOOK_SECRET", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = new Request("https://x.test/api/public/webhook/facebook");
    expect(verifyWebhookSecret("facebook", req).ok).toBe(true);
  });
});
