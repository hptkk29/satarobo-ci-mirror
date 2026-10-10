/**
 * Playwright config RIÊNG cho Phase A0 (tests/e2e/a0).
 *
 * Tách khỏi playwright.config.ts (smoke) vì A0 chạy trên Postgres LOCAL (.env.test),
 * còn smoke chạy trên DB seed của CI. webServer dev/start ở đây kế thừa env test
 * → app dùng đúng DB test, không đụng Supabase.
 *
 *   pnpm db:test:up && pnpm test:e2e:a0
 */
import { defineConfig, devices } from "@playwright/test";
import { napEnvTest } from "./tests/e2e/_helpers/nap-env";

// Nạp .env.test TRƯỚC mọi thứ — workers + webServer kế thừa process.env này.
napEnvTest("a0");

// Cổng web server đọc từ `E2E_PORT` (01/10/2026): CI chạy trên runner tự host — hai runner
// CHUNG một máy VPS — nên mỗi job xin một cổng trống rồi ghi vào biến này. Máy dev không đặt
// biến ⇒ giữ cổng cũ.
const A0_PORT = process.env.E2E_PORT ?? "3100";

export default defineConfig({
  testDir: "./tests/e2e/a0",
  globalSetup: "./tests/e2e/a0/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 2 : 0,
  workers: 1, // serial: nhiều spec share resetDb/seed chung 1 DB test
  // ⚠️ `["line"]` KHÔNG phải để cho đẹp — nó là thứ duy nhất PHÁT TIẾN TRÌNH trong lúc
  // chạy [21/09/2026]. `html` ghi lúc kết thúc, `github` chỉ in chú giải lúc kết thúc, nên
  // trước hôm nay một lượt CI treo để lại **đúng 0 dòng** về việc nó treo ở đâu: log nhảy
  // từ "Running N tests" thẳng tới "##[error]The operation was canceled" sau 15 phút im
  // lặng. Bốn job cần trình duyệt treo suốt từ 21/09 và không ai truy được vì lý do đó.
  //
  // `line` in một dòng cho MỖI ca xong — đủ để biết ca cuối cùng chạy là ca nào, và rẻ
  // (một dòng/ca, không phải log đầy).
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["github"], ["line"]]
    : [["html", { open: "never" }], ["list"]],

  // Cổng RIÊNG (3100) để KHÔNG đụng dev server thường (3000, có thể đang trỏ
  // Supabase) — tránh app dùng 1 DB còn resetDb dùng DB khác.
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${A0_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },

  projects: [
    { name: "a0", use: { ...devices["Desktop Chrome"] } },
  ],

  // A0_SKIP_WEBSERVER=1 → bỏ qua dựng Next (chạy nhanh nhóm test thuần-DB,
  // không cần browser). Mặc định vẫn dựng server cho test cần page (loginAs).
  webServer: process.env.A0_SKIP_WEBSERVER
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
        command: process.env.CI ? `node_modules/.bin/next start -p ${A0_PORT}` : `pnpm dev -p ${A0_PORT}`,
        url: `http://localhost:${A0_PORT}`,
        // Dựng server test mới với env test — KHÔNG tái dùng dev server có sẵn.
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          DATABASE_URL: process.env.DATABASE_URL ?? "",
          DIRECT_URL: process.env.DIRECT_URL ?? "",
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "",
          NEXTAUTH_URL: `http://localhost:${A0_PORT}`,
          NEXT_PUBLIC_APP_URL: `http://localhost:${A0_PORT}`,
        },
      },
});
