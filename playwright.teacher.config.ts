/**
 * Playwright config #06 (site giáo viên) — BROWSER + auth thật, Postgres LOCAL (.env.test).
 *
 * Khác các config phase khác: BẮT BUỘC dev server (không có *_SKIP_WEBSERVER mặc định)
 * và bơm `TEACHER_SITE_ENABLED=true` cho server — vì teacher layout gate 3 tầng, tầng 2
 * đá về /dashboard khi flag OFF (2-phase L5). Không có flag ON thì /teacher/* KHÔNG render.
 *
 *   pnpm exec playwright test -c playwright.teacher.config.ts
 *
 * Cổng riêng (3131) để KHÔNG đụng dev server đang chạy ở 3100. Đổi qua TEACHER_E2E_PORT.
 * TEACHER_SKIP_WEBSERVER=1 → dùng server ngoài (phải tự bật với TEACHER_SITE_ENABLED=true).
 */
import { defineConfig, devices } from "@playwright/test";
import { napEnvTest } from "./tests/e2e/_helpers/nap-env";

napEnvTest("teacher");

const PORT = process.env.TEACHER_E2E_PORT ?? "3131";
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e/teacher",
  tsconfig: "./tsconfig.playwright.json",
  globalSetup: "./tests/e2e/a0/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 2 : 0,
  workers: 1,
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

  use: {
    baseURL: process.env.BASE_URL ?? BASE,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },

  projects: [{ name: "teacher", use: { ...devices["Desktop Chrome"] } }],

  webServer: process.env.TEACHER_SKIP_WEBSERVER
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
        command: process.env.CI ? `node_modules/.bin/next start -p ${PORT}` : `pnpm dev -p ${PORT}`,
        url: `${BASE}/login`,
        reuseExistingServer: false,
        timeout: 240_000,
        env: {
          DATABASE_URL: process.env.DATABASE_URL ?? "",
          DIRECT_URL: process.env.DIRECT_URL ?? "",
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "",
          NEXTAUTH_URL: BASE,
          NEXT_PUBLIC_APP_URL: BASE,
          // L5 flag ON — nếu thiếu, teacher layout redirect /teacher/* → /dashboard.
          TEACHER_SITE_ENABLED: "true",
        },
      },
});
