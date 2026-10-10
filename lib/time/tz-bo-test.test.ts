/**
 * Cổng cho chính cấu hình: bộ test PHẢI chạy ở UTC, giống prod.
 *
 * Vì sao cần một ca khẳng định điều này thay vì tin vào `env: { TZ: "UTC" }` trong
 * `vitest.config.ts`: Node đọc `TZ` lúc khởi tạo tiến trình. Một cấu hình đặt nó MUỘN hơn
 * thời điểm đó sẽ không có tác dụng gì — và im lặng. Repo này đã bị đúng loại "cổng im
 * lặng" ba lần (hook đọc biến không tồn tại · `pnpm lint` không quét `tests/` · `include`
 * của vitest là bộ lọc cứng), nên cấu hình nào tự nhận là lưới thì phải có ca chứng minh.
 */
import { describe, it, expect } from "vitest";

describe("đồng hồ của bộ test", () => {
  it("chạy ở UTC — giống Vercel, KHÁC máy dev (+07)", () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });

  it("giờ MÁY và giờ UTC trùng nhau ⇒ mọi getDay()/getDate() trong test khắt khe bằng prod", () => {
    const d = new Date("2026-09-13T16:30:00Z");
    // Ở +07 thì đây là 23:30 ngày 13; ở UTC là 16:30 ngày 13. Ngày trùng, nhưng GIỜ phải là 16.
    expect(d.getHours()).toBe(16);
    expect(d.getDate()).toBe(13);
  });

  it("mốc lật ngày: 17:00Z là NGÀY MAI theo giờ VN, nhưng test phải thấy hôm nay", () => {
    // Chính cửa sổ đã làm `timelog.spec.ts` đỏ hôm 08/09 (PR #235).
    const d = new Date("2026-09-08T17:19:00Z");
    expect(d.getDate()).toBe(8);
  });
});
