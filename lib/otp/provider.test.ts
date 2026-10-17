import { beforeEach, describe, expect, it, vi } from "vitest";

// (server-only được alias sang stub rỗng trong vitest.config.ts)

vi.mock("@/lib/zalo/otp-provider", () => ({
  zaloOtpProvider: { channel: "ZALO", name: "zalo-zns", send: vi.fn() },
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn(async () => ({ ok: true })),
}));

import { getOtpProviderFor, emailOtpProvider } from "./provider";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("[AUTH-SDT-P4] getOtpProviderFor — chọn theo LOẠI target (QĐ-5), không theo env", () => {
  it("email → provider EMAIL (Resend)", () => {
    expect(getOtpProviderFor("ph@example.com")).toBe(emailOtpProvider);
  });

  it("SĐT mọi cách gõ → provider ZALO", () => {
    for (const t of ["84905123456", "0905123456", "+84 905 123 456"]) {
      expect(getOtpProviderFor(t)?.channel).toBe("ZALO");
    }
  });

  it("OTP_PRIMARY_PROVIDER không còn tác dụng (trước đây bị nuốt im lặng)", () => {
    vi.stubEnv("OTP_PRIMARY_PROVIDER", "email");
    expect(getOtpProviderFor("0905123456")?.channel).toBe("ZALO");
  });

  it("AUTH_ZNS_DEGRADED=true → SĐT trả null (break-glass), email KHÔNG bị ảnh hưởng", () => {
    vi.stubEnv("AUTH_ZNS_DEGRADED", "true");
    expect(getOtpProviderFor("0905123456")).toBeNull();
    expect(getOtpProviderFor("ph@example.com")).toBe(emailOtpProvider);
  });
});
