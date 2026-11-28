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

// Các spec có dữ liệu thật và chụp ảnh (`chup`) — dùng cho các project `anh-*`.
const ANH_SPEC = /(cham-bai-tap|cham-thi|muc-danh-gia|bao-cao-r4|bao-cao-r5|bao-cao-r7|de-thi|kho-cau-hoi|khung-cham|nguoi-hoc|tu-dong-hoa|online-qo|online-nhap|online-qo-v95)\.spec\.ts/;

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

  // Ba project (kế hoạch thiết kế lại 17/11/2026, P0): `nen-giao-dien.spec.ts` chạy ở HAI project riêng — điện thoại 375px
  // (sáng) và tối (`colorScheme: "dark"` ⇒ chế độ "Hệ thống"). Các spec cũ chỉ chạy ở project `elearning`: không nhân ba thời
  // gian CI cho những ca không phụ thuộc kích thước/giao diện.
  projects: [
    { name: "elearning", testIgnore: /nen-giao-dien\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "elearning-mobile",
      testMatch: /(nen-giao-dien|nv-p2|nv-p3|nv-p4|qt-p5a|cau-so|huong-dan|online-qo|online-nhap|online-qo-v95|nguoi-hoc|tu-dong-hoa|cham-bai-tap|cham-thi|muc-danh-gia|bao-cao-r4|bao-cao-r5|bao-cao-r7|de-thi|kho-cau-hoi|khung-cham|chung-nhan-mau|chung-nhan-tab)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 800 } },
    },
    {
      name: "elearning-dark",
      testMatch: /(nen-giao-dien|nv-p2|nv-p3|nv-p4|qt-p5a|cau-so|huong-dan)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
    // Ảnh NGHIỆM THU hình ảnh (VISUAL-AUDIT.md §6): cùng spec có dữ liệu thật, chụp ở bốn cấu hình. CHỈ bật khi `ELEARNING_ANH=1` — không chạy trong CI thường.
    ...(process.env.ELEARNING_ANH
      ? (
          [
            ["anh-1440", { viewport: { width: 1440, height: 900 } }],
            ["anh-834", { viewport: { width: 834, height: 1112 } }],
            ["anh-390", { viewport: { width: 390, height: 844 } }],
            ["anh-dark-1440", { viewport: { width: 1440, height: 900 }, colorScheme: "dark" as const }],
          ] as const
        ).map(([name, opt]) => ({ name, testMatch: ANH_SPEC, use: { ...devices["Desktop Chrome"], ...opt } }))
      : []),
  ],

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
          // ⚠️ PHẢI đặt CẢ `AUTH_URL` [V9.4 P1, EL-01]. `next-auth/lib/env.js` đọc `process.env.AUTH_URL ?? process.env.NEXTAUTH_URL` để GHI ĐÈ origin của
          // request; `.env.local` của máy dev khai `AUTH_URL=http://localhost:3000` nên chỉ đặt `NEXTAUTH_URL` là vô hiệu — mọi redirect của `proxy.ts`
          // (đá người chưa đăng nhập về /login) rơi sang cổng 3000 và EL-01 đỏ với ERR_CONNECTION_REFUSED ở bất kỳ cổng nào khác. CI không có `.env.local`
          // nên không thấy.
          AUTH_URL: BASE,
          NEXT_PUBLIC_APP_URL: BASE,
          // Cờ ON — thiếu thì host e-learning bounce về admin (2-phase, mặc định OFF).
          ELEARNING_ENABLED: "true",
          // E-learning ONLINE (ADR 0005): cờ riêng, mặc định OFF — bật cho bộ e2e `online-qo.spec.ts`.
          ELEARNING_ONLINE_ENABLED: "true",
          // Mức gắn đánh giá (EL-21): cờ riêng, mặc định OFF ⇒ màn 404 — bật cho bộ e2e `muc-danh-gia.spec.ts` (P8).
          ELEARNING_EVAL_LINK_ENABLED: "true",
        },
      },
});
