// lib/classes/phases.test.ts — chốt lõi "kế hoạch lịch học nhiều giai đoạn".
//
// ⚠️ `vitest.config.ts` KHÔNG ép TZ ⇒ test xanh ở máy dev (+07) không chứng minh được
// gì cho Vercel (UTC). Mọi mốc ở đây dựng bằng `vnDateAt` và assert bằng **ISO tuyệt
// đối** hoặc `vnYmd`, không dùng `new Date(y,m,d)` / `getDay()`.
//
// Mốc lịch dùng trong test (đã kiểm): 01/07/2026 = Thứ 4 · 07/08/2026 = Thứ 6.
import { describe, expect, it } from "vitest";
import { vnDateAt, vnYmd } from "@/lib/time/vn";
import {
  assignPhasedDates,
  computePhasedSessionDates,
  findScheduleGaps,
  classSlotsAt,
  legacyPhaseFromClass,
  legacyScheduleFromPhases,
  phaseForDate,
  slotForDate,
  validatePhases,
  type SchedulePhase,
} from "./phases";

const d = (y: number, m1: number, day: number) => vnDateAt(y, m1 - 1, day);
const keys = (dates: Date[]) => dates.map(vnYmd);
const NO_HOLIDAY = new Set<string>();

/** Tháng 7: T5+T2 lúc 17:30. Tháng 8 trở đi: chỉ T4 lúc 08:00 (giai đoạn mở). */
const TWO_PHASES: SchedulePhase[] = [
  {
    effectiveFrom: d(2026, 7, 1),
    effectiveTo: d(2026, 7, 31),
    slots: [
      { weekday: 1, startTime: "17:30", endTime: "19:00" },
      { weekday: 4, startTime: "17:30", endTime: "19:00" },
    ],
  },
  {
    effectiveFrom: d(2026, 8, 1),
    effectiveTo: null,
    slots: [{ weekday: 3, startTime: "08:00", endTime: "09:30" }],
  },
];

describe("computePhasedSessionDates", () => {
  it("đổi nhịp giữa khoá: 2 buổi/tuần (T7) → 1 buổi/tuần (T8)", () => {
    const r = computePhasedSessionDates({
      from: d(2026, 7, 1),
      count: 12,
      phases: TWO_PHASES,
      holidays: NO_HOLIDAY,
    });
    expect(r.exhausted).toBe(false);
    expect(keys(r.dates)).toEqual([
      "2026-07-02", "2026-07-06", "2026-07-09", "2026-07-13",
      "2026-07-16", "2026-07-20", "2026-07-23", "2026-07-27",
      "2026-07-30",
      "2026-08-05", "2026-08-12", "2026-08-19",
    ]);
  });

  it("giờ đi theo giai đoạn — 17:30 tháng 7, 08:00 tháng 8 (ISO tuyệt đối, TZ-proof)", () => {
    const r = computePhasedSessionDates({
      from: d(2026, 7, 1),
      count: 10,
      phases: TWO_PHASES,
      holidays: NO_HOLIDAY,
    });
    // 17:30 giờ VN = 10:30Z; 08:00 giờ VN = 01:00Z.
    expect(r.dates[0].toISOString()).toBe("2026-07-02T10:30:00.000Z");
    expect(r.dates[9].toISOString()).toBe("2026-08-05T01:00:00.000Z");
  });

  it("buổi rơi ngày nghỉ bị ĐẨY sang buổi kế, tổng buổi giữ nguyên", () => {
    const r = computePhasedSessionDates({
      from: d(2026, 7, 1),
      count: 4,
      phases: TWO_PHASES,
      holidays: new Set(["2026-07-06", "2026-07-09"]),
    });
    expect(keys(r.dates)).toEqual([
      "2026-07-02", "2026-07-13", "2026-07-16", "2026-07-20",
    ]);
    expect(r.exhausted).toBe(false);
  });

  it("KHÔNG xếp buổi vào ngày đã bị buổi khoá chiếm (blockedDays)", () => {
    const r = computePhasedSessionDates({
      from: d(2026, 7, 1),
      count: 3,
      phases: TWO_PHASES,
      holidays: NO_HOLIDAY,
      blockedDays: new Set(["2026-07-02", "2026-07-13"]),
    });
    expect(keys(r.dates)).toEqual(["2026-07-06", "2026-07-09", "2026-07-16"]);
  });

  it("khoảng TRỐNG giữa 2 giai đoạn = lớp nghỉ, không sinh buổi trong đó", () => {
    const phases: SchedulePhase[] = [
      {
        effectiveFrom: d(2026, 7, 1),
        effectiveTo: d(2026, 7, 10),
        slots: [{ weekday: 4, startTime: "17:30", endTime: null }],
      },
      {
        effectiveFrom: d(2026, 8, 1),
        effectiveTo: null,
        slots: [{ weekday: 4, startTime: "17:30", endTime: null }],
      },
    ];
    const r = computePhasedSessionDates({
      from: d(2026, 7, 1),
      count: 4,
      phases,
      holidays: NO_HOLIDAY,
    });
    // T5 trong khoảng nghỉ 11/07–31/07 (16/07, 23/07, 30/07) bị bỏ qua.
    expect(keys(r.dates)).toEqual([
      "2026-07-02", "2026-07-09", "2026-08-06", "2026-08-13",
    ]);
  });

  it("mọi giai đoạn ĐÓNG mà chưa đủ buổi → exhausted, KHÔNG im lặng trả thiếu", () => {
    const phases: SchedulePhase[] = [
      {
        effectiveFrom: d(2026, 7, 1),
        effectiveTo: d(2026, 7, 15),
        slots: [{ weekday: 1, startTime: "17:30", endTime: null }],
      },
    ];
    const r = computePhasedSessionDates({
      from: d(2026, 7, 1),
      count: 10,
      phases,
      holidays: NO_HOLIDAY,
    });
    expect(keys(r.dates)).toEqual(["2026-07-06", "2026-07-13"]);
    expect(r.exhausted).toBe(true);
  });

  it("from nằm TRƯỚC giai đoạn đầu → chờ tới giai đoạn, không bỏ cuộc", () => {
    const r = computePhasedSessionDates({
      from: d(2026, 5, 1),
      count: 2,
      phases: TWO_PHASES,
      holidays: NO_HOLIDAY,
    });
    expect(keys(r.dates)).toEqual(["2026-07-02", "2026-07-06"]);
  });

  it("from nằm GIỮA khoá → chỉ xếp từ mốc đó (ca 'áp dụng từ ngày')", () => {
    const r = computePhasedSessionDates({
      from: d(2026, 7, 20),
      count: 3,
      phases: TWO_PHASES,
      holidays: NO_HOLIDAY,
    });
    expect(keys(r.dates)).toEqual(["2026-07-20", "2026-07-23", "2026-07-27"]);
  });

  it("HỒI QUY untilKey: quét phủ tới buổi khoá xa rồi mới đếm đủ count", () => {
    const open: SchedulePhase[] = [
      {
        effectiveFrom: d(2026, 7, 1),
        effectiveTo: null,
        slots: [{ weekday: 1, startTime: "17:30", endTime: null }], // T2 hằng tuần
      },
    ];
    // Không có untilKey: 3 ứng viên đầu tiên, dừng ở 13/07.
    const plain = computePhasedSessionDates({
      from: d(2026, 7, 1),
      count: 3,
      phases: open,
      holidays: NO_HOLIDAY,
    });
    expect(keys(plain.dates)).toEqual(["2026-07-06", "2026-07-13", "2026-07-20"]);

    // Có untilKey = 24/08: phải phủ hết T2 tới 24/08 RỒI mới thêm 3 ứng viên nữa.
    const withUntil = computePhasedSessionDates({
      from: d(2026, 7, 1),
      count: 3,
      phases: open,
      holidays: NO_HOLIDAY,
      untilKey: "2026-08-24",
    });
    expect(withUntil.exhausted).toBe(false);
    expect(keys(withUntil.dates)).toEqual([
      "2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27",
      "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24",
      "2026-08-31", "2026-09-07", "2026-09-14",
    ]);
  });

  it("untilKey + giai đoạn ĐÓNG: hết kế hoạch trước khi đủ count → exhausted", () => {
    const closed: SchedulePhase[] = [
      {
        effectiveFrom: d(2026, 7, 1),
        effectiveTo: d(2026, 7, 20),
        slots: [{ weekday: 1, startTime: "17:30", endTime: null }],
      },
    ];
    const r = computePhasedSessionDates({
      from: d(2026, 7, 1),
      count: 3,
      phases: closed,
      holidays: NO_HOLIDAY,
      untilKey: "2026-07-13",
    });
    // Sau 13/07 chỉ còn 20/07 → 1 < 3 ứng viên.
    expect(keys(r.dates)).toEqual(["2026-07-06", "2026-07-13", "2026-07-20"]);
    expect(r.exhausted).toBe(true);
  });

  it("count = 0 hoặc không có giai đoạn nào → rỗng", () => {
    expect(
      computePhasedSessionDates({ from: d(2026, 7, 1), count: 0, phases: TWO_PHASES, holidays: NO_HOLIDAY }).dates,
    ).toEqual([]);
    const none = computePhasedSessionDates({ from: d(2026, 7, 1), count: 3, phases: [], holidays: NO_HOLIDAY });
    expect(none.dates).toEqual([]);
    expect(none.exhausted).toBe(true);
  });
});

describe("assignPhasedDates — giữ thứ tự buổi khi né buổi đã khoá", () => {
  /** Ứng viên theo TWO_PHASES kể từ 01/07, dư chỗ để né. */
  const candidates = (from: Date, count: number, blocked?: Set<string>) =>
    computePhasedSessionDates({ from, count, phases: TWO_PHASES, holidays: NO_HOLIDAY, blockedDays: blocked })
      .dates;

  const S = (id: string, y: number, m: number, day: number, lock: string | null = null) => ({
    id,
    date: d(y, m, day),
    lockReason: lock,
  });

  it("không có buổi khoá → rải tuần tự theo kế hoạch", () => {
    const r = assignPhasedDates({
      sessions: [S("a", 2026, 7, 2), S("b", 2026, 7, 6), S("c", 2026, 7, 9)],
      from: d(2026, 7, 1),
      candidates: candidates(d(2026, 7, 1), 6),
    });
    expect(r.ranOut).toBe(false);
    expect(r.items.map((i) => (i.newDate ? vnYmd(i.newDate) : "giữ"))).toEqual([
      "2026-07-02", "2026-07-06", "2026-07-09",
    ]);
  });

  it("buổi khoá giữa dãy: buổi SAU nó không được nhảy lên trước (giáo trình không chạy ngược)", () => {
    const blocked = new Set(["2026-07-20"]);
    const r = assignPhasedDates({
      sessions: [
        S("b10", 2026, 7, 6),
        S("b11", 2026, 7, 20, "đã điểm danh"), // khoá, đứng nguyên 20/07
        S("b12", 2026, 7, 23),
        S("b13", 2026, 7, 27),
      ],
      from: d(2026, 7, 1),
      candidates: candidates(d(2026, 7, 1), 12, blocked),
    });
    expect(r.ranOut).toBe(false);
    const got = r.items.map((i) => ({ id: i.id, at: i.newDate ? vnYmd(i.newDate) : "giữ " + vnYmd(i.oldDate) }));
    expect(got).toEqual([
      { id: "b10", at: "2026-07-02" },
      { id: "b11", at: "giữ 2026-07-20" },
      { id: "b12", at: "2026-07-23" }, // KHÔNG phải 06/07 dù ngày đó còn trống
      { id: "b13", at: "2026-07-27" },
    ]);
    // Bất biến: ngày (mới hoặc giữ nguyên) phải tăng dần qua cả dãy.
    const seq = r.items.map((i) => vnYmd(i.newDate ?? i.oldDate));
    expect([...seq].sort()).toEqual(seq);
  });

  it("nhiều buổi khoá liên tiếp vẫn giữ thứ tự", () => {
    const blocked = new Set(["2026-07-06", "2026-07-09"]);
    const r = assignPhasedDates({
      sessions: [
        S("x1", 2026, 7, 2),
        S("x2", 2026, 7, 6, "đã hoàn tất"),
        S("x3", 2026, 7, 9, "đã có nhận xét"),
        S("x4", 2026, 7, 13),
      ],
      from: d(2026, 7, 1),
      candidates: candidates(d(2026, 7, 1), 12, blocked),
    });
    expect(r.items.map((i) => vnYmd(i.newDate ?? i.oldDate))).toEqual([
      "2026-07-02", "2026-07-06", "2026-07-09", "2026-07-13",
    ]);
  });

  it("HỒI QUY: buổi trống đứng TRƯỚC buổi khoá không được đẩy ra SAU nó", () => {
    // Kế hoạch mới thưa hơn lịch cũ: ứng viên gần nhất (06/07) rơi SAU buổi khoá 03/07.
    const sparse: SchedulePhase[] = [
      {
        effectiveFrom: d(2026, 7, 1),
        effectiveTo: null,
        slots: [{ weekday: 1, startTime: "17:30", endTime: null }], // chỉ T2
      },
    ];
    const cands = computePhasedSessionDates({
      from: d(2026, 7, 1),
      count: 5,
      phases: sparse,
      holidays: NO_HOLIDAY,
      blockedDays: new Set(["2026-07-03"]),
    }).dates;
    const r = assignPhasedDates({
      sessions: [
        S("s1", 2026, 7, 2), // trống
        S("s2", 2026, 7, 3, "đã điểm danh"), // khoá, đứng ngay sau
        S("s3", 2026, 7, 9), // trống
      ],
      from: d(2026, 7, 1),
      candidates: cands,
    });
    // s1 KHÔNG được nhảy tới 06/07 (sau s2) — giữ nguyên 02/07 kèm lý do.
    expect(r.items[0]).toMatchObject({ id: "s1", newDate: null });
    expect(r.items[0].keepReason).toContain("2026-07-03");
    expect(r.items[1]).toMatchObject({ id: "s2", newDate: null, keepReason: "đã điểm danh" });
    expect(vnYmd(r.items[2].newDate as Date)).toBe("2026-07-06"); // ứng viên không bị tiêu phí
    const seq = r.items.map((i) => vnYmd(i.newDate ?? i.oldDate));
    expect([...seq].sort()).toEqual(seq);
  });

  it("hết ứng viên giữa chừng → ranOut, KHÔNG trả ngày sai", () => {
    const r = assignPhasedDates({
      sessions: [S("a", 2026, 7, 2), S("b", 2026, 7, 6), S("c", 2026, 7, 9)],
      from: d(2026, 7, 1),
      candidates: candidates(d(2026, 7, 1), 2),
    });
    expect(r.ranOut).toBe(true);
    expect(r.items).toHaveLength(2);
  });

  it("buổi khoá nằm SAU hết ứng viên → vẫn giữ nguyên, không bị bỏ sót", () => {
    const r = assignPhasedDates({
      sessions: [S("a", 2026, 7, 2), S("z", 2026, 12, 25, "đã huỷ")],
      from: d(2026, 7, 1),
      candidates: candidates(d(2026, 7, 1), 4),
    });
    expect(r.ranOut).toBe(false);
    expect(r.items[1]).toMatchObject({ id: "z", newDate: null, keepReason: "đã huỷ" });
  });
});

describe("phaseForDate / slotForDate", () => {
  it("ĐÚNG ngày kết thúc vẫn thuộc giai đoạn đó (biên inclusive)", () => {
    // 31/07 là T6 — không học, nhưng vẫn phải nằm trong giai đoạn 1.
    expect(phaseForDate(TWO_PHASES, d(2026, 7, 31))?.effectiveFrom).toEqual(d(2026, 7, 1));
    // Buổi 19:00 ngày cuối: so theo khoá ngày nên không bị effectiveTo=00:00 cắt mất.
    expect(phaseForDate(TWO_PHASES, vnDateAt(2026, 6, 31, 19, 0))?.effectiveTo).toEqual(
      d(2026, 7, 31),
    );
    expect(phaseForDate(TWO_PHASES, d(2026, 8, 1))?.effectiveTo).toBeNull();
  });

  it("slotForDate trả đúng ca của thứ đó; ngày không học → null", () => {
    expect(slotForDate(TWO_PHASES, d(2026, 7, 6))?.startTime).toBe("17:30"); // T2
    expect(slotForDate(TWO_PHASES, d(2026, 7, 7))).toBeNull(); // T3 không học
    expect(slotForDate(TWO_PHASES, d(2026, 8, 5))?.startTime).toBe("08:00"); // T4 giai đoạn 2
  });

  it("classSlotsAt trả lịch của giai đoạn, thứ tự tuần học; ngoài kế hoạch → null", () => {
    expect(classSlotsAt(TWO_PHASES, d(2026, 7, 6))).toEqual([
      { weekday: 1, startTime: "17:30", endTime: "19:00" },
      { weekday: 4, startTime: "17:30", endTime: "19:00" },
    ]);
    expect(classSlotsAt(TWO_PHASES, d(2026, 6, 1))).toBeNull();
  });
});

describe("validatePhases", () => {
  const ok: SchedulePhase = {
    effectiveFrom: d(2026, 7, 1),
    effectiveTo: null,
    slots: [{ weekday: 1, startTime: "17:30", endTime: "19:00" }],
  };

  it("kế hoạch hợp lệ → không lỗi", () => {
    expect(validatePhases([ok])).toEqual([]);
    expect(validatePhases(TWO_PHASES)).toEqual([]);
  });

  it("rỗng → báo cần ít nhất 1 giai đoạn", () => {
    expect(validatePhases([])).toHaveLength(1);
  });

  it("bắt chồng lấn ngày giữa 2 giai đoạn", () => {
    const errs = validatePhases([
      { ...ok, effectiveTo: d(2026, 7, 31) },
      { ...ok, effectiveFrom: d(2026, 7, 15), effectiveTo: null },
    ]);
    expect(errs.some((e) => e.includes("chồng lấn"))).toBe(true);
  });

  it("chỉ giai đoạn CUỐI được bỏ trống ngày kết thúc", () => {
    const errs = validatePhases([
      { ...ok, effectiveFrom: d(2026, 7, 1), effectiveTo: null },
      { ...ok, effectiveFrom: d(2026, 9, 1), effectiveTo: null },
    ]);
    expect(errs.some((e) => e.includes("phải có ngày kết thúc"))).toBe(true);
  });

  it("bắt giai đoạn không chọn thứ, giờ sai định dạng, giờ kết thúc trước giờ bắt đầu", () => {
    expect(validatePhases([{ ...ok, slots: [] }]).some((e) => e.includes("chưa chọn thứ"))).toBe(true);
    expect(
      validatePhases([{ ...ok, slots: [{ weekday: 1, startTime: "7:5", endTime: null }] }]).some((e) =>
        e.includes("HH:mm"),
      ),
    ).toBe(true);
    expect(
      validatePhases([
        { ...ok, slots: [{ weekday: 1, startTime: "17:30", endTime: "16:00" }] },
      ]).some((e) => e.includes("sau giờ bắt đầu")),
    ).toBe(true);
  });

  it("bắt ngày kết thúc trước ngày bắt đầu", () => {
    const errs = validatePhases([{ ...ok, effectiveFrom: d(2026, 7, 10), effectiveTo: d(2026, 7, 1) }]);
    expect(errs.some((e) => e.includes("trước ngày bắt đầu"))).toBe(true);
  });
});

describe("findScheduleGaps", () => {
  it("chỉ ra khoảng lớp nghỉ giữa 2 giai đoạn", () => {
    expect(
      findScheduleGaps([
        { effectiveFrom: d(2026, 7, 1), effectiveTo: d(2026, 7, 10), slots: [] },
        { effectiveFrom: d(2026, 8, 1), effectiveTo: null, slots: [] },
      ]),
    ).toEqual([{ fromKey: "2026-07-11", toKey: "2026-07-31" }]);
  });

  it("hai giai đoạn liền kề → không có khoảng trống", () => {
    expect(findScheduleGaps(TWO_PHASES)).toEqual([]);
  });
});

describe("tương thích lớp cũ (2-phase)", () => {
  it("legacyPhaseFromClass: lịch cũ → 1 giai đoạn mở, giữ giờ riêng theo thứ", () => {
    const p = legacyPhaseFromClass({
      scheduleDays: [1, 5],
      startTime: "17:30",
      endTime: "19:00",
      slots: [{ weekday: 5, startTime: "08:00", endTime: "09:30" }],
      startDate: d(2026, 7, 1),
    });
    expect(p).not.toBeNull();
    expect(p!.effectiveTo).toBeNull();
    expect(p!.slots).toEqual([
      { weekday: 1, startTime: "17:30", endTime: "19:00" }, // lùi về giờ chung
      { weekday: 5, startTime: "08:00", endTime: "09:30" }, // slot riêng thắng
    ]);
  });

  it("legacyPhaseFromClass: lớp chưa khai lịch → null", () => {
    expect(
      legacyPhaseFromClass({ scheduleDays: [], startTime: null, endTime: null, slots: [], startDate: null }),
    ).toBeNull();
  });

  it("legacyScheduleFromPhases: lấy giai đoạn ĐANG hiệu lực", () => {
    const s = legacyScheduleFromPhases(TWO_PHASES, d(2026, 8, 10));
    expect(s).toEqual({
      scheduleDays: [3],
      startTime: "08:00",
      endTime: "09:30",
      slots: [{ weekday: 3, startTime: "08:00", endTime: "09:30" }],
    });
  });

  it("legacyScheduleFromPhases: đang trong khoảng nghỉ → null (GIỮ bản sao cũ)", () => {
    const phases: SchedulePhase[] = [
      { effectiveFrom: d(2026, 7, 1), effectiveTo: d(2026, 7, 10), slots: [{ weekday: 1, startTime: "17:30", endTime: null }] },
      { effectiveFrom: d(2026, 9, 1), effectiveTo: null, slots: [{ weekday: 3, startTime: "08:00", endTime: null }] },
    ];
    expect(legacyScheduleFromPhases(phases, d(2026, 8, 5))).toBeNull();
  });

  it("legacyScheduleFromPhases: kế hoạch còn ở TƯƠNG LAI → null, không đổi lịch hôm nay", () => {
    // Ca thật: hôm nay 07/08 lập kế hoạch đổi ca từ 01/09. Bản sao KHÔNG được đổi ngay,
    // nếu không site GV + portal hiện lịch tháng 9 cho tuần này.
    const phases: SchedulePhase[] = [
      { effectiveFrom: d(2026, 9, 1), effectiveTo: null, slots: [{ weekday: 3, startTime: "08:00", endTime: null }] },
    ];
    expect(legacyScheduleFromPhases(phases, d(2026, 8, 7))).toBeNull();
    expect(legacyScheduleFromPhases(phases, d(2026, 9, 2))?.scheduleDays).toEqual([3]);
  });

  it("legacyScheduleFromPhases: kế hoạch đã kết thúc → null (giữ bản sao cuối cùng)", () => {
    const phases: SchedulePhase[] = [
      { effectiveFrom: d(2026, 7, 1), effectiveTo: d(2026, 7, 10), slots: [{ weekday: 1, startTime: "17:30", endTime: null }] },
    ];
    expect(legacyScheduleFromPhases(phases, d(2026, 12, 1))).toBeNull();
  });
});
