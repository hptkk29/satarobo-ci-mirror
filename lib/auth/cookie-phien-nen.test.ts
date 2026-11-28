/**
 * [CPN-*] Quyết định "yêu cầu này có được làm mới cookie phiên không" (V9.4 P0). Hàm thuần — dây nối ở proxy.ts được ghim bằng [CPN-W*].
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { boDatCookiePhien, choPhepLamMoiCookiePhien, laDatCookiePhien } from "./cookie-phien-nen";

const dau = (pathname: string, secFetchMode: string | null, method = "GET") => ({ pathname, secFetchMode, method });

describe("[CPN-01] choPhepLamMoiCookiePhien", () => {
  it("điều hướng cấp cao ⇒ được làm mới (phiên vẫn trượt hạn khi người dùng mở trang)", () => {
    expect(choPhepLamMoiCookiePhien(dau("/elearning", "navigate"))).toBe(true);
  });
  it("không có Sec-Fetch-Mode (curl/Node/trình duyệt cũ) ⇒ được — giữ hành vi hiện tại, không đoán", () => {
    expect(choPhepLamMoiCookiePhien(dau("/elearning", null))).toBe(true);
  });
  it("yêu cầu nền: fetch/RSC/prefetch/SSE (cors · same-origin · no-cors) ⇒ KHÔNG", () => {
    for (const m of ["cors", "same-origin", "no-cors"]) {
      expect(choPhepLamMoiCookiePhien(dau("/elearning?_rsc=x", m))).toBe(false);
      expect(choPhepLamMoiCookiePhien(dau("/api/chat/stream", m))).toBe(false);
      expect(choPhepLamMoiCookiePhien(dau("/api/notifications/summary", m))).toBe(false);
    }
  });
  it("route xác thực (đăng nhập/đăng xuất/csrf/callback) ⇒ ĐƯỢC — chặn chúng là hỏng đăng nhập", () => {
    for (const p of ["/api/auth/signin/credentials", "/api/auth/signout", "/api/auth/csrf", "/api/auth/callback/credentials"]) {
      expect(choPhepLamMoiCookiePhien(dau(p, "same-origin", "POST"))).toBe(true);
    }
  });
  it("NGOẠI LỆ: GET /api/auth/session gọi nền (useSession) ⇒ KHÔNG — nó cũng là một đường hồi sinh phiên", () => {
    expect(choPhepLamMoiCookiePhien(dau("/api/auth/session", "same-origin", "GET"))).toBe(false);
    // đối chứng dương: cùng đường dẫn nhưng là điều hướng/không tiêu đề ⇒ được
    expect(choPhepLamMoiCookiePhien(dau("/api/auth/session", "navigate", "GET"))).toBe(true);
    expect(choPhepLamMoiCookiePhien(dau("/api/auth/session", null, "GET"))).toBe(true);
  });
});

describe("[CPN-02] laDatCookiePhien / boDatCookiePhien", () => {
  const dat = "authjs.session-token=eyJabc.def; Path=/; Expires=Sun, 21 Dec 2026 00:00:00 GMT; HttpOnly; SameSite=Lax";
  const datSecure = "__Secure-sr-test.session-token=AAA; Path=/; Domain=.satarobo.vn; HttpOnly; Secure";
  const manh = "authjs.session-token.1=BBB; Path=/; HttpOnly";
  const xoa = "authjs.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly";
  const khac = "authjs.csrf-token=zzz%7Chash; Path=/; HttpOnly";
  const callback = "authjs.callback-url=http%3A%2F%2Flocalhost; Path=/; HttpOnly";

  it("nhận ra dòng ĐẶT phiên (kể cả cookie có tiền tố môi trường và mảnh đánh số)", () => {
    expect(laDatCookiePhien(dat)).toBe(true);
    expect(laDatCookiePhien(datSecure)).toBe(true);
    expect(laDatCookiePhien(manh)).toBe(true);
  });
  it("lệnh XOÁ cookie phiên KHÔNG bị coi là đặt — đăng xuất phải còn hiệu lực", () => {
    expect(laDatCookiePhien(xoa)).toBe(false);
    expect(laDatCookiePhien("authjs.session-token=x; Max-Age=0; Path=/")).toBe(false);
  });
  it("cookie khác (csrf, callback-url, theme…) không bị đụng", () => {
    expect(laDatCookiePhien(khac)).toBe(false);
    expect(laDatCookiePhien(callback)).toBe(false);
  });
  it("boDatCookiePhien: chỉ gỡ dòng đặt phiên, giữ thứ tự các dòng còn lại", () => {
    expect(boDatCookiePhien([khac, dat, xoa, manh, callback])).toEqual([khac, xoa, callback]);
    expect(boDatCookiePhien([])).toEqual([]);
  });
});

describe("[CPN-W1] ghim dây nối ở proxy.ts (cổng thật là e2e XP-*, vì proxy chạy trong máy chủ)", () => {
  const nguon = readFileSync(resolve(process.cwd(), "proxy.ts"), "utf8").replace(/\r\n/g, "\n");
  const boChuThich = nguon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("proxy.ts xuất vỏ bọc `proxy` gọi Auth.js rồi mới dọn cookie — và dọn có ĐIỀU KIỆN cờ + hàm quyết định", () => {
    expect(boChuThich).toMatch(/const xuLyProxy = auth\(/);
    expect(boChuThich).toMatch(/export default async function proxy\(/);
    expect(boChuThich).toMatch(/isSessionCookieRefreshNavOnly\(\)/);
    expect(boChuThich).toMatch(/choPhepLamMoiCookiePhien\(/);
    expect(boChuThich).toMatch(/boDatCookiePhien\(/);
  });
  it("cờ mặc định TẮT (đổi chính sách xác thực cần Owner duyệt)", () => {
    const flags = readFileSync(resolve(process.cwd(), "lib/flags.ts"), "utf8");
    expect(flags).toMatch(/SESSION_COOKIE_REFRESH_NAV_ONLY === "true"/);
  });
});
