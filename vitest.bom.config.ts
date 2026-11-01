// vitest.bom.config.ts — cấu hình cho lưới "bom hẹn giờ": chạy bộ test với đồng hồ đẩy
// lên `DAY_OFFSET` ngày.
//
// Khác `vitest.config.ts` đúng hai điều:
//   · thêm `tests/_helpers/setup-bom-hen-gio.ts` vào `setupFiles` (giữ nguyên setup gốc);
//   · bật `ALLOW_DB_RESET` để bộ chạm Postgres cũng chạy — bom nằm nhiều nhất ở đó
//     (`tests/cham-cong` chính là nơi đã nổ).
//
// ⚠️ ĐỪNG trỏ cấu hình này vào `pnpm test:unit`. Nó chỉ dành cho workflow
// `.github/workflows/bom-hen-gio.yml`, nơi Postgres là container dùng một lần.
import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      env: { ALLOW_DB_RESET: "1" },
      setupFiles: ["./tests/setup.ts", "./tests/_helpers/setup-bom-hen-gio.ts"],
      // Các bộ chạm DB dùng chung một Postgres nên chạy song song là giẫm chân nhau.
      fileParallelism: false,
    },
  }),
);
