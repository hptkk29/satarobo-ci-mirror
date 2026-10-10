// lib/working-hours/form.test.ts — kiểm phần CHUYỂN ĐỔI + VALIDATE của màn quản trị giờ
// làm việc. Thuần, không DB, không session.
//
// Trọng tâm là bốn chỗ đã từng đủ sức làm hỏng dữ liệu ở repo này nếu sai:
//  1. Phân biệt "chưa khai" (kế thừa) với "khai trùng giá trị" — hai thứ nhìn giống nhau.
//  2. "" ↔ null khi bật/tắt nghỉ cả ngày.
//  3. Nút "áp dụng cho các ngày còn lại" KHÔNG được mở cửa ngày đang nghỉ.
//  4. Cửa sổ `close <= open` — engine coi là dòng hỏng và im lặng bỏ qua, nên nếu Zod
//     không chặn thì người dùng không bao giờ biết mình khai hụt.

import { describe, expect, it } from "vitest";
import {
  WEEKDAY_DISPLAY_ORDER,
  applyHoursToOtherDays,
  buildFormDays,
  daysToPayload,
  describeDay,
  firstIssueMessage,
  toRuleRows,
  weekdaysToClear,
  workingHourFormSchema,
  type WorkingHourDayForm,
} from "./form";
import {
  CLOSED_DAY,
  DEFAULT_WORKING_HOUR_WEEK,
  buildWeek,
  type WorkingHourRuleRow,
} from "./rules";

const OPEN_745_2100 = { isClosed: false, openMinute: 7 * 60 + 45, closeMinute: 21 * 60 };

function row(partial: Partial<WorkingHourRuleRow> & { weekday: number }): WorkingHourRuleRow {
  return {
    orgUnitId: "ou-cs1",
    roleCode: "*",
    openTime: "08:00",
    closeTime: "20:00",
    isClosed: false,
    ...partial,
  };
}

function formDay(partial: Partial<WorkingHourDayForm> & { weekday: number }): WorkingHourDayForm {
  return {
    declared: false,
    isClosed: false,
    openTime: "07:45",
    closeTime: "21:00",
    inheritedLabel: "07:45 – 21:00",
    ...partial,
  };
}

describe("WEEKDAY_DISPLAY_ORDER", () => {
  it("hiển thị Thứ Hai trước, Chủ nhật cuối — nhưng vẫn là chỉ số 0=CN…6=T7", () => {
    expect(WEEKDAY_DISPLAY_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect([...WEEKDAY_DISPLAY_ORDER].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("describeDay", () => {
  it("ngày nghỉ đọc thành chữ, không thành '00:00 – 00:00'", () => {
    expect(describeDay(CLOSED_DAY)).toBe("Nghỉ cả ngày");
  });

  it("ngày mở hiện đủ hai mốc giờ", () => {
    expect(describeDay(OPEN_745_2100)).toBe("07:45 – 21:00");
  });
});

describe("buildFormDays", () => {
  it("không có dòng riêng nào → cả 7 thứ đều là KẾ THỪA, giá trị lấy từ bậc trên", () => {
    const days = buildFormDays([], DEFAULT_WORKING_HOUR_WEEK);
    expect(days).toHaveLength(7);
    expect(days.every((d) => !d.declared)).toBe(true);
    // Thứ Hai nghỉ theo mặc định hệ thống → hai ô giờ phải rỗng, không phải "00:00".
    const monday = days[1];
    expect(monday.isClosed).toBe(true);
    expect(monday.openTime).toBe("");
    expect(monday.closeTime).toBe("");
    expect(days[2].openTime).toBe("07:45");
    expect(days[2].closeTime).toBe("21:00");
  });

  it("khai riêng TRÙNG giá trị bậc trên vẫn phải hiện là 'khai riêng'", () => {
    // Đây chính là ca mà nếu chỉ so giá trị thì người dùng không phân biệt được
    // "chưa khai" với "đã khai, trùng số".
    const inherited = buildWeek(() => OPEN_745_2100);
    const days = buildFormDays(
      [row({ weekday: 3, openTime: "07:45", closeTime: "21:00" })],
      inherited,
    );
    expect(days[3].declared).toBe(true);
    expect(days[3].openTime).toBe("07:45");
    expect(days[2].declared).toBe(false);
  });

  it("mảng trả về xếp theo CHỈ SỐ THỨ, không theo thứ tự hiển thị", () => {
    const days = buildFormDays([], DEFAULT_WORKING_HOUR_WEEK);
    expect(days.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("dòng riêng đánh dấu nghỉ thì bỏ giờ, dù DB còn sót giờ cũ", () => {
    const days = buildFormDays(
      [row({ weekday: 5, isClosed: true, openTime: "08:00", closeTime: "20:00" })],
      DEFAULT_WORKING_HOUR_WEEK,
    );
    expect(days[5]).toMatchObject({ declared: true, isClosed: true, openTime: "", closeTime: "" });
  });

  it("luôn kèm nhãn giá trị bậc trên để người dùng so được", () => {
    const inherited = buildWeek((w) => (w === 0 ? CLOSED_DAY : OPEN_745_2100));
    const days = buildFormDays([row({ weekday: 0, isClosed: true })], inherited);
    expect(days[0].inheritedLabel).toBe("Nghỉ cả ngày");
    expect(days[1].inheritedLabel).toBe("07:45 – 21:00");
  });
});

describe("applyHoursToOtherDays", () => {
  const base: WorkingHourDayForm[] = [
    formDay({ weekday: 0 }),
    formDay({ weekday: 1, isClosed: true, openTime: "", closeTime: "" }),
    formDay({ weekday: 2, openTime: "08:00", closeTime: "20:00", declared: true }),
    formDay({ weekday: 3 }),
    formDay({ weekday: 4 }),
    formDay({ weekday: 5 }),
    formDay({ weekday: 6 }),
  ];

  it("chép giờ sang các thứ khác và đánh dấu chúng là khai riêng", () => {
    const out = applyHoursToOtherDays(base, 2);
    expect(out[3]).toMatchObject({ openTime: "08:00", closeTime: "20:00", declared: true });
    expect(out[0]).toMatchObject({ openTime: "08:00", closeTime: "20:00", declared: true });
  });

  it("KHÔNG mở cửa ngày đang nghỉ — Thứ Hai vẫn nghỉ sau khi áp dụng", () => {
    const out = applyHoursToOtherDays(base, 2);
    expect(out[1]).toMatchObject({ isClosed: true, openTime: "", closeTime: "", declared: false });
  });

  it("nguồn là ngày nghỉ → không đổi gì (không có giờ để chép)", () => {
    const out = applyHoursToOtherDays(base, 1);
    expect(out).toEqual(base);
  });

  it("không sửa mảng gốc (state React phải là mảng mới)", () => {
    const snapshot = JSON.stringify(base);
    applyHoursToOtherDays(base, 2);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe("daysToPayload", () => {
  it("chỉ gửi thứ được khai riêng — thứ kế thừa bị bỏ ra để server xoá dòng cũ", () => {
    const days = [
      formDay({ weekday: 0 }),
      formDay({ weekday: 1, declared: true, isClosed: true, openTime: "", closeTime: "" }),
      formDay({ weekday: 2, declared: true, openTime: "08:00", closeTime: "20:00" }),
    ];
    expect(daysToPayload(days)).toEqual([
      { weekday: 1, isClosed: true, openTime: "", closeTime: "" },
      { weekday: 2, isClosed: false, openTime: "08:00", closeTime: "20:00" },
    ]);
  });

  it("ngày nghỉ luôn gửi giờ rỗng, kể cả khi ô giờ còn giá trị cũ trong state", () => {
    const days = [
      formDay({ weekday: 4, declared: true, isClosed: true, openTime: "08:00", closeTime: "20:00" }),
    ];
    expect(daysToPayload(days)).toEqual([
      { weekday: 4, isClosed: true, openTime: "", closeTime: "" },
    ]);
  });
});

describe("workingHourFormSchema", () => {
  const ok = {
    centerId: "center-1",
    roleCode: "*",
    days: [{ weekday: 2, isClosed: false, openTime: "07:45", closeTime: "21:00" }],
  };

  it("nhận dữ liệu hợp lệ", () => {
    expect(workingHourFormSchema.safeParse(ok).success).toBe(true);
  });

  it("danh sách rỗng là HỢP LỆ — đó là cách đưa cả tuần về kế thừa", () => {
    expect(workingHourFormSchema.safeParse({ ...ok, days: [] }).success).toBe(true);
  });

  it("thiếu mã cơ sở → chặn", () => {
    const res = workingHourFormSchema.safeParse({ ...ok, centerId: "  " });
    expect(res.success).toBe(false);
    if (!res.success) expect(firstIssueMessage(res.error)).toContain("mã cơ sở");
  });

  it("thiếu mã vai → chặn (rỗng KHÔNG được ngầm hiểu thành '*')", () => {
    const res = workingHourFormSchema.safeParse({ ...ok, roleCode: "" });
    expect(res.success).toBe(false);
    if (!res.success) expect(firstIssueMessage(res.error)).toContain("vai trò");
  });

  it("giờ sai định dạng → chặn, kèm tên thứ trong thông báo", () => {
    const res = workingHourFormSchema.safeParse({
      ...ok,
      days: [{ weekday: 6, isClosed: false, openTime: "7:45", closeTime: "21:00" }],
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(firstIssueMessage(res.error)).toBe(
        "Thứ Bảy: giờ mở cửa phải dạng HH:mm (ví dụ 07:45)",
      );
    }
  });

  it("24:00 bị từ chối — giờ đóng phải là mốc cùng ngày", () => {
    const res = workingHourFormSchema.safeParse({
      ...ok,
      days: [{ weekday: 2, isClosed: false, openTime: "07:45", closeTime: "24:00" }],
    });
    expect(res.success).toBe(false);
  });

  it("giờ mở >= giờ đóng → chặn (engine sẽ im lặng bỏ qua dòng này)", () => {
    const res = workingHourFormSchema.safeParse({
      ...ok,
      days: [{ weekday: 3, isClosed: false, openTime: "21:00", closeTime: "07:45" }],
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(firstIssueMessage(res.error)).toBe("Thứ Tư: giờ mở cửa phải sớm hơn giờ đóng cửa");
    }
  });

  it("mở = đóng → chặn (cửa sổ rỗng)", () => {
    const res = workingHourFormSchema.safeParse({
      ...ok,
      days: [{ weekday: 3, isClosed: false, openTime: "09:00", closeTime: "09:00" }],
    });
    expect(res.success).toBe(false);
  });

  it("nghỉ cả ngày mà vẫn gửi giờ → chặn thay vì im lặng bỏ giờ", () => {
    const res = workingHourFormSchema.safeParse({
      ...ok,
      days: [{ weekday: 1, isClosed: true, openTime: "07:45", closeTime: "21:00" }],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(firstIssueMessage(res.error)).toContain("Thứ Hai");
  });

  it("nghỉ cả ngày + giờ rỗng → hợp lệ", () => {
    const res = workingHourFormSchema.safeParse({
      ...ok,
      days: [{ weekday: 1, isClosed: true, openTime: "", closeTime: "" }],
    });
    expect(res.success).toBe(true);
  });

  it("khai trùng một thứ hai lần → chặn (DB có @@unique, nhưng lỗi ở đây mới đọc được)", () => {
    const res = workingHourFormSchema.safeParse({
      ...ok,
      days: [
        { weekday: 2, isClosed: false, openTime: "07:45", closeTime: "21:00" },
        { weekday: 2, isClosed: true, openTime: "", closeTime: "" },
      ],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(firstIssueMessage(res.error)).toContain("bị khai hai lần");
  });

  it("quá 7 thứ → chặn", () => {
    const days = Array.from({ length: 8 }, () => ({
      weekday: 2,
      isClosed: true,
      openTime: "",
      closeTime: "",
    }));
    expect(workingHourFormSchema.safeParse({ ...ok, days }).success).toBe(false);
  });

  it("thứ ngoài 0..6 → chặn", () => {
    const res = workingHourFormSchema.safeParse({
      ...ok,
      days: [{ weekday: 7, isClosed: true, openTime: "", closeTime: "" }],
    });
    expect(res.success).toBe(false);
  });
});

describe("toRuleRows", () => {
  it("gắn đúng orgUnitId + roleCode cho mọi dòng", () => {
    const parsed = workingHourFormSchema.parse({
      centerId: "center-1",
      roleCode: "TEACHER",
      days: [{ weekday: 2, isClosed: false, openTime: "08:00", closeTime: "20:00" }],
    });
    expect(toRuleRows("ou-cs1", parsed)).toEqual([
      {
        orgUnitId: "ou-cs1",
        roleCode: "TEACHER",
        weekday: 2,
        openTime: "08:00",
        closeTime: "20:00",
        isClosed: false,
      },
    ]);
  });

  it("ngày nghỉ ghi NULL, không ghi chuỗi rỗng vào cột giờ", () => {
    const parsed = workingHourFormSchema.parse({
      centerId: "center-1",
      roleCode: "*",
      days: [{ weekday: 1, isClosed: true, openTime: "", closeTime: "" }],
    });
    const rows = toRuleRows("ou-cs1", parsed);
    expect(rows[0].openTime).toBeNull();
    expect(rows[0].closeTime).toBeNull();
    expect(rows[0].isClosed).toBe(true);
  });
});

describe("weekdaysToClear", () => {
  it("thứ không được khai → nằm trong danh sách xoá (đường 'trả về kế thừa')", () => {
    const parsed = workingHourFormSchema.parse({
      centerId: "center-1",
      roleCode: "*",
      days: [
        { weekday: 1, isClosed: true, openTime: "", closeTime: "" },
        { weekday: 2, isClosed: false, openTime: "07:45", closeTime: "21:00" },
      ],
    });
    expect(weekdaysToClear(parsed)).toEqual([0, 3, 4, 5, 6]);
  });

  it("không khai gì → xoá cả 7 thứ", () => {
    const parsed = workingHourFormSchema.parse({
      centerId: "center-1",
      roleCode: "*",
      days: [],
    });
    expect(weekdaysToClear(parsed)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
