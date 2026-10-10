import { describe, it, expect } from "vitest";
import {
  MEDIA_REVIEW_DEADLINE_HOUR_DEFAULT,
  deadlineFor,
  isOverdue,
  vnToday,
  ymd,
} from "./deadline";

/** Cột `@db.Date` = UTC 00:00 của ngày lịch VN. */
const ngay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("deadlineFor", () => {
  it("mặc định 10:00 sáng HÔM SAU, tính theo giờ VN", () => {
    // Buổi 25/08 → hạn 26/08 10:00 VN = 26/08 03:00 UTC.
    expect(deadlineFor(ngay(2026, 8, 25), MEDIA_REVIEW_DEADLINE_HOUR_DEFAULT).toISOString()).toBe(
      "2026-08-26T03:00:00.000Z",
    );
  });

  it("đổi giờ cấu hình thì hạn dịch theo", () => {
    expect(deadlineFor(ngay(2026, 8, 25), 8).toISOString()).toBe("2026-08-26T01:00:00.000Z");
    expect(deadlineFor(ngay(2026, 8, 25), 18).toISOString()).toBe("2026-08-26T11:00:00.000Z");
  });

  it("bắc cầu sang tháng sau", () => {
    expect(deadlineFor(ngay(2026, 8, 31), 10).toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });

  it("bắc cầu sang năm sau", () => {
    expect(deadlineFor(ngay(2026, 12, 31), 10).toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });

  it("giờ 0 vẫn hợp lệ — nửa đêm hôm sau theo giờ VN", () => {
    expect(deadlineFor(ngay(2026, 8, 25), 0).toISOString()).toBe("2026-08-25T17:00:00.000Z");
  });

  it("giá trị cấu hình rác không làm vỡ — kẹp về 0..23", () => {
    expect(deadlineFor(ngay(2026, 8, 25), -5).toISOString()).toBe("2026-08-25T17:00:00.000Z");
    // kẹp về 23 ⇒ 23:00 VN ngày 26/08 = 16:00 UTC CÙNG ngày.
    expect(deadlineFor(ngay(2026, 8, 25), 99).toISOString()).toBe("2026-08-26T16:00:00.000Z");
    expect(deadlineFor(ngay(2026, 8, 25), Number.NaN).toISOString()).toBe(
      "2026-08-26T03:00:00.000Z",
    );
  });
});

describe("isOverdue", () => {
  const han = deadlineFor(ngay(2026, 8, 25), 10); // 26/08 03:00 UTC

  it("trước hạn → chưa trễ", () => {
    expect(isOverdue(han, new Date("2026-08-26T02:59:59.000Z"))).toBe(false);
  });

  it("ĐÚNG mốc hạn → chưa trễ (chỉ quá mới tính)", () => {
    expect(isOverdue(han, new Date("2026-08-26T03:00:00.000Z"))).toBe(false);
  });

  it("qua hạn 1 giây → trễ", () => {
    expect(isOverdue(han, new Date("2026-08-26T03:00:01.000Z"))).toBe(true);
  });
});

describe("vnToday", () => {
  it("00:30 giờ VN vẫn là NGÀY HÔM ĐÓ, dù UTC còn hôm trước", () => {
    // 2026-08-26 00:30 VN = 2026-08-25 17:30 UTC
    expect(ymd(vnToday(new Date("2026-08-25T17:30:00.000Z")))).toBe("2026-08-26");
  });

  it("23:30 giờ VN vẫn là ngày hôm đó", () => {
    // 2026-08-26 23:30 VN = 2026-08-26 16:30 UTC
    expect(ymd(vnToday(new Date("2026-08-26T16:30:00.000Z")))).toBe("2026-08-26");
  });
});
