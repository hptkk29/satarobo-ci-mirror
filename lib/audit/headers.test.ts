// lib/audit/headers.test.ts — IP trong NHẬT KÝ + khoá chặn OTP đi qua CÙNG luật chọn header.
//
// `getRequestMetadata()` nuôi hai thứ: cột `ip` của AuditLog và khoá chặn tần suất OTP ở
// `/quen-mat-khau` + `/kich-hoat` (`otp:reset:ip:<ip>`). Bản cũ lấy phần tử ĐẦU của
// `x-forwarded-for` — phần tử do KHÁCH viết ⇒ mỗi lượt một IP giả ⇒ trần OTP theo IP vô dụng
// (mỗi tin OTP là tiền thật), và nhật ký ghi IP do kẻ tấn công chọn.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let hienTai = new Headers();
vi.mock("next/headers", () => ({ headers: async () => hienTai }));

import { getRequestMetadata } from "./headers";

beforeEach(() => {
  // Môi trường VPS thật: NODE_ENV=production, không VERCEL=1, không CI.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("CI", "");
  vi.stubEnv("VERCEL_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[AUD-IP] getRequestMetadata dùng luật IP dùng chung", () => {
  it("[AUD-IP-01] lấy phần tử CUỐI của XFF, không phải phần tử đầu do khách viết", async () => {
    hienTai = new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9", "user-agent": "UA" });
    const m = await getRequestMetadata();
    expect(m.ip).toBe("203.0.113.9");
    expect(m.userAgent).toBe("UA");
  });

  it("[AUD-IP-02] trên VPS, x-real-ip / x-vercel-forwarded-for do khách gửi KHÔNG vào nhật ký", async () => {
    hienTai = new Headers({ "x-real-ip": "10.9.9.9", "x-vercel-forwarded-for": "10.9.9.8" });
    const m = await getRequestMetadata();
    expect(m.ip).toBeUndefined();
  });

  it("[AUD-IP-03] kẻ tấn công đổi phần tử đầu XFF mỗi lượt ⇒ IP ghi nhận KHÔNG đổi", async () => {
    const thay = new Set<string | undefined>();
    for (let i = 1; i <= 10; i += 1) {
      hienTai = new Headers({ "x-forwarded-for": `10.0.0.${i}, 203.0.113.9` });
      thay.add((await getRequestMetadata()).ip);
    }
    expect([...thay]).toEqual(["203.0.113.9"]);
  });

  it("[AUD-IP-04] đối chứng: không header ⇒ ip undefined, KHÔNG ném (nhật ký không được làm sập request)", async () => {
    hienTai = new Headers();
    await expect(getRequestMetadata()).resolves.toEqual({ ip: undefined, userAgent: undefined });
  });
});
