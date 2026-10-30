// @vitest-environment node
// lib/ai-lead/ngay-vn.test.ts — NGÀY theo giờ Việt Nam cho gộp sự cố (`@db.Date`). THUẦN. Mã ca: [AIL-NV-01..]
import { describe, expect, it } from "vitest";
import { ngayVnLaDate } from "./ngay-vn";

const ISO = (d: Date) => d.toISOString();

describe("[AIL-NV-01] nửa đêm UTC của ngày lịch Việt Nam", () => {
  it("23:30 UTC ngày 26 = 06:30 ngày 27 giờ VN ⇒ ngày 27", () => {
    expect(ISO(ngayVnLaDate(Date.UTC(2026, 9, 26, 23, 30)))).toBe("2026-10-27T00:00:00.000Z");
  });
  it("16:59:59 UTC = 23:59:59 giờ VN ⇒ vẫn cùng ngày; 17:00:00 UTC = 00:00 hôm sau", () => {
    expect(ISO(ngayVnLaDate(Date.UTC(2026, 9, 26, 16, 59, 59)))).toBe("2026-10-26T00:00:00.000Z");
    expect(ISO(ngayVnLaDate(Date.UTC(2026, 9, 26, 17, 0, 0)))).toBe("2026-10-27T00:00:00.000Z");
  });
  it("qua ranh giới tháng và năm", () => {
    expect(ISO(ngayVnLaDate(Date.UTC(2026, 9, 31, 20, 0)))).toBe("2026-11-01T00:00:00.000Z");
    expect(ISO(ngayVnLaDate(Date.UTC(2026, 11, 31, 18, 0)))).toBe("2027-01-01T00:00:00.000Z");
  });
  it("ngày nhuận", () => {
    expect(ISO(ngayVnLaDate(Date.UTC(2028, 1, 28, 18, 0)))).toBe("2028-02-29T00:00:00.000Z");
  });
});
