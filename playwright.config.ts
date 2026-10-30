import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — Phase 5.1
 * Docs: https://playwright.dev/docs/test-configuration
 */
// Cổng web server đọc từ `E2E_PORT` (01/10/2026): CI chạy trên runner tự host — hai runner
// CHUNG một máy VPS — nên mỗi job xin một cổng trống rồi ghi vào biến này. Máy dev không đặt
// biến ⇒ giữ cổng cũ.
const CI_PORT = process.env.E2E_PORT ?? "3000";

export default defineConfig({
  testDir: "./tests/e2e",
  // Suite smoke CHỈ chạy smoke.spec.ts (top-level). Mọi phase suite (a0, r1..r7) có
  // config riêng (playwright.<phase>.config.ts): chạy trên Postgres LOCAL + dùng
  // tsconfig.playwright.json (stub `server-only`/`@/lib/auth`) + resetDb. Nếu để smoke
  // collect chúng → resetDb từ chối trên DB seed CI/Supabase + `server-only` không
  // resolve (thiếu stub) → lỗi collect. Loại toàn bộ phase dir khỏi suite smoke.
  // Phase suite (a0, r*, fl) có config riêng (playwright.<phase>.config.ts): Postgres
  // LOCAL + tsconfig.playwright.json (stub server-only) + globalSetup + workers 1.
  // Loại khỏi smoke (smoke không có setup/seed → fl service-spec sẽ fail; fl/* import
  // lib server-only không resolve). FL chạy ở playwright.fl.config.ts + job CI riêng.
  // `teacher/` = spec browser site GV, CHỈ chạy qua playwright.teacher.config.ts (cần
  // webServer với TEACHER_SITE_ENABLED=true). Smoke không có server đó → loại như phase dir.
  // `elearning/` = spec browser khu đào tạo nội bộ, CHỈ chạy qua
  // playwright.elearning.config.ts — bộ đó bơm ELEARNING_ENABLED=true, còn smoke chạy
  // cờ OFF (mặc định) nên cho chạy ở đây là test đỏ vì lý do sai.
  testIgnore: [
    "**/a0/**",
    "**/r[0-9]*/**",
    "**/fl/**",
    "**/crm/**",
    "**/teacher/**",
    "**/elearning/**",
  ],
  // Each test gets 30s timeout
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // CI gets retries, dev doesn't (faster iteration)
  retries: process.env.CI ? 2 : 0,
  // workers:1 — smoke-lms spec self-seed DB chung (resetDb + slug cố định) trong beforeAll;
  // chạy song song 2 project (chromium+mobile) → 2 beforeAll đồng thời → đụng unique slug.
  // Serial hoá để tránh (smoke nhỏ, không đáng song song).
  workers: 1,

  // Reporter
  // ⚠️ `["line"]` KHÔNG phải để cho đẹp — nó là thứ duy nhất PHÁT TIẾN TRÌNH trong lúc
  // chạy [21/09/2026]. `html` ghi lúc kết thúc, `github` chỉ in chú giải lúc kết thúc, nên
  // trước hôm nay một lượt CI treo để lại **đúng 0 dòng** về việc nó treo ở đâu: log nhảy
  // từ "Running N tests" thẳng tới "##[error]The operation was canceled" sau 15 phút im
  // lặng. Bốn job cần trình duyệt treo suốt từ 21/09 và không ai truy được vì lý do đó.
  //
  // `line` in một dòng cho MỖI ca xong — đủ để biết ca cuối cùng chạy là ca nào, và rẻ
  // (một dòng/ca, không phải log đầy).
  reporter: process.env.CI
    ? [["html"], ["github"], ["line"]]
    : [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Localize to Vietnamese
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },

  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  // Start dev server before tests (skip in CI — server already up from `pnpm build && pnpm start`)
  webServer: process.env.CI
    ? {
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
        command: `node_modules/.bin/next start -p ${CI_PORT}`,
        url: `http://localhost:${CI_PORT}`,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
