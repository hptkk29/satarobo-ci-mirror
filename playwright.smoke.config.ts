// Smoke UI cho các flow fix LMS (messaging admin+portal, compliance). DB test local.
import { defineConfig, devices } from "@playwright/test";
import { napEnvTest } from "./tests/e2e/_helpers/nap-env";

napEnvTest("smoke");

export default defineConfig({
  testDir: "./tests/e2e/smoke-lms",
  globalSetup: "./tests/e2e/a0/global-setup.ts", // chỉ migrate deploy lên DB test
  timeout: 150_000,
  expect: { timeout: 25_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  },
  projects: [{ name: "smoke", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      DIRECT_URL: process.env.DIRECT_URL ?? "",
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "test-secret-smoke",
      NEXTAUTH_URL: "http://localhost:3100",
      NEXT_PUBLIC_APP_URL: "http://localhost:3100",
    },
  },
});
