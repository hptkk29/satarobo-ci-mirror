/**
 * Playwright config Phase R7 (tests/e2e/r7) — Postgres LOCAL (.env.test).
 * Cùng cơ chế playwright.r6.config.ts; tái dùng global-setup (migrate deploy).
 *   pnpm test:e2e:r7
 * Mọi spec R7 test service/action trực tiếp (DB) → đặt R7_SKIP_WEBSERVER=1 bỏ dev server.
 */
import { defineConfig, devices } from "@playwright/test";
import { napEnvTest } from "./tests/e2e/_helpers/nap-env";

napEnvTest("r7");

export default defineConfig({
  testDir: "./tests/e2e/r7",
  tsconfig: "./tsconfig.playwright.json",
  globalSetup: "./tests/e2e/a0/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // Playwright tự dừng TRƯỚC trần job (30) ⇒ nó còn kịp in tóm tắt và ghi báo cáo.
  // Không có dòng này thì GitHub giết tiến trình giữa chừng, không tóm tắt, không artifact.
  //
  // 30/08/2026 — nới 25 → 28 phút. Bộ này phình thật, không phải runner chậm: mỗi lượt
  // TẠO LEAD nay đi qua `chiaChoLead` (transaction + advisory lock + sổ chia), mà R7
  // tạo lead ở rất nhiều ca. Lượt chạy 99195914814 đo được **339 xanh / 0 đỏ rồi bị
  // cắt ở đúng 1500s** — tức không có ca nào hỏng, chỉ hết giờ, và cái ✘ duy nhất in
  // ra là ca đang chạy dở lúc bị cắt (đọc nhầm thành lỗi thật rất dễ).
  //
  // 03/09/2026 — ĐÃ CẮT LÀM HAI SHARD (`--shard=N/2` trong ci.yml), nên trần này áp
  // cho MỘT NỬA bộ. Hạ 28 → 20 phút: nửa bộ mà vẫn chạy quá 20 phút thì đó là tín
  // hiệu thật sự cần nhìn, không phải chuyện nới thêm cho qua.
  //
  // Lần chạm trần thứ hai (lượt 100568411670) đo được 277 xanh / 0 đỏ rồi bị cắt ở
  // đúng 28,0 phút — "1 interrupted, 83 did not run". Cái ✘ duy nhất in ra là ca
  // đang chạy dở lúc bị cắt; đọc nhầm thành lỗi thật rất dễ, đã mất một vòng.
  globalTimeout: 20 * 60_000,
  // `list` CẢ Ở CI. Reporter cũ (html + github) không in gì trong lúc chạy, nên một lần
  // chạy XANH cũng im lặng 12 phút — và im lặng đó bị đọc nhầm thành "job treo", tốn
  // một vòng điều tra. Có `list` thì nhìn log biết đang ở test nào.
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },

  projects: [{ name: "r7", use: { ...devices["Desktop Chrome"] } }],

  webServer: process.env.R7_SKIP_WEBSERVER
    ? undefined
    : {
        // ⚠️ CI gọi THẲNG `next`, KHÔNG qua `pnpm` [21/09/2026].
        //
        // `pnpm start` đẻ ra chuỗi `sh → node(pnpm) → sh → next-server`. Playwright giết
        // NHÓM tiến trình của lệnh nó spawn, nhưng pnpm tách nhóm cho tiến trình con, nên
        // `next-server` SỐNG SÓT ⇒ lượt dọn webServer chờ cổng được nhả ⇒ **treo vĩnh
        // viễn**, và `onEnd` của reporter không bao giờ chạy (không có dòng "N passed").
        //
        // Đo 21/09 trên run 35619508725: cả BỐN job đều đứng im ở ca CUỐI rồi bị giết, và
        // GitHub phải tự dọn — `Terminate orphan process: … (next-server (v16.2.6))`,
        // **5 tiến trình mồ côi mỗi job**. Gọi thẳng `next` là một tiến trình, cùng nhóm,
        // chết chắc.
        //
        // ⚠️ Nhánh KHÔNG-CI giữ `pnpm dev`: trên Windows `node_modules/.bin/next` không
        // chạy được qua shell của Playwright (đã thử, exit 1) — và máy dev không có con
        // treo này vì người ta Ctrl-C.
        command: process.env.CI ? "node_modules/.bin/next start -p 3100" : "pnpm dev -p 3100",
        url: "http://localhost:3100",
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          DATABASE_URL: process.env.DATABASE_URL ?? "",
          DIRECT_URL: process.env.DIRECT_URL ?? "",
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "",
          NEXTAUTH_URL: "http://localhost:3100",
          NEXT_PUBLIC_APP_URL: "http://localhost:3100",
        },
      },
});
