import { describe, it, expect } from "vitest";
import { discountFromPercent } from "./discount";

// BGĐ 31/07 — giảm giá: % → tiền, và quy tắc "khi nào cần duyệt".

describe("discountFromPercent", () => {
  it("quy % ra tiền, làm tròn", () => {
    expect(discountFromPercent(1_000_000, 10)).toBe(100_000);
    expect(discountFromPercent(3_333_333, 15)).toBe(500_000); // 499_999.95 → 500_000
  });

  it("clamp trong [0, tạm tính] — không âm, không vượt tổng", () => {
    expect(discountFromPercent(1_000_000, 0)).toBe(0);
    expect(discountFromPercent(1_000_000, -5)).toBe(0);
    expect(discountFromPercent(1_000_000, 100)).toBe(1_000_000);
    expect(discountFromPercent(1_000_000, 150)).toBe(1_000_000);
  });
});

// ⚠️ ĐÃ XOÁ [14/09/2026] — bộ ca của `needsDiscountApproval`, cùng lượt với chính hàm
// đó. Nó khẳng định "có giảm giá ⇒ cần duyệt", mà cơ chế duyệt đã bỏ; giữ lại là bắt CI
// chạy mãi cho một luật không còn tồn tại. Luật THAY THẾ có lưới riêng:
// `lib/orders/price-guard.test.ts` + `lib/orders/bo-duyet.test.ts`.
