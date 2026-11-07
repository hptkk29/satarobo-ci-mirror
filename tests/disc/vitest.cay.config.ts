/**
 * Cấu hình vitest CHỈ cho bản sao tạm của harness cấy lỗi (tests/disc/cay-loi/cay-loi.mjs).
 * Harness dựng `tests/disc/_cay-tam/` rồi XOÁ ngay sau khi chạy; cấu hình thường (vitest.config.ts)
 * loại thư mục đó ra nên bản sao cấy lỗi không bao giờ lọt vào lượt chạy bình thường.
 */
import path from "node:path";
import { defineConfig } from "vitest/config";

const goc = path.resolve(__dirname, "..", "..");

export default defineConfig({
  root: goc,
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/disc/_cay-tam/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": goc,
      "server-only": path.resolve(goc, "tests/stubs/server-only.ts"),
    },
  },
});
