/**
 * Playwright config EL-07 (khu đào tạo nội bộ) — BROWSER + auth thật, Postgres LOCAL (.env.test).
 *
 * Chép khuôn `playwright.teacher.config.ts`, khác đúng ba chỗ:
 *   1. `testDir` trỏ `tests/e2e/elearning`
 *   2. Cổng riêng 3141 (teacher đang giữ 3131, dev server ở 3100) — đổi qua ELEARNING_E2E_PORT
 *   3. Bơm `ELEARNING_ENABLED=true` cho server, vì cờ mặc định OFF (`lib/flags.ts`,
 *      `=== "true"`). Không bơm thì host e-learning bounce về admin và 0 byte HTML
 *      e-learning được phục vụ — test sẽ đỏ vì lý do sai.
 *
 *   pnpm test:e2e:elearning
 *
 * ELEARNING_SKIP_WEBSERVER=1 → dùng server ngoài (phải tự bật với ELEARNING_ENABLED=true).
 *
 * ⚠️ Cấu hình này chỉ có tác dụng khi job CI `e2e-elearning` gọi nó. Repo đang có 15 file
 * `playwright.*.config.ts` mà CI chỉ gọi 5 — 10 cấu hình chết, viết đúng vẫn không ai chạy.
 * Xem `.github/workflows/ci.yml` job `e2e-elearning`.
 */
import { defineConfig, devices } from "@playwright/test";
import { napEnvTest } from "./tests/e2e/_helpers/nap-env";

napEnvTest("elearning");

const PORT = process.env.ELEARNING_E2E_PORT ?? "3141";
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e/elearning",
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
    // Giữ nguyên hai dòng này: TS-18 (múi giờ, hạn chót 17:00) treo vào đúng chúng.
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },

  projects: [{ name: "elearning", use: { ...devices["Desktop Chrome"] } }],

  webServer: process.env.ELEARNING_SKIP_WEBSERVER
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
          // Cờ ON — thiếu thì host e-learning bounce về admin (2-phase, mặc định OFF).
          ELEARNING_ENABLED: "true",
        },
      },
});
