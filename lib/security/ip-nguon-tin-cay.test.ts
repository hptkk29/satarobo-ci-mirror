// @vitest-environment node
// lib/security/ip-nguon-tin-cay.test.ts — IP nguồn FAIL-CLOSED cho allowlist IP.
// Các ca dời nguyên từ `lib/agents/gateway/ho-tro.test.ts` ([AG-IP-01], [AG-IP-VPS]) khi gỡ
// Cổng dữ liệu agent 02/10/2026 — webhook tổng đài (OmiCall) từng dùng nó, đã gỡ 06/10/2026 ⇒ hiện chưa có nơi gọi ngoài test.
import { describe, it, expect } from "vitest";
import { chuanHoaIp, ipNguonTinCay } from "./ip-nguon-tin-cay";

const hdr = (o: Record<string, string>) => new Headers(o);

describe("[IPT-01] IP nguồn cho allowlist — fail closed, không tin header client", () => {
  const VERCEL = { VERCEL: "1", VERCEL_ENV: "preview" };
  it("trên Vercel CHỈ tin x-vercel-forwarded-for", () => {
    expect(ipNguonTinCay(hdr({ "x-vercel-forwarded-for": "203.0.113.7" }), VERCEL)).toBe("203.0.113.7");
  });
  it("trên Vercel: x-forwarded-for / x-real-ip / x-e2e-client-ip GIẢ bị bỏ qua ⇒ null (từ chối)", () => {
    expect(
      ipNguonTinCay(
        hdr({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.7", "x-e2e-client-ip": "203.0.113.7" }),
        VERCEL,
      ),
    ).toBeNull();
  });
  it("ngoài Vercel: nhận x-e2e-client-ip rồi phần tử CUỐI của XFF", () => {
    expect(ipNguonTinCay(hdr({ "x-e2e-client-ip": "10.0.0.1" }), {})).toBe("10.0.0.1");
    expect(ipNguonTinCay(hdr({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }), {})).toBe("203.0.113.7");
    expect(ipNguonTinCay(hdr({}), {})).toBeNull();
  });
  it("chuẩn hoá: IPv4 ánh xạ IPv6, chữ hoa IPv6; rác ⇒ null", () => {
    expect(chuanHoaIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(chuanHoaIp(" 2001:DB8::1 ")).toBe("2001:db8::1");
    expect(chuanHoaIp("999.1.1.1")).toBeNull();
    expect(chuanHoaIp("01.1.1.1")).toBeNull();
    expect(chuanHoaIp("abc")).toBeNull();
  });
});

// Hạ tầng đổi 28/09/2026: prod + test chạy `next start` trên VPS, SAU MỘT proxy Caddy. Caddy NỐI
// IP khách vào CUỐI X-Forwarded-For và để nguyên mọi header khác do khách gửi — kể cả
// `x-vercel-forwarded-for` và `x-e2e-client-ip`. Prod VPS vẫn đặt VERCEL_ENV=production nên
// VERCEL_ENV KHÔNG còn nghĩa "đang ở Vercel".
describe("[IPT-VPS] IP nguồn trên VPS sau Caddy — chỉ phần tử CUỐI của XFF", () => {
  const VPS_PROD = { VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", NODE_ENV: "production" };
  const VPS_TEST = { NODE_ENV: "production" };
  it("[IPT-VPS-01] prod VPS (VERCEL_ENV=production, không VERCEL=1): lấy phần tử CUỐI của XFF", () => {
    expect(ipNguonTinCay(hdr({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }), VPS_PROD)).toBe("203.0.113.7");
    expect(ipNguonTinCay(hdr({ "x-forwarded-for": "203.0.113.7" }), VPS_TEST)).toBe("203.0.113.7");
  });
  it("[IPT-VPS-02] header khách tự gửi (x-vercel-forwarded-for, x-e2e-client-ip, x-real-ip) KHÔNG được tin", () => {
    for (const env of [VPS_PROD, VPS_TEST]) {
      const gia = { "x-vercel-forwarded-for": "10.9.9.9", "x-e2e-client-ip": "10.9.9.9", "x-real-ip": "10.9.9.9" };
      expect(ipNguonTinCay(hdr({ ...gia, "x-forwarded-for": "10.9.9.9, 203.0.113.7" }), env)).toBe("203.0.113.7");
      // Không có XFF (không đi qua Caddy) ⇒ không xác định được ⇒ từ chối, KHÔNG rơi về header giả.
      expect(ipNguonTinCay(hdr(gia), env)).toBeNull();
    }
  });
  it("[IPT-VPS-03] đối chứng: CI (next start + CI=true) và máy dev vẫn nhận x-e2e-client-ip", () => {
    expect(ipNguonTinCay(hdr({ "x-e2e-client-ip": "10.0.0.1" }), { NODE_ENV: "production", CI: "true" })).toBe("10.0.0.1");
    expect(ipNguonTinCay(hdr({ "x-e2e-client-ip": "10.0.0.1" }), { NODE_ENV: "test" })).toBe("10.0.0.1");
  });
});
