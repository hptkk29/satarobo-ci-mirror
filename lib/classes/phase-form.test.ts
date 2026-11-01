// Chuỗi biến đổi KẾ HOẠCH LỊCH: form → payload → miền nghiệp vụ → bản sao lịch phẳng.
//
// Vì sao đáng test riêng: từ 08/08 đây là ĐƯỜNG DUY NHẤT để khai lịch một lớp (ba ô cũ
// "Lịch học trong tuần / Giờ bắt đầu / Giờ kết thúc / Giờ riêng theo thứ" đã bỏ). Sai một
// mắt xích là lớp tạo ra có lịch rỗng — mà lịch rỗng không ném lỗi, nó chỉ làm bảng công
// GV về 0 giờ, lưới lịch tuần mất lớp và PDF in "—".

import { describe, it, expect } from "vitest";
import {
  firstPhaseFlatSchedule,
  nextYmd,
  toPhaseInputs,
  type PhaseFormValue,
} from "@/lib/classes/phase-form";
import {
  flatScheduleAtStart,
  phaseFromFlatSchedule,
  phaseInputsToDomain,
  validatePhases,
} from "@/lib/classes/phases";
import { parseVnYmd, vnYmd } from "@/lib/time/vn";

const phase = (p: Partial<PhaseFormValue>): PhaseFormValue => ({
  from: "",
  to: "",
  note: "",
  days: {},
  ...p,
});

describe("toPhaseInputs", () => {
  it("sắp thứ theo tuần học (T2…T7 rồi CN), không theo số 0..6", () => {
    const out = toPhaseInputs([
      phase({
        from: "2026-08-10",
        days: {
          0: { start: "08:00", end: "10:00" },
          1: { start: "17:30", end: "19:00" },
        },
      }),
    ]);
    expect(out[0].slots.map((s) => s.weekday)).toEqual([1, 0]);
  });

  it("thứ không bật thì không lọt vào payload", () => {
    const out = toPhaseInputs([
      phase({ from: "2026-08-10", days: { 3: { start: "17:30", end: "19:00" } } }),
    ]);
    expect(out[0].slots).toHaveLength(1);
    expect(out[0].slots[0]).toEqual({ weekday: 3, startTime: "17:30", endTime: "19:00" });
  });
});

describe("phaseInputsToDomain", () => {
  it("ngày đi qua lịch VN — 00:00 giờ VN, KHÔNG phải nửa đêm UTC", () => {
    const res = phaseInputsToDomain([
      { from: "2026-08-12", to: "", slots: [{ weekday: 1, startTime: "17:30", endTime: "19:00" }] },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // `new Date("2026-08-12")` ra 07:00 giờ VN và ăn mất buổi sáng của chính ngày đó.
    expect(vnYmd(res.phases[0].effectiveFrom)).toBe("2026-08-12");
    expect(res.phases[0].effectiveFrom.getTime()).toBe(parseVnYmd("2026-08-12")!.getTime());
  });

  it('ô "đến ngày" bỏ trống = giai đoạn mở', () => {
    const res = phaseInputsToDomain([
      { from: "2026-08-12", to: "  ", slots: [{ weekday: 1, startTime: "17:30", endTime: "" }] },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.phases[0].effectiveTo).toBeNull();
    // Giờ kết thúc rỗng → null, không phải chuỗi "" (cột DB nullable).
    expect(res.phases[0].slots[0].endTime).toBeNull();
  });

  it("thiếu ngày bắt đầu thì BÁO LỖI kèm số giai đoạn, không nuốt im lặng", () => {
    const res = phaseInputsToDomain([
      { from: "2026-08-12", to: "2026-08-31", slots: [] },
      { from: "", to: "", slots: [] },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Giai đoạn 2");
  });

  it("ngày kết thúc rác thì báo lỗi chứ không lặng lẽ thành giai đoạn mở", () => {
    const res = phaseInputsToDomain([
      { from: "2026-08-12", to: "31/08/2026", slots: [] },
    ]);
    expect(res.ok).toBe(false);
  });
});

describe("form → domain → validate (đúng đường form tạo lớp đi)", () => {
  const run = (phases: PhaseFormValue[]) => {
    const mapped = phaseInputsToDomain(toPhaseInputs(phases));
    if (!mapped.ok) return [mapped.error];
    return validatePhases(mapped.phases);
  };

  it("kế hoạch 2 giai đoạn nối nhau: hợp lệ", () => {
    expect(
      run([
        phase({
          from: "2026-08-01",
          to: "2026-08-31",
          days: { 1: { start: "17:30", end: "19:00" }, 5: { start: "17:30", end: "19:00" } },
        }),
        phase({ from: "2026-09-01", days: { 1: { start: "08:00", end: "10:00" } } }),
      ]),
    ).toEqual([]);
  });

  it("bật thứ nhưng chưa gõ giờ → chặn (nếu lọt, buổi sẽ sinh lúc 00:00)", () => {
    const errs = run([phase({ from: "2026-08-01", days: { 1: { start: "", end: "" } } })]);
    expect(errs.join(" ")).toContain("HH:mm");
  });

  it("không bật thứ nào → chặn", () => {
    expect(run([phase({ from: "2026-08-01" })]).join(" ")).toContain("chưa chọn thứ");
  });
});

describe("flatScheduleAtStart — bản sao lịch phẳng ghi lúc TẠO lớp", () => {
  const plan = phaseInputsToDomain([
    {
      from: "2026-09-01",
      to: "",
      slots: [
        { weekday: 1, startTime: "17:30", endTime: "19:00" },
        { weekday: 5, startTime: "08:00", endTime: "10:00" },
      ],
    },
  ]);

  it("lớp khai giảng ở TƯƠNG LAI vẫn ra bản sao (không rỗng)", () => {
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // `legacyScheduleFromPhases(phases, hôm nay)` trả null ở đây — đó là lý do hàm này tồn tại.
    const flat = flatScheduleAtStart(plan.phases, parseVnYmd("2026-09-01"));
    expect(flat.scheduleDays).toEqual([1, 5]);
    expect(flat.startTime).toBe("17:30");
    expect(flat.slots).toHaveLength(2);
  });

  it("khai giảng TRƯỚC giai đoạn đầu → lùi về giai đoạn đầu, vẫn không rỗng", () => {
    if (!plan.ok) return;
    const flat = flatScheduleAtStart(plan.phases, parseVnYmd("2026-06-01"));
    expect(flat.scheduleDays).toEqual([1, 5]);
  });

  it("chọn ĐÚNG giai đoạn phủ ngày khai giảng khi có nhiều giai đoạn", () => {
    const two = phaseInputsToDomain([
      {
        from: "2026-08-01",
        to: "2026-08-31",
        slots: [{ weekday: 2, startTime: "14:00", endTime: "16:00" }],
      },
      { from: "2026-09-01", to: "", slots: [{ weekday: 1, startTime: "17:30", endTime: "19:00" }] },
    ]);
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(flatScheduleAtStart(two.phases, parseVnYmd("2026-09-15")).scheduleDays).toEqual([1]);
    expect(flatScheduleAtStart(two.phases, parseVnYmd("2026-08-15")).scheduleDays).toEqual([2]);
  });

  it("kế hoạch rỗng → rỗng (không ném)", () => {
    expect(flatScheduleAtStart([], parseVnYmd("2026-09-01"))).toEqual({
      scheduleDays: [],
      startTime: null,
      endTime: null,
      slots: [],
    });
  });
});

describe("phaseFromFlatSchedule — đường nhập Excel dựng 1 giai đoạn mở", () => {
  it("lịch phẳng đủ thứ + giờ → 1 giai đoạn mở từ ngày khai giảng", () => {
    const p = phaseFromFlatSchedule({
      scheduleDays: [1, 5],
      startTime: "17:30",
      endTime: "19:00",
      startDate: parseVnYmd("2026-08-03"),
    });
    expect(p).not.toBeNull();
    expect(vnYmd(p!.effectiveFrom)).toBe("2026-08-03");
    expect(p!.effectiveTo).toBeNull();
    expect(p!.slots.map((s) => s.weekday)).toEqual([1, 5]);
    expect(validatePhases([p!])).toEqual([]);
  });

  it("file thiếu giờ → KHÔNG dựng kế hoạch rác (lớp chạy lịch phẳng như trước)", () => {
    expect(
      phaseFromFlatSchedule({
        scheduleDays: [1],
        startTime: null,
        endTime: null,
        startDate: parseVnYmd("2026-08-03"),
      }),
    ).toBeNull();
  });

  it("file không khai thứ nào → null", () => {
    expect(
      phaseFromFlatSchedule({
        scheduleDays: [],
        startTime: "17:30",
        endTime: "19:00",
        startDate: parseVnYmd("2026-08-03"),
      }),
    ).toBeNull();
  });
});

describe("firstPhaseFlatSchedule — chỉ để gợi ý TÊN LỚP", () => {
  it("lấy giai đoạn có ngày bắt đầu SỚM NHẤT, không phải phần tử đầu mảng", () => {
    const flat = firstPhaseFlatSchedule([
      phase({ from: "2026-09-01", days: { 1: { start: "08:00", end: "10:00" } } }),
      phase({ from: "2026-08-01", days: { 6: { start: "15:45", end: "17:15" } } }),
    ]);
    expect(flat.scheduleDays).toEqual([6]);
    expect(flat.startTime).toBe("15:45");
  });

  it("bỏ qua giai đoạn chưa bật thứ nào (form đang gõ dở)", () => {
    const flat = firstPhaseFlatSchedule([
      phase({ from: "2026-08-01" }),
      phase({ from: "2026-08-10", days: { 3: { start: "17:30", end: "19:00" } } }),
    ]);
    expect(flat.scheduleDays).toEqual([3]);
  });

  it("chưa gõ gì → rỗng, tên lớp giữ nguyên phần người dùng tự nhập", () => {
    expect(firstPhaseFlatSchedule([phase({})])).toEqual({
      scheduleDays: [],
      startTime: null,
      slots: [],
    });
  });
});

describe("nextYmd — giai đoạn mới nối ngay sau giai đoạn trước", () => {
  it("cộng 1 ngày bằng số học UTC (không dính TZ máy)", () => {
    expect(nextYmd("2026-08-31")).toBe("2026-09-01");
    expect(nextYmd("2026-12-31")).toBe("2027-01-01");
    expect(nextYmd("2028-02-28")).toBe("2028-02-29"); // năm nhuận
  });

  it("chuỗi rác → rỗng, không ném", () => {
    expect(nextYmd("")).toBe("");
    expect(nextYmd("31/08/2026")).toBe("");
  });
});
