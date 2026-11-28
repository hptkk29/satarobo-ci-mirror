/**
 * Bộ giới hạn đăng nhập DÙNG CHUNG ở kênh WEB (B4; mã ca: GHE). Đi qua endpoint thật của Auth.js (`/api/auth/callback/credentials`) nên chạm đúng `authorize()` của `lib/auth.ts`.
 *
 * CHỈ chạy khi máy chủ test được dựng với cờ BẬT:   LOGIN_LIMITER_V2=true pnpm exec playwright test -c playwright.a0.config.ts tests/e2e/a0/gioi-han-dang-nhap-v2.spec.ts
 * (cờ TẮT ⇒ skip; đường cũ được các spec đăng nhập có sẵn bảo vệ — chạy chúng với cờ TẮT *và* BẬT để so trước/sau.)
 * Mỗi lượt dùng một APIRequestContext MỚI (không dính cookie) và header IP riêng của giàn thử (`x-e2e-client-ip`, chỉ có tác dụng ngoài production).
 */
import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

import { HEADER_IP_E2E } from "../../../lib/security/client-ip";
import { kiemTruocDangNhap } from "../../../lib/security/gioi-han-dang-nhap/cong";
import { resetDb, seedUser } from "../_helpers/seed";
import { testEmail, TEST_PASSWORD } from "../_helpers/fixtures";

const BAT = process.env.LOGIN_LIMITER_V2 === "true";
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const EMAIL = testEmail("ghe-user");

/** Một lượt đăng nhập qua API thật: true ⇔ máy chủ cấp cookie phiên. */
async function dangNhap(ip: string, identifier: string, password: string): Promise<boolean> {
  const ctx: APIRequestContext = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { [HEADER_IP_E2E]: ip } });
  try {
    const csrf = (await (await ctx.get("/api/auth/csrf")).json()) as { csrfToken: string };
    await ctx.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, identifier, password, json: "true", callbackUrl: `${BASE}/` } });
    const cookies = (await ctx.storageState()).cookies;
    return cookies.some((c) => /session-token/.test(c.name));
  } finally {
    await ctx.dispose();
  }
}

test.describe("[GHE] giới hạn đăng nhập dùng chung — kênh web", () => {
  test.skip(!BAT, "cần máy chủ dựng với LOGIN_LIMITER_V2=true");
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    await resetDb(); // xoá cả AuthAttemptCounter
    await seedUser({ email: EMAIL, role: "SUPER_ADMIN" });
  });

  test("[GHE-01] đối chứng: đúng mật khẩu ⇒ có phiên", async () => {
    expect(await dangNhap("10.91.0.1", EMAIL, TEST_PASSWORD)).toBe(true);
  });

  test("[GHE-02] không khoá nhầm: 5 lượt sai từ IP X ⇒ lượt 6 (kể cả ĐÚNG) bị chặn; nạn nhân từ IP Y đăng nhập đúng ⇒ vào", async () => {
    for (let i = 0; i < 5; i++) expect(await dangNhap("10.91.1.1", EMAIL, "sai-mat-khau")).toBe(false);
    expect(await dangNhap("10.91.1.1", EMAIL, TEST_PASSWORD)).toBe(false); // bị chặn dù mật khẩu đúng
    expect(await dangNhap("10.91.1.2", EMAIL, TEST_PASSWORD)).toBe(true); // IP khác vào được
  });

  test("[GHE-03] lượt ĐÚNG được hoàn lại: 12 lần đăng nhập đúng liên tiếp (cùng email, cùng IP) đều vào — bộ cũ chặn ở lượt thứ 6 (5/phút/định danh)", async () => {
    for (let i = 0; i < 12; i++) expect(await dangNhap("10.91.2.1", EMAIL, TEST_PASSWORD)).toBe(true);
  });

  test("[GHE-04] KÊNH CHUNG: 3 lượt đặt chỗ từ MOBILE + 2 lượt sai ở WEB cùng (định danh, IP) ⇒ lượt kế ở web bị chặn dù ĐÚNG", async () => {
    for (let i = 0; i < 3; i++) expect((await kiemTruocDangNhap("mobile", "10.91.3.1", EMAIL)).cho).toBe(true);
    for (let i = 0; i < 2; i++) expect(await dangNhap("10.91.3.1", EMAIL, "sai-mat-khau")).toBe(false);
    expect(await dangNhap("10.91.3.1", EMAIL, TEST_PASSWORD)).toBe(false);
  });

  // [GHE-05 đã GỠ] giả `X-Forwarded-For` KHÔNG kiểm được ở máy chủ dev của giàn thử: nền tảng "may-dev" tin XFF do client gửi (chỉ nền tảng sau proxy mới lấy phần tử CUỐI do Caddy đặt).
  // Khả năng chống giả header của bộ giới hạn được khoá ở `[GHD-08]` (môi trường production, `ipChoRateLimit`) và `[CIP-03/05]`.
});
