/**
 * Playwright config UAT Nguồn — chạy THẬT vào https://test.satarobo.vn bằng tài khoản `uat.*`.
 * KHÔNG dựng webServer, KHÔNG đụng DB: bộ này chỉ nói chuyện với giao diện qua HTTPS.
 *
 *   UAT_BASE_URL=https://test.satarobo.vn UAT_PASSWORD=… \
 *     pnpm exec playwright test -c playwright.uat-nguon.config.ts [tệp-lọc]
 *
 * Chạy bằng workflow `.github/workflows/uat-nguon-test.yml` (secret UAT_PASSWORD). Hướng dẫn: docs/source-commission/closeout/uat-harness.md.
 *
 * ── An toàn ──
 *  · `moiTruongTuEnv` NÉM nếu địa chỉ không phải đúng `https://test.satarobo.vn` ⇒ lượt chạy dừng ngay lúc nạp cấu hình. Cờ `UAT_MAY_DEV=1` (chỉ cho
 *    người viết bộ này chạy thử trên localhost) mở đúng `localhost`/`127.0.0.1`; workflow không bao giờ đặt nó.
 *  · `workers: 1`, `retries: 0`: đăng nhập bị giới hạn 10 lượt/phút/IP — chạy song song hay thử lại là tự khoá mình, và thử lại một ca ghi dữ liệu
 *    sẽ tạo bản ghi thứ hai.
 *  · trace/screenshot/video của Playwright TẮT ở mức cấu hình: bộ này tự bật trace SAU khi đăng nhập (xem tests/uat-nguon/_lib/phien.ts) để
 *    mật khẩu không vào tệp trace, và tự chụp ảnh vào thư mục bằng chứng.
 */
import { defineConfig, devices } from "@playwright/test";
import { maDotChay, moiTruongTuEnv } from "./tests/uat-nguon/_lib/an-toan";

const env = moiTruongTuEnv(process.env);
// Một mã đợt cho CẢ lượt chạy (worker bị khởi động lại sau ca đỏ vẫn thừa kế được).
process.env.UAT_RUN_CODE = maDotChay(process.env.UAT_RUN_CODE, Date.now());

export default defineConfig({
  testDir: "./tests/uat-nguon",
  testMatch: /.*\.uat\.ts$/,
  tsconfig: "./tsconfig.playwright.json",
  outputDir: "./test-results-uat-nguon",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: `${process.env.UAT_EVIDENCE_DIR?.trim() || "uat-evidence"}/_playwright.json` }],
    ["./tests/uat-nguon/_lib/bao-cao-tong-ket.ts"],
  ],
  use: {
    baseURL: env.origin,
    trace: "off",
    screenshot: "off",
    video: "off",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },
  projects: [{ name: "uat-nguon", use: { ...devices["Desktop Chrome"] } }],
});
