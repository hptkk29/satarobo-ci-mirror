import { describe, it, expect } from "vitest";
import {
  formatDateVN,
  formatDateDMY,
  formatDateTimeVN,
  formatDateOrDash,
  formatDateTimeVNZoned,
} from "./date";

// Noon-UTC → cùng ngày lịch trên mọi TZ thực tế (UTC-8..UTC+9) nên assert
// date-only ổn định, không phụ thuộc TZ máy CI.
const NOON_UTC = "2026-03-14T12:00:00Z";

describe("format/date", () => {
  it("formatDateVN = dd/M/yyyy vi-VN", () => {
    expect(formatDateVN(NOON_UTC)).toBe("14/3/2026");
  });

  it("formatDateDMY = dd/MM/yyyy (2 chữ số)", () => {
    expect(formatDateDMY(NOON_UTC)).toBe("14/03/2026");
  });

  it("nhận Date | string | number, giữ y hệt inline cũ", () => {
    const d = new Date(NOON_UTC);
    // Contract behavior-preserving: helper === biểu thức inline nó thay thế.
    expect(formatDateVN(d)).toBe(d.toLocaleDateString("vi-VN"));
    expect(formatDateVN(d.getTime())).toBe(new Date(d.getTime()).toLocaleDateString("vi-VN"));
    expect(formatDateDMY(d)).toBe(
      d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }),
    );
    expect(formatDateTimeVN(d)).toBe(d.toLocaleString("vi-VN"));
  });

  it("formatDateOrDash: sentinel (null/rỗng/Invalid/epoch 1970) → '—'", () => {
    expect(formatDateOrDash(null)).toBe("—");
    expect(formatDateOrDash(undefined)).toBe("—");
    expect(formatDateOrDash("")).toBe("—");
    expect(formatDateOrDash("không-phải-ngày")).toBe("—");
    expect(formatDateOrDash(0)).toBe("—"); // epoch 0
    expect(formatDateOrDash(new Date(0))).toBe("—"); // 1970-01-01
    expect(formatDateOrDash("1970-01-01T00:00:00.000Z")).toBe("—");
  });

  it("formatDateOrDash: ngày hợp lệ → như formatDateVN", () => {
    expect(formatDateOrDash(NOON_UTC)).toBe(formatDateVN(NOON_UTC));
  });
});

describe("formatDateTimeVNZoned — mốc có giờ, ghim múi VN", () => {
  it("in `HH:mm dd/MM/yyyy` theo giờ Việt Nam bất kể máy chạy ở múi nào", () => {
    // 2026-08-29T17:30:00Z = 00:30 ngày 30/08 giờ VN. Đây chính là ca làm lộ bug:
    // trên Vercel (UTC) mốc này từng in ra ngày 29, trên máy dev (+07) in ra ngày 30.
    expect(formatDateTimeVNZoned("2026-08-29T17:30:00.000Z")).toBe("00:30 30/08/2026");
  });

  it("giờ đứng TRƯỚC ngày, ngày/tháng luôn 2 chữ số", () => {
    expect(formatDateTimeVNZoned("2026-01-05T02:04:00.000Z")).toBe("09:04 05/01/2026");
  });
});
