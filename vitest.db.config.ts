// vitest.db.config.ts — cấu hình cho các bộ test CHẠM POSTGRES THẬT.
//
// Khác `vitest.config.ts` đúng một điều: bật `ALLOW_DB_RESET=1`. Đó là cờ cho phép
// `resetDb()` chạy (TRUNCATE mọi bảng) — xem `tests/_helpers/db-gate.ts`.
//
// Vì sao tách file thay vì đặt env ngay trong script `package.json`: repo không có
// `cross-env`, mà cú pháp `VAR=1 lệnh` không chạy trên cmd.exe của Windows — đúng nền
// mà máy dev đang dùng. Đặt trong cấu hình thì chạy đâu cũng như nhau.
//
// ⚠️ ĐỪNG trỏ cấu hình này vào `pnpm test:unit`. Nó tồn tại để việc xoá DB luôn là một
// LỰA CHỌN CÓ CHỦ ĐÍCH, sau lần chạy `pnpm test:unit` xoá sạch DB làm việc 04/09/2026.
import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      env: { ALLOW_DB_RESET: "1" },
      // Các bộ này dùng chung một Postgres nên chạy song song là giẫm chân nhau —
      // giữ đúng cờ mà từng script trong package.json vẫn truyền.
      fileParallelism: false,
    },
  }),
);
