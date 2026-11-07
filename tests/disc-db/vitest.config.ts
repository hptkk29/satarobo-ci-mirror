/**
 * Cấu hình vitest RIÊNG cho bộ QA DISC chạm Postgres THẬT (tests/disc-db). Không sửa `vitest.db.config.ts` gốc.
 *
 * Lệnh chạy (Lead thêm thành script `test:disc-db` khi muốn):
 *   pnpm exec vitest run -c tests/disc-db/vitest.config.ts --reporter=verbose
 *
 * AN TOÀN DB (hai lớp, bỏ lớp nào cũng mở một đường mất dữ liệu):
 *  1. File này GHI ĐÈ DATABASE_URL/DIRECT_URL về `ci_test` (Postgres local; cổng lấy từ env CHỈ khi URL là local+`ci_test`) — bất kể shell đang trỏ đâu,
 *     nên không thể vô tình chạy trên `satarobo_local`. Muốn đổi DB phải sửa file này có chủ đích.
 *  2. `ALLOW_DB_RESET=1` chỉ đặt Ở ĐÂY (theo CLAUDE.md "test:unit KHÔNG được đụng DB"). Bộ này KHÔNG gọi `resetDb()`:
 *     dọn theo tiền tố `DISCDB`/số điện thoại riêng, và `tests/disc-db/_fx.ts` còn tự khẳng định `current_database() = 'ci_test'`.
 *
 * Yêu cầu: `ci_test` đã `prisma migrate deploy` (có bảng Disc*). Khoá ký cố định chỉ cho test (chuỗi vô hại, ≥32 ký tự).
 */
import path from "node:path";
import { defineConfig } from "vitest/config";
import { laDbCucBo, tenDbCuaUrl } from "../../lib/security/url-db-cuc-bo";

const goc = path.resolve(__dirname, "..", "..");
// Mặc định máy dev. CI chạy Postgres ở cổng khác (service container), nên nhận DATABASE_URL từ môi trường — NHƯNG chỉ khi nó
// (a) được `laDbCucBo` xác nhận là Postgres TRÊN MÁY và (b) tên DB đã tách đúng là `ci_test` (`tenDbCuaUrl`).
// Không tự viết lại phép nhận diện local ở đây: lưới [UDB-LUOI-02] cấm — luôn đi qua lib/security/url-db-cuc-bo.ts.
const MAC_DINH = "postgresql://postgres:postgres@127.0.0.1:5432/ci_test";
const TU_MOI_TRUONG = process.env.DATABASE_URL ?? "";
const DB_TEST_CHO_PHEP = ["ci_test", "satarobo_test"];
const URL_CI = laDbCucBo(TU_MOI_TRUONG) && DB_TEST_CHO_PHEP.includes(tenDbCuaUrl(TU_MOI_TRUONG) ?? "") ? TU_MOI_TRUONG : MAC_DINH;

export default defineConfig({
  root: goc,
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/disc-db/**/*.test.ts"],
    // Dùng chung một Postgres ⇒ không song song giữa các tệp (luật 18: mỗi ca tự dựng hiện trường, không mượn).
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      TZ: "UTC",
      ALLOW_DB_RESET: "1",
      DATABASE_URL: URL_CI,
      DIRECT_URL: URL_CI,
      NEXTAUTH_SECRET: "disc-db-test-only-secret-do-not-use-in-prod-32chars",
      AUTH_SECRET: "disc-db-test-only-secret-do-not-use-in-prod-32chars",
      NEXTAUTH_URL: "http://localhost:3100",
      NEXT_PUBLIC_APP_URL: "http://localhost:3100",
    },
  },
  resolve: {
    alias: {
      "@": goc,
      "server-only": path.resolve(goc, "tests/stubs/server-only.ts"),
    },
  },
});
