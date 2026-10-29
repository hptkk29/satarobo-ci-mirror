import { describe, it, expect } from "vitest";
import {
  birthdayInYear,
  birthdayWithinWindow,
  dayKeyUTC,
  isLeapYear,
  nextBirthdayOccurrence,
  pickCelebrationSession,
  shiftDayKey,
  vnDayKey,
  vnDayStartUtc,
  type SessionCandidate,
} from "./birthday-dates";

/** Ngày sinh đúng như DB lưu: UTC-midnight. */
const dob = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** Buổi học tạo trên Vercel (TZ=UTC): `new Date(y,m,d)` ⇒ UTC-midnight. */
const sessionUtcMidnight = (id: string, y: number, m: number, d: number): SessionCandidate => ({
  id,
  date: new Date(Date.UTC(y, m - 1, d)),
  classId: "c1",
  className: "Sata 1",
});

/** Buổi học tạo từ máy local giờ VN: nửa đêm VN = 17:00Z hôm trước. */
const sessionVnMidnight = (id: string, y: number, m: number, d: number): SessionCandidate => ({
  id,
  date: new Date(Date.UTC(y, m - 1, d) - 7 * 3600 * 1000),
  classId: "c1",
  className: "Sata 1",
});

describe("vnDayKey — quy mốc đã lưu về ngày lịch VN", () => {
  it("UTC-midnight và VN-midnight cùng ra một ngày lịch", () => {
    // Đây là bất biến khiến so sánh buổi học không lệch 1 ngày giữa prod (TZ=UTC)
    // và máy local (UTC+7). Hỏng bất biến này là hỏng cả tính năng.
    expect(vnDayKey(new Date(Date.UTC(2026, 7, 6)))).toBe("2026-08-06");
    expect(vnDayKey(new Date(Date.UTC(2026, 7, 6) - 7 * 3600 * 1000))).toBe("2026-08-06");
  });

  it("23:30 UTC đã sang ngày hôm sau ở VN", () => {
    expect(vnDayKey(new Date("2026-08-06T23:30:00Z"))).toBe("2026-08-07");
  });
});

describe("shiftDayKey / vnDayStartUtc", () => {
  it("bắc cầu cuối tháng và cuối năm", () => {
    expect(shiftDayKey("2026-08-30", 3)).toBe("2026-09-02");
    expect(shiftDayKey("2026-12-28", 5)).toBe("2027-01-02");
    expect(shiftDayKey("2027-01-02", -5)).toBe("2026-12-28");
  });

  it("00:00 giờ VN = 17:00Z hôm trước", () => {
    expect(vnDayStartUtc("2026-08-06").toISOString()).toBe("2026-08-05T17:00:00.000Z");
  });
});

describe("birthdayInYear — 29/02", () => {
  it("nhận diện năm nhuận", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
  });

  it("năm KHÔNG nhuận → 28/02, tuyệt đối không tràn sang 01/03", () => {
    expect(dayKeyUTC(birthdayInYear(dob(2016, 2, 29), 2026))).toBe("2026-02-28");
  });

  it("năm nhuận → giữ nguyên 29/02", () => {
    expect(dayKeyUTC(birthdayInYear(dob(2016, 2, 29), 2028))).toBe("2028-02-29");
  });

  it("ngày thường giữ nguyên tháng/ngày", () => {
    expect(dayKeyUTC(birthdayInYear(dob(2015, 5, 20), 2026))).toBe("2026-05-20");
  });
});

describe("nextBirthdayOccurrence", () => {
  it("sinh nhật còn ở phía trước trong năm nay", () => {
    const r = nextBirthdayOccurrence(dob(2015, 8, 20), "2026-08-06");
    expect(dayKeyUTC(r.date)).toBe("2026-08-20");
    expect(r.year).toBe(2026);
  });

  it("đúng hôm nay vẫn tính là lần sinh nhật này", () => {
    const r = nextBirthdayOccurrence(dob(2015, 8, 6), "2026-08-06");
    expect(dayKeyUTC(r.date)).toBe("2026-08-06");
    expect(r.year).toBe(2026);
  });

  it("đã qua trong năm nay → nhảy sang năm sau", () => {
    const r = nextBirthdayOccurrence(dob(2015, 3, 10), "2026-08-06");
    expect(dayKeyUTC(r.date)).toBe("2027-03-10");
    expect(r.year).toBe(2027);
  });

  it("bắc cầu cuối năm: quét 28/12, sinh nhật 02/01 thuộc năm SAU", () => {
    const r = nextBirthdayOccurrence(dob(2015, 1, 2), "2026-12-28");
    expect(dayKeyUTC(r.date)).toBe("2027-01-02");
    // year phải là 2027 — dùng làm khoá chống trùng, sai năm là gửi lại tin.
    expect(r.year).toBe(2027);
  });
});

describe("birthdayWithinWindow", () => {
  it("trong cửa sổ 10 ngày", () => {
    expect(birthdayWithinWindow(dob(2015, 8, 15), "2026-08-06", 10)?.dayKey).toBe("2026-08-15");
  });

  it("đúng biên cửa sổ vẫn nhận", () => {
    expect(birthdayWithinWindow(dob(2015, 8, 16), "2026-08-06", 10)?.dayKey).toBe("2026-08-16");
  });

  it("quá biên 1 ngày → loại", () => {
    expect(birthdayWithinWindow(dob(2015, 8, 17), "2026-08-06", 10)).toBeNull();
  });

  it("cửa sổ bắc cầu sang năm sau", () => {
    expect(birthdayWithinWindow(dob(2015, 1, 2), "2026-12-28", 10)?.dayKey).toBe("2027-01-02");
  });
});

describe("pickCelebrationSession — quy tắc nghiệp vụ chính", () => {
  const opts = { lookbackDays: 7, forwardDays: 7 };

  it("có buổi ĐÚNG hôm sinh nhật → chọn buổi đó", () => {
    const picked = pickCelebrationSession(
      [sessionUtcMidnight("s-truoc", 2026, 8, 18), sessionUtcMidnight("s-dung", 2026, 8, 20)],
      "2026-08-20",
      opts,
    );
    expect(picked?.id).toBe("s-dung");
  });

  it("không có buổi hôm đó → lấy buổi GẦN NHẤT TRƯỚC (yêu cầu gốc)", () => {
    const picked = pickCelebrationSession(
      [
        sessionUtcMidnight("s-xa", 2026, 8, 14),
        sessionUtcMidnight("s-gan", 2026, 8, 18),
        sessionUtcMidnight("s-sau", 2026, 8, 22),
      ],
      "2026-08-20",
      opts,
    );
    expect(picked?.id).toBe("s-gan");
  });

  it("buổi trước đó quá xa (ngoài lookback) → không lấy, rơi sang buổi sau", () => {
    const picked = pickCelebrationSession(
      [sessionUtcMidnight("s-qua-xa", 2026, 8, 1), sessionUtcMidnight("s-sau", 2026, 8, 22)],
      "2026-08-20",
      opts,
    );
    expect(picked?.id).toBe("s-sau");
  });

  it("chỉ có buổi sau và cũng ngoài tầm → null (bỏ qua học viên)", () => {
    const picked = pickCelebrationSession(
      [sessionUtcMidnight("s-rat-xa", 2026, 9, 30)],
      "2026-08-20",
      opts,
    );
    expect(picked).toBeNull();
  });

  it("không có buổi nào → null", () => {
    expect(pickCelebrationSession([], "2026-08-20", opts)).toBeNull();
  });

  it("buổi lưu theo nửa đêm giờ VN vẫn khớp đúng ngày sinh nhật", () => {
    // Chống hồi quy lệch 1 ngày giữa dữ liệu tạo trên prod và tạo từ máy local.
    const picked = pickCelebrationSession(
      [sessionVnMidnight("s-vn", 2026, 8, 20)],
      "2026-08-20",
      opts,
    );
    expect(picked?.id).toBe("s-vn");
  });

  it("hai buổi cùng ngày (HV học 2 lớp) → lấy buổi sớm hơn trong ngày", () => {
    const chieu: SessionCandidate = {
      id: "s-chieu",
      date: new Date("2026-08-20T10:00:00Z"),
      classId: "c2",
      className: "Sata 2",
    };
    const sang: SessionCandidate = {
      id: "s-sang",
      date: new Date("2026-08-20T02:00:00Z"),
      classId: "c1",
      className: "Sata 1",
    };
    expect(pickCelebrationSession([chieu, sang], "2026-08-20", opts)?.id).toBe("s-sang");
  });
});
