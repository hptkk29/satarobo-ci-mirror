// lib/security/nen-tang.test.ts — app đang chạy trên nền tảng NÀO. THUẦN.
//
// Một câu hỏi, MỘT chỗ trả lời cho cả app (khoá chặn tần suất, IP nhật ký, IP nguồn fail-closed
// cho allowlist). Trước 28/09/2026 `client-ip.ts` hỏi "có `x-vercel-forwarded-for` không" — tức
// hỏi CHÍNH KHÁCH, vì trên VPS header đó do khách tự gửi.
import { describe, expect, it } from "vitest";

import { nenTangDangChay } from "./nen-tang";

describe("[NT] nhận diện nền tảng", () => {
  it("[NT-01] VERCEL=1 ⇒ vercel (Vercel đặt lúc chạy; VPS không đặt)", () => {
    expect(nenTangDangChay({ VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(
      "vercel",
    );
    expect(nenTangDangChay({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe("vercel");
  });

  it("[NT-02] prod VPS (VERCEL_ENV=production nhưng KHÔNG VERCEL=1) ⇒ sau-proxy, KHÔNG phải vercel", () => {
    // Prod VPS vẫn đặt VERCEL_ENV=production (robots.ts, cookie SSO — deploy/.env.example). Coi
    // nó là Vercel ⇒ tin `x-vercel-forwarded-for` mà khách tự gửi được.
    expect(
      nenTangDangChay({ VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", NODE_ENV: "production" }),
    ).toBe("sau-proxy");
  });

  it("[NT-03] test VPS (NODE_ENV=production, có hay không VERCEL_ENV) ⇒ sau-proxy", () => {
    expect(nenTangDangChay({ NODE_ENV: "production" })).toBe("sau-proxy");
    expect(nenTangDangChay({ NODE_ENV: "production", VERCEL_ENV: "test" })).toBe("sau-proxy");
  });

  it("[NT-04] đối chứng: CI (`next start` + CI) và máy dev ⇒ may-dev", () => {
    expect(nenTangDangChay({ NODE_ENV: "production", CI: "true" })).toBe("may-dev");
    expect(nenTangDangChay({ NODE_ENV: "development" })).toBe("may-dev");
    expect(nenTangDangChay({ NODE_ENV: "test" })).toBe("may-dev");
    expect(nenTangDangChay({})).toBe("may-dev");
  });
});
