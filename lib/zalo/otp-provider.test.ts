import { beforeEach, describe, expect, it, vi } from "vitest";

// (server-only được alias sang stub rỗng trong vitest.config.ts)

let templateId = "616128";
let znsResult: { ok: boolean; providerMessageId?: string; error?: string } = { ok: true };
const znsSendSpy = vi.fn(async () => znsResult);

vi.mock("@/lib/zalo/provider", () => ({
  znsProvider: { send: (...args: unknown[]) => znsSendSpy(...(args as [])) },
}));
vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async () => templateId),
}));

import { zaloOtpProvider, classifyZnsError, ZNS_ERROR_KEY } from "./otp-provider";

const INPUT = {
  target: "84905123456",
  code: "424242",
  purpose: "ACTIVATION" as const,
  minutesValid: 5,
};

beforeEach(() => {
  templateId = "616128";
  znsResult = { ok: true };
  znsSendSpy.mockClear();
});

describe("[AUTH-SDT-P4] zaloOtpProvider", () => {
  // Tên tham số là HỢP ĐỒNG với mẫu 616128 đã duyệt, không phải quy ước nội bộ:
  // gửi `code` bị Zalo trả -1122 "missing a parameter otp" (đo trên prod 31/07).
  it("gửi đúng template từ SystemSetting + params {otp, minutes} khớp mẫu đã duyệt", async () => {
    const r = await zaloOtpProvider.send(INPUT);
    expect(r.ok).toBe(true);
    expect(znsSendSpy).toHaveBeenCalledWith({
      toPhone: "84905123456",
      templateKey: "616128",
      params: { otp: "424242", minutes: 5 },
    });
  });

  it("setting template rỗng → ZNS_NO_TEMPLATE, KHÔNG gọi API", async () => {
    templateId = "";
    const r = await zaloOtpProvider.send(INPUT);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ZNS_NO_TEMPLATE");
    expect(znsSendSpy).not.toHaveBeenCalled();
  });

  it("ZNS lỗi -118 → error mở đầu bằng key ổn định, giữ chuỗi gốc để tra log", async () => {
    znsResult = { ok: false, error: "ZNS_ERR_-118:Account not exist" };
    const r = await zaloOtpProvider.send(INPUT);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ZNS_NO_ZALO_ACCOUNT:ZNS_ERR_-118:Account not exist");
  });
});

describe("[AUTH-SDT-P4] classifyZnsError — map đủ 6 mã trong kế hoạch", () => {
  it.each([
    [-118, "ZNS_NO_ZALO_ACCOUNT"],
    [-119, "ZNS_USER_UNREACHABLE"],
    [-133, "ZNS_QUIET_HOURS"],
    [-139, "ZNS_USER_REFUSED"],
    [-141, "ZNS_USER_REFUSED"],
    [-147, "ZNS_USER_LIMIT"],
  ])("mã %i → %s", (code, key) => {
    expect(classifyZnsError(`ZNS_ERR_${code}:x`)).toEqual({ code, key });
    expect(ZNS_ERROR_KEY[code]).toBe(key);
  });

  it("mã lạ / không parse được → ZNS_ERROR", () => {
    expect(classifyZnsError("ZNS_ERR_-999:new")).toEqual({ code: -999, key: "ZNS_ERROR" });
    expect(classifyZnsError("ZALO_NOT_CONFIGURED")).toEqual({ code: null, key: "ZNS_ERROR" });
    expect(classifyZnsError(undefined)).toEqual({ code: null, key: "ZNS_ERROR" });
  });
});
