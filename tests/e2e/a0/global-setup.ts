/**
 * A0-00 — Global setup cho suite e2e A0.
 * Apply schema lên DB test LOCAL (prisma migrate deploy) trước khi chạy spec.
 * .env.test đã được nạp ở đầu playwright.a0.config.ts.
 */
import { execSync } from "node:child_process";
import { assertTestDb } from "../_helpers/seed";

export default function globalSetup(): void {
  assertTestDb(); // chặn nếu DATABASE_URL không trỏ DB test local
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: process.env,
  });
}
