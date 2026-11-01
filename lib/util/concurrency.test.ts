import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("giữ đúng thứ tự kết quả theo đầu vào", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it("KHÔNG chạy quá số lượt song song cho phép", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("danh sách rỗng → mảng rỗng, không gọi fn", async () => {
    let calls = 0;
    const out = await mapWithConcurrency([], 4, async () => {
      calls++;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("limit nhỏ hơn 1 vẫn chạy (ép về 1), không treo", async () => {
    const out = await mapWithConcurrency([1, 2], 0, async (n) => n);
    expect(out).toEqual([1, 2]);
  });

  it("một phần tử lỗi → hàm reject", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("hỏng");
        return n;
      }),
    ).rejects.toThrow("hỏng");
  });
});
