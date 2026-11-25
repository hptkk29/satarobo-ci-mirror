import { describe, it, expect } from "vitest";
import { computeSessionDates, expandHolidaySet, ymdVN } from "./schedule";
import { applySlotTimeToDate, resolveClassSlots } from "./slots";
import { vnDateAt } from "@/lib/time/vn";
import { parseVnYmd, vnParts, vnWeekday } from "@/lib/time/vn";

// 2026-06-01 là Thứ 2.
const MON = new Date(2026, 5, 1);

describe("computeSessionDates", () => {
  it("lịch T2/T4, 4 buổi, không nghỉ → đúng 4 ngày T2/T4 liên tiếp", () => {
    const dates = computeSessionDates({ from: MON, scheduleDays: [1, 3], count: 4, holidays: new Set() });
    expect(dates.map(ymdVN)).toEqual(["2026-06-01", "2026-06-03", "2026-06-08", "2026-06-10"]);
  });

  it("buổi trùng ngày nghỉ → DỜI sang buổi kế, tổng vẫn đủ 4", () => {
    // Nghỉ 2026-06-03 (T4 buổi 2) → buổi đó dời sang T2 kế (08/06), đẩy lùi phần sau.
    const holidays = new Set(["2026-06-03"]);
    const dates = computeSessionDates({ from: MON, scheduleDays: [1, 3], count: 4, holidays });
    expect(dates).toHaveLength(4);
    expect(dates.map(ymdVN)).toEqual(["2026-06-01", "2026-06-08", "2026-06-10", "2026-06-15"]);
    expect(dates.map(ymdVN)).not.toContain("2026-06-03");
  });

  it("scheduleDays rỗng → []", () => {
    expect(computeSessionDates({ from: MON, scheduleDays: [], count: 3, holidays: new Set() })).toEqual([]);
  });

  it("count 0 → []", () => {
    expect(computeSessionDates({ from: MON, scheduleDays: [1], count: 0, holidays: new Set() })).toEqual([]);
  });
});

describe("REGRESSION 06/08/2026 — lệch 1 ngày khi server chạy UTC", () => {
  // Lỗi thật: lớp khai giảng T7 20/06/2026, ca 17:30 → hệ thống sinh ra loạt buổi
  // CN 21/06. Nguyên nhân: `new Date(y,m,d,h,m)` + `getDay()` chạy theo TZ tiến
  // trình; Vercel không set TZ ⇒ UTC ⇒ 17:30Z = 00:30 hôm sau ở VN.
  const slots = resolveClassSlots({ scheduleDays: [6], startTime: "17:30", endTime: "19:00" });

  it("khai giảng T7 20/06 ca 17:30 → 4 buổi đều là THỨ 7, 17h30 giờ VN", () => {
    const dates = computeSessionDates({
      from: parseVnYmd("2026-06-20")!,
      scheduleDays: [6],
      count: 4,
      holidays: new Set(),
    });
    const sessions = dates.map((d) => applySlotTimeToDate(d, slots));

    expect(sessions.map(ymdVN)).toEqual(["2026-06-20", "2026-06-27", "2026-07-04", "2026-07-11"]);
    for (const s of sessions) {
      expect(vnWeekday(s)).toBe(6); // T7 — KHÔNG được là CN (0)
      expect(vnParts(s)).toMatchObject({ hour: 17, minute: 30 });
    }
  });

  it("khai giảng lưu kiểu nào cũng ra cùng ngày (nửa đêm UTC vs nửa đêm VN)", () => {
    // `Class.startDate` trong DB tồn tại 2 quy ước: form admin ghi nửa đêm UTC
    // (z.coerce.date), seed cũ ghi nửa đêm VN (=17:00Z hôm trước). Cả hai phải
    // cho ra cùng một lịch.
    const args = { scheduleDays: [6], count: 3, holidays: new Set<string>() };
    const fromUtcMidnight = computeSessionDates({ from: new Date("2026-06-20T00:00:00Z"), ...args });
    const fromVnMidnight = computeSessionDates({ from: new Date("2026-06-19T17:00:00Z"), ...args });
    expect(fromUtcMidnight.map(ymdVN)).toEqual(["2026-06-20", "2026-06-27", "2026-07-04"]);
    expect(fromVnMidnight.map(ymdVN)).toEqual(fromUtcMidnight.map(ymdVN));
  });

  it("ca tối 19:00 không tràn sang ngày hôm sau", () => {
    const evening = resolveClassSlots({ scheduleDays: [1, 5], startTime: "19:00" });
    const dates = computeSessionDates({
      from: parseVnYmd("2026-06-22")!, // T2
      scheduleDays: [1, 5],
      count: 2,
      holidays: new Set(),
    });
    const sessions = dates.map((d) => applySlotTimeToDate(d, evening));
    expect(sessions.map(ymdVN)).toEqual(["2026-06-22", "2026-06-26"]);
    expect(sessions.map(vnWeekday)).toEqual([1, 5]);
  });

  it("ngày nghỉ khớp theo ngày VN dù Holiday lưu nửa đêm UTC (@db.Date)", () => {
    const set = expandHolidaySet([{ date: new Date("2026-06-27T00:00:00Z"), endDate: null }]);
    expect([...set]).toEqual(["2026-06-27"]);
    const dates = computeSessionDates({
      from: parseVnYmd("2026-06-20")!,
      scheduleDays: [6],
      count: 3,
      holidays: set,
    });
    expect(dates.map(ymdVN)).toEqual(["2026-06-20", "2026-07-04", "2026-07-11"]);
  });
});

describe("expandHolidaySet", () => {
  it("khoảng nghỉ date..endDate mở rộng thành từng ngày", () => {
    const set = expandHolidaySet([{ date: new Date(2026, 5, 1), endDate: new Date(2026, 5, 3) }]);
    expect([...set].sort()).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });
  it("nghỉ 1 ngày (endDate null)", () => {
    const set = expandHolidaySet([{ date: new Date(2026, 5, 10), endDate: null }]);
    expect([...set]).toEqual(["2026-06-10"]);
  });
});

// Ca thật 06/08/2026: lớp khai giờ T7 10:00, thêm buổi T5 → thứ đó KHÔNG có slot.
// Bản cũ parseHm(null) → 00:00, buổi lưu 00:00 VN = 17:00Z ⇒ tab điểm danh hiện
// "17:00" cho mọi buổi và phép so trùng báo trùng oan với lớp khác cùng ngày.
describe("applySlotTimeToDate — thứ không có slot riêng", () => {
  const T7 = [{ weekday: 6, startTime: "10:00", endTime: "11:30" }];
  const thu5 = vnDateAt(2026, 6, 30); // 30/07/2026 là thứ Năm

  it("lùi về giờ CHUNG của lớp, không rơi về 00:00", () => {
    expect(applySlotTimeToDate(thu5, T7, "10:00").toISOString()).toBe("2026-07-30T03:00:00.000Z");
  });

  it("không có slot và cũng không có giờ chung → 00:00 (giữ hành vi cũ)", () => {
    expect(applySlotTimeToDate(thu5, T7).toISOString()).toBe("2026-07-29T17:00:00.000Z");
  });

  it("thứ CÓ slot riêng thì slot thắng giờ chung", () => {
    const t7 = vnDateAt(2026, 7, 1); // 01/08/2026 là thứ Bảy
    expect(applySlotTimeToDate(t7, T7, "18:00").toISOString()).toBe("2026-08-01T03:00:00.000Z");
  });
});
