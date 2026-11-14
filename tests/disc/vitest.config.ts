/**
 * Cấu hình vitest RIÊNG cho bộ QA DISC (tests/disc). Lý do: `vitest.config.ts` gốc có `include`
 * là bộ lọc CỨNG và chưa khai `tests/disc/**` (việc của Lead — xem handoff). Cho tới khi đó:
 *   pnpm exec vitest run -c tests/disc/vitest.config.ts
 * Không đụng DB, không đọc đồng hồ thật, không gọi mạng.
 */
import path from "node:path";
import { defineConfig } from "vitest/config";

const goc = path.resolve(__dirname, "..", "..");

export default defineConfig({
  root: goc,
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/disc/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "tests/disc/_cay-tam/**"],
  },
  resolve: {
    alias: {
      "@": goc,
      "server-only": path.resolve(goc, "tests/stubs/server-only.ts"),
    },
  },
});
