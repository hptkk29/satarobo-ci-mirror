import { describe, it, expect } from "vitest";
import { vnDateAt } from "@/lib/time/vn";
import {
  CLOSED_DAY,
  DEFAULT_WORKING_HOUR_WEEK,
  buildWeek,
  elapsedBusinessMs,
  formatHhMm,
  isWorkingTime,
  nextWorkingMoment,
  parseHhMm,
  resolveWorkingHourWeek,
  type WorkingHourRuleRow,
  type WorkingHourWeek,
} from "./rules";

// ─── Khung thời gian dùng chung ────────────────────────────────────────────────────────
// Tuần mốc 16–25/08/2026 (đã đối chiếu thứ, không đoán):
//   16 CN · 17 T2(NGHỈ) · 18 T3 · 19 T4 · 20 T5 · 21 T6 · 22 T7 · 23 CN · 24 T2(NGHỈ) · 25 T3
// Chọn tuần có ĐỦ: một ngày nghỉ cố định nằm giữa (T2 24/08) và hai đầu tuần liền nhau.
const AUG = 7; // tháng 0-based

/** Mốc theo ĐỒNG HỒ VN — mọi kỳ vọng dưới đây đọc theo giờ Việt Nam, không theo giờ máy chạy. */
function vn(day: number, hour: number, minute = 0): Date {
  return vnDateAt(2026, AUG, day, hour, minute);
}

const WEEK = DEFAULT_WORKING_HOUR_WEEK; // T3–CN 07:45–21:00, nghỉ T2
const OPEN_MIN = 7 * 60 + 45;
const CLOSE_MIN = 21 * 60;
/** Một ngày làm việc trọn vẹn theo lưới mặc định = 13h15. */
const FULL_DAY_MS = (CLOSE_MIN - OPEN_MIN) * 60_000;

const h = (n: number) => n * 3_600_000;
const m = (n: number) => n * 60_000;

describe("parseHhMm / formatHhMm", () => {
  it("nhận đúng định dạng HH:mm và quy ra phút-trong-ngày", () => {
    expect(parseHhMm("07:45")).toBe(465);
    expect(parseHhMm("00:00")).toBe(0);
    expect(parseHhMm("21:00")).toBe(1260);
    expect(parseHhMm("23:59")).toBe(1439);
    expect(parseHhMm("  09:30  ")).toBe(570); // khoảng trắng thừa từ ô nhập
  });

  it("chặn chuỗi rác thay vì đoán", () => {
    // "7:45" bị từ chối có chủ đích: `<input type="time">` và validator giờ lớp học
    // (lib/validators/class.ts) đều sinh/đòi 2 chữ số — nới ở đây là mở ra hai định dạng
    // cùng tồn tại trong DB, rồi so chuỗi ở chỗ khác sẽ lệch.
    for (const bad of ["7:45", "24:00", "12:60", "0745", "07:45:00", "abc", "", "12:5", "-1:00"]) {
      expect({ bad, minute: parseHhMm(bad) }).toEqual({ bad, minute: null });
    }
    expect(parseHhMm(null)).toBeNull();
    expect(parseHhMm(undefined)).toBeNull();
  });

  it("format là phép ngược của parse, và chặn phút ngoài ngày", () => {
    expect(formatHhMm(465)).toBe("07:45");
    expect(formatHhMm(1260)).toBe("21:00");
    expect(formatHhMm(0)).toBe("00:00");
    expect(formatHhMm(1440)).toBeNull(); // 24:00 không phải mốc cùng ngày
    expect(formatHhMm(-1)).toBeNull();
    expect(formatHhMm(60.5)).toBeNull();
  });
});

describe("isWorkingTime", () => {
  it("tính theo GIỜ VN chứ không theo giờ máy chạy", () => {
    // Neo bằng instant UTC thật (không đi qua vnDateAt) — nếu ai đó thay lõi bằng
    // getHours() thì test này đỏ trên CI (UTC) dù vẫn xanh trên máy dev (+07).
    expect(isWorkingTime(new Date("2026-08-19T00:45:00.000Z"), WEEK)).toBe(true); // 07:45 VN
    expect(isWorkingTime(new Date("2026-08-19T00:44:59.999Z"), WEEK)).toBe(false); // 07:44 VN
    expect(isWorkingTime(new Date("2026-08-19T14:00:00.000Z"), WEEK)).toBe(false); // 21:00 VN
  });

  it("biên mở/đóng là khoảng nửa mở [open, close)", () => {
    expect(isWorkingTime(vn(19, 7, 44), WEEK)).toBe(false);
    expect(isWorkingTime(vn(19, 7, 45), WEEK)).toBe(true); // đúng mốc mở → ĐANG làm việc
    expect(isWorkingTime(vn(19, 20, 59), WEEK)).toBe(true);
    expect(isWorkingTime(vn(19, 21, 0), WEEK)).toBe(false); // đúng mốc đóng → ĐÃ nghỉ
    expect(isWorkingTime(vn(19, 21, 1), WEEK)).toBe(false);
  });

  it("Thứ Hai nghỉ cả ngày", () => {
    expect(isWorkingTime(vn(17, 12, 0), WEEK)).toBe(false);
    expect(isWorkingTime(vn(24, 9, 0), WEEK)).toBe(false);
  });

  it("ngày lễ đè lên bảng giờ", () => {
    const opts = { holidayKeys: new Set(["2026-08-19"]) };
    expect(isWorkingTime(vn(19, 12, 0), WEEK)).toBe(true);
    expect(isWorkingTime(vn(19, 12, 0), WEEK, opts)).toBe(false);
    expect(isWorkingTime(vn(20, 12, 0), WEEK, opts)).toBe(true); // hôm sau vẫn bình thường
  });
});

describe("nextWorkingMoment", () => {
  it("đang trong giờ → trả CHÍNH mốc đó (không hoãn thông báo)", () => {
    const now = vn(19, 10, 0);
    expect(nextWorkingMoment(now, WEEK)?.getTime()).toBe(now.getTime());
  });

  it("trước giờ mở cùng ngày → đầu giờ hôm đó", () => {
    expect(nextWorkingMoment(vn(19, 6, 0), WEEK)?.getTime()).toBe(vn(19, 7, 45).getTime());
    // Đúng mốc đóng đã là "ngoài giờ" ⇒ phải nhảy sang hôm sau, không đứng lại 21:00.
    expect(nextWorkingMoment(vn(19, 21, 0), WEEK)?.getTime()).toBe(vn(20, 7, 45).getTime());
  });

  it("sau giờ đóng → đầu giờ ngày làm việc kế (qua nửa đêm)", () => {
    expect(nextWorkingMoment(vn(19, 22, 30), WEEK)?.getTime()).toBe(vn(20, 7, 45).getTime());
  });

  it("tối Chủ nhật → nhảy qua Thứ Hai nghỉ, rơi vào Thứ Ba", () => {
    expect(nextWorkingMoment(vn(23, 22, 0), WEEK)?.getTime()).toBe(vn(25, 7, 45).getTime());
  });

  it("chuỗi ngày lễ liên tiếp → mốc kế nằm sau cả chuỗi", () => {
    const opts = { holidayKeys: new Set(["2026-08-20", "2026-08-21"]) };
    expect(nextWorkingMoment(vn(19, 22, 0), WEEK, opts)?.getTime()).toBe(vn(22, 7, 45).getTime());
  });

  it("mọi thứ đều nghỉ → null, KHÔNG lặp vô hạn", () => {
    const allClosed = buildWeek(() => CLOSED_DAY);
    expect(nextWorkingMoment(vn(19, 10, 0), allClosed)).toBeNull();
  });

  it("nghỉ dài hơn trần quét → null (trần là lưới an toàn, không phải câu trả lời sai)", () => {
    const opts = {
      maxLookaheadDays: 2,
      holidayKeys: new Set(["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"]),
    };
    expect(nextWorkingMoment(vn(19, 10, 0), WEEK, opts)).toBeNull();
    // Nới trần ra thì tìm được — chứng minh null ở trên đúng là do trần, không do lõi sai.
    expect(
      nextWorkingMoment(vn(19, 10, 0), WEEK, { ...opts, maxLookaheadDays: 14 })?.getTime(),
    ).toBe(vn(23, 7, 45).getTime());
  });
});

describe("elapsedBusinessMs", () => {
  it("from >= to → 0, không bao giờ trả số âm", () => {
    expect(elapsedBusinessMs(vn(19, 15, 0), vn(19, 9, 0), WEEK)).toBe(0);
    expect(elapsedBusinessMs(vn(19, 9, 0), vn(19, 9, 0), WEEK)).toBe(0);
  });

  it("hai mốc trong CÙNG một ngày, cả hai trong giờ", () => {
    expect(elapsedBusinessMs(vn(19, 9, 0), vn(19, 11, 30), WEEK)).toBe(h(2.5));
  });

  it("mốc bắt đầu nằm TRƯỚC giờ mở → chỉ tính từ giờ mở", () => {
    expect(elapsedBusinessMs(vn(19, 5, 0), vn(19, 9, 0), WEEK)).toBe(m(75)); // 07:45→09:00
  });

  it("cả khoảng nằm ngoài giờ → 0", () => {
    expect(elapsedBusinessMs(vn(19, 22, 0), vn(19, 23, 0), WEEK)).toBe(0);
    expect(elapsedBusinessMs(vn(19, 5, 0), vn(19, 6, 0), WEEK)).toBe(0);
  });

  it("qua nửa đêm: cộng đuôi hôm nay + đầu hôm sau, KHÔNG cộng khoảng đêm", () => {
    // 20:30→21:00 = 30' ; 07:45→08:30 = 45'
    expect(elapsedBusinessMs(vn(19, 20, 30), vn(20, 8, 30), WEEK)).toBe(m(75));
  });

  it("mốc bắt đầu ngoài giờ, mốc kết thúc hôm sau trong giờ", () => {
    expect(elapsedBusinessMs(vn(19, 22, 0), vn(20, 8, 45), WEEK)).toBe(h(1));
  });

  it("trọn một ngày làm việc = 13h15", () => {
    expect(elapsedBusinessMs(vn(19, 0, 0), vn(20, 0, 0), WEEK)).toBe(FULL_DAY_MS);
    expect(FULL_DAY_MS).toBe(m(795));
  });

  it("nhiều ngày có xen ngày NGHỈ CỐ ĐỊNH (Thứ Hai)", () => {
    // T7 22: 09:00→21:00 = 12h · CN 23: trọn ngày · T2 24: nghỉ · T3 25: 07:45→09:00 = 75'
    const got = elapsedBusinessMs(vn(22, 9, 0), vn(25, 9, 0), WEEK);
    expect(got).toBe(h(12) + FULL_DAY_MS + m(75));
  });

  it("ngày lễ nằm giữa khoảng bị trừ ra", () => {
    const opts = { holidayKeys: new Set(["2026-08-20"]) };
    // Không lễ: T4 19 (09:00→21:00 = 12h) + T5 20 trọn ngày + T6 21 (07:45→09:00 = 75')
    expect(elapsedBusinessMs(vn(19, 9, 0), vn(21, 9, 0), WEEK)).toBe(h(12) + FULL_DAY_MS + m(75));
    // Có lễ ngày 20 → mất đúng một ngày làm việc.
    expect(elapsedBusinessMs(vn(19, 9, 0), vn(21, 9, 0), WEEK, opts)).toBe(h(12) + m(75));
  });

  it("mọi thứ đều nghỉ → 0 và dừng đúng trần", () => {
    const allClosed = buildWeek(() => CLOSED_DAY);
    expect(elapsedBusinessMs(vn(19, 0, 0), vn(19 + 30, 0, 0), allClosed)).toBe(0);
  });

  it("vượt trần maxSpanDays thì DỪNG — phần đã cộng vẫn lớn hơn mọi ngưỡng giờ-làm-việc", () => {
    // 19→22/08 có 3 ngày làm việc trọn vẹn (19,20,21); ép trần 2 ngày → chỉ còn 2.
    expect(elapsedBusinessMs(vn(19, 0, 0), vn(22, 0, 0), WEEK)).toBe(FULL_DAY_MS * 3);
    expect(elapsedBusinessMs(vn(19, 0, 0), vn(22, 0, 0), WEEK, { maxSpanDays: 2 })).toBe(
      FULL_DAY_MS * 2,
    );
  });
});

describe("resolveWorkingHourWeek — thứ tự rơi bậc", () => {
  const row = (over: Partial<WorkingHourRuleRow>): WorkingHourRuleRow => ({
    orgUnitId: "*",
    roleCode: "*",
    weekday: 3,
    openTime: "08:00",
    closeTime: "20:00",
    isClosed: false,
    ...over,
  });

  /** Đọc gọn một thứ để kỳ vọng dễ đọc. */
  const day = (week: WorkingHourWeek, weekday: number) => week[weekday];

  it("DB trống → lưới mặc định (T3–CN 07:45–21:00, nghỉ Thứ Hai)", () => {
    const week = resolveWorkingHourWeek([], "u1", "TEACHER");
    expect(day(week, 1)).toEqual(CLOSED_DAY);
    expect(day(week, 3)).toEqual({ isClosed: false, openMinute: 465, closeMinute: 1260 });
  });

  it("(đơn vị, vai) thắng (đơn vị, *) thắng (*, vai) thắng (*, *)", () => {
    const rows = [
      row({ orgUnitId: "*", roleCode: "*", openTime: "10:00", closeTime: "20:00" }),
      row({ orgUnitId: "*", roleCode: "TEACHER", openTime: "11:00", closeTime: "20:00" }),
      row({ orgUnitId: "u1", roleCode: "*", openTime: "12:00", closeTime: "20:00" }),
      row({ orgUnitId: "u1", roleCode: "TEACHER", openTime: "13:00", closeTime: "20:00" }),
    ];
    expect(day(resolveWorkingHourWeek(rows, "u1", "TEACHER"), 3).openMinute).toBe(13 * 60);
    expect(day(resolveWorkingHourWeek(rows.slice(0, 3), "u1", "TEACHER"), 3).openMinute).toBe(12 * 60);
    expect(day(resolveWorkingHourWeek(rows.slice(0, 2), "u1", "TEACHER"), 3).openMinute).toBe(11 * 60);
    expect(day(resolveWorkingHourWeek(rows.slice(0, 1), "u1", "TEACHER"), 3).openMinute).toBe(10 * 60);
  });

  it("không truyền vai → bỏ qua luật theo vai, dùng luật (đơn vị, *)", () => {
    const rows = [
      row({ orgUnitId: "u1", roleCode: "TEACHER", openTime: "13:00", closeTime: "20:00" }),
      row({ orgUnitId: "u1", roleCode: "*", openTime: "12:00", closeTime: "20:00" }),
    ];
    expect(day(resolveWorkingHourWeek(rows, "u1"), 3).openMinute).toBe(12 * 60);
    expect(day(resolveWorkingHourWeek(rows, "u1", null), 3).openMinute).toBe(12 * 60);
  });

  it("orgUnitId null → chỉ còn bậc toàn hệ thống", () => {
    const rows = [
      row({ orgUnitId: "u1", roleCode: "*", openTime: "12:00", closeTime: "20:00" }),
      row({ orgUnitId: "*", roleCode: "*", openTime: "10:00", closeTime: "20:00" }),
    ];
    expect(day(resolveWorkingHourWeek(rows, null), 3).openMinute).toBe(10 * 60);
  });

  it("rơi bậc theo TỪNG THỨ: khai riêng Thứ Bảy không xoá sổ 6 thứ còn lại", () => {
    const rows = [row({ orgUnitId: "u1", weekday: 6, openTime: "06:30", closeTime: "22:00" })];
    const week = resolveWorkingHourWeek(rows, "u1", "TEACHER");
    expect(day(week, 6)).toEqual({ isClosed: false, openMinute: 390, closeMinute: 1320 });
    expect(day(week, 3)).toEqual({ isClosed: false, openMinute: 465, closeMinute: 1260 }); // mặc định
    expect(day(week, 1)).toEqual(CLOSED_DAY); // vẫn nghỉ Thứ Hai
  });

  it("dòng của đơn vị KHÁC bị bỏ qua", () => {
    const rows = [row({ orgUnitId: "u2", openTime: "12:00", closeTime: "20:00" })];
    expect(day(resolveWorkingHourWeek(rows, "u1"), 3).openMinute).toBe(465);
  });

  it("isClosed = true là ngày nghỉ thật, kể cả khi có giờ kèm theo", () => {
    const rows = [row({ orgUnitId: "u1", weekday: 0, isClosed: true, openTime: "08:00" })];
    expect(day(resolveWorkingHourWeek(rows, "u1"), 0)).toEqual(CLOSED_DAY);
  });

  it("dòng HỎNG rơi xuống bậc sau, KHÔNG bị hiểu thành nghỉ", () => {
    // Một ô giờ gõ sai không được phép âm thầm đóng cửa cả cơ sở.
    const broken: WorkingHourRuleRow[] = [
      row({ orgUnitId: "u1", openTime: "8h", closeTime: "20:00" }), // rác
      row({ orgUnitId: "u1", weekday: 4, openTime: null, closeTime: null }), // mở mà thiếu giờ
      row({ orgUnitId: "u1", weekday: 5, openTime: "20:00", closeTime: "08:00" }), // ca qua đêm — chưa duyệt
      row({ orgUnitId: "u1", weekday: 2, openTime: "09:00", closeTime: "09:00" }), // rỗng
    ];
    const week = resolveWorkingHourWeek(broken, "u1");
    for (const wd of [2, 3, 4, 5]) {
      expect({ wd, day: day(week, wd) }).toEqual({
        wd,
        day: { isClosed: false, openMinute: 465, closeMinute: 1260 },
      });
    }
    // Có bậc dưới hợp lệ thì rơi xuống bậc đó chứ không rơi thẳng về mặc định.
    const withFallback = resolveWorkingHourWeek(
      [...broken, row({ orgUnitId: "*", openTime: "10:00", closeTime: "20:00" })],
      "u1",
    );
    expect(day(withFallback, 3).openMinute).toBe(10 * 60);
  });

  it("weekday ngoài 0..6 bị bỏ qua thay vì làm hỏng mảng tuần", () => {
    const rows = [row({ orgUnitId: "u1", weekday: 9, openTime: "12:00", closeTime: "20:00" })];
    const week = resolveWorkingHourWeek(rows, "u1");
    expect(week).toHaveLength(7);
    expect(day(week, 3).openMinute).toBe(465);
  });

  it("bảng tuần suy ra chạy được ngay với isWorkingTime", () => {
    const rows = [row({ orgUnitId: "u1", weekday: 3, openTime: "10:00", closeTime: "12:00" })];
    const week = resolveWorkingHourWeek(rows, "u1");
    expect(isWorkingTime(vn(19, 9, 59), week)).toBe(false);
    expect(isWorkingTime(vn(19, 10, 0), week)).toBe(true);
    expect(isWorkingTime(vn(19, 12, 0), week)).toBe(false);
  });
});
