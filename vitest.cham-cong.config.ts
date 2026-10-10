// vitest.cham-cong.config.ts — cấu hình riêng cho `tests/cham-cong`.
//
// Khác `vitest.db.config.ts` đúng MỘT điều: nâng `testTimeout`. Tách file thay vì sửa
// `vitest.db.config.ts` để **không** đổi trần của các bộ DB khác (chat / nền / lead-intake /
// e-learning / inbox) — chúng cần phép đo riêng, xem phần "Bộ khác" dưới.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO — sự cố 10/09/2026 trên PR #242
//
// `tests/cham-cong/import.spec.ts` đỏ trên CI với **cùng mã** đã xanh 25 phút trước đó:
//
//   ca "áp T09…"            Error: Test timed out in 5000ms
//   ca "import lại y hệt…"  PrismaClientKnownRequestError P2002 (userId, workDate)
//
// Một gốc, hai triệu chứng — và triệu chứng thứ hai mang tên ca KHÔNG có lỗi (xem chú thích
// trong chính `import.spec.ts`).
//
// ─────────────────────────────────────────────────────────────────────────────
// PHÉP TÍNH RA CON SỐ — đừng đổi mà không đo lại
//
// Số dưới đây là giờ THẬT đọc từ log CI, không phải ngoại suy từ máy dev.
// Lệnh lấy số: `gh run view --job <id> --log`, lọc dòng `✓ … <n>ms`.
//
//   1. Nền CI (lượt XANH, run 34435682940):
//        ca nặng nhất `tests/cham-cong`  = 1 032 ms   (`áp T09…`)
//   2. Biến thiên GIỮA HAI LƯỢT CI, cùng job, cùng mã, cách nhau 25 phút:
//        `QLCS chỉ có quyền CS1…`   583 ms → 2 273 ms = 3,90×
//        `áp T09…`                1 032 ms → bị cắt ở 5 000 ms ⇒ **≥ 4,85×**
//      ⚠️ 4,85× là **CẬN DƯỚI**: ca bị giết ở mốc 5 000 ms nên không ai biết nó thật sự
//      chạy bao lâu. Đây là chỗ dễ tự lừa nhất — đừng lấy cận dưới làm cận trên.
//   3. Sau khi vá cách ly, ca "import lại y hệt" tự dựng lưới ⇒ nó tốn thêm đúng một lượt
//      `applyImport`:  374 + 1 032 ≈ **1 406 ms** là nền CI mới của ca nặng nhất.
//
//        1 406 ms × 4,85 (biến thiên ĐÃ ĐO) × 3 (biên cho phần đuôi CHƯA đo được)
//          ≈ 20 457 ms  →  lấy 20 000 ms
//
// Hệ số 3 là một PHÁN ĐOÁN, không phải phép đo — nói thẳng ra vậy. Lý lẽ: đây là cổng canh
// ĐÚNG/SAI, không phải cổng canh tốc độ. Một ca chậm mà đúng thì cho qua là đúng; thứ trần
// này cần bắt là một ca TREO. 20 000 ms vẫn còn là ~14× nền đo được, đủ xa để chỉ treo mới chạm.
//
// 📌 **Luật đi kèm:** ca nào thật sự cần hơn 20 s là ca phải TÁCH, không phải cái trần phải
// nâng tiếp. Nâng trần lần hai mà không đo lại là bắt đầu nuôi một bộ test chậm dần.
//
// ─────────────────────────────────────────────────────────────────────────────
// BỘ KHÁC — đã đo, CHƯA sửa (chốt của chủ dự án: liệt kê trước)
//
// Áp cùng phép đo (giờ CI thật, lượt xanh) cho mọi bộ chạm Postgres:
//
//   | bộ                             | ca nặng nhất | % trần 5 000 | ×4,85 |
//   |--------------------------------|--------------|--------------|-------|
//   | tests/chat/permission-matrix   | 1 199 ms     | 24%          | 5 815 ms → **VƯỢT** |
//   | tests/cham-cong/import         | 1 032 ms     | 21%          | 5 005 ms → đã vượt thật |
//   | tests/cham-cong/period         |   493 ms     | 10%          | 2 391 ms |
//   | tests/chat/dm-us13             |   257 ms     |  5%          | 1 246 ms |
//   | tests/lead-intake/ingest       |    97 ms     |  2%          |   470 ms |
//   | tests/nen/*                    |   < 60 ms    | <2%          | — |
//
// ⇒ `tests/chat/permission-matrix.spec.ts` đang ở **cùng thế** với ca vừa đỏ. Nó chưa nổ,
// nhưng đó là may chứ không phải có gì giữ. Vé riêng.
import { defineConfig, mergeConfig } from "vitest/config";

import db from "./vitest.db.config";

export default mergeConfig(
  db,
  defineConfig({
    test: {
      testTimeout: 20_000,
      // Hook `beforeAll` của `import.spec.ts` tạo 19 người + seed danh mục ca; cùng lý do,
      // cùng biên thiên, nên đi cùng một trần.
      hookTimeout: 20_000,
    },
  }),
);
