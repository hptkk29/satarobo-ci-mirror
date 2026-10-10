import { describe, it, expect } from "vitest";
import { auditSessionSeries } from "./session-audit";
import {
  assignPhasedDates,
  computePhasedSessionDates,
  legacyPhaseFromClass,
  type SchedulePhase,
} from "./phases";
import { vnDateAt, vnStartOfDay, vnYmd } from "@/lib/time/vn";

// ⚠️ Mọi assert đi qua `vnDateAt`/`vnStartOfDay`, KHÔNG dựng ngày bằng `new Date(y,m,d)`:
// test kiểu cũ xanh ở máy dev (+07) mà lọt lỗi trên Vercel (UTC).

const NO_HOLIDAY = new Set<string>();

/** Lịch phẳng T7 15:45–17:15 (đúng lớp đã lỗi trên prod). */
function t7Phase(startDate: Date): SchedulePhase {
  const p = legacyPhaseFromClass({
    scheduleDays: [6],
    startTime: "15:45",
    endTime: "17:15",
    slots: [],
    startDate,
  });
  if (!p) throw new Error("fixture sai");
  return p;
}

const sess = (d: Date, i: number, status = "SCHEDULED") => ({
  id: `s${i}`,
  date: d,
  status,
});

/** N buổi T7 15:45 liên tiếp kể từ `first`. */
function weeklyT7(first: Date, n: number): Date[] {
  return Array.from({ length: n }, (_, i) => new Date(first.getTime() + i * 7 * 86400000));
}

describe("auditSessionSeries", () => {
  it("khớp lịch → OK, không cảnh báo", () => {
    // 27/06/2026 là Thứ 7.
    const start = vnStartOfDay(vnDateAt(2026, 5, 27));
    const dates = weeklyT7(vnDateAt(2026, 5, 27, 15, 45), 8);
    const res = auditSessionSeries({
      from: start,
      phases: [t7Phase(start)],
      holidays: NO_HOLIDAY,
      sessions: dates.map((d, i) => sess(d, i)),
      classStatus: "ACTIVE",
    });
    expect(res.severity).toBe("OK");
    expect(res.message).toBeNull();
    expect(res.wrongDateCount).toBe(0);
  });

  it("ca prod: dãy neo ở 01/08 trong khi khai giảng 27/06 → ANCHOR_WRONG, lệch hết", () => {
    const start = vnStartOfDay(vnDateAt(2026, 5, 27)); // T7 27/06/2026
    const dates = weeklyT7(vnDateAt(2026, 7, 1, 15, 45), 48); // T7 01/08/2026
    const res = auditSessionSeries({
      from: start,
      phases: [t7Phase(start)],
      holidays: NO_HOLIDAY,
      sessions: dates.map((d, i) => sess(d, i)),
      classStatus: "ACTIVE",
    });
    expect(res.severity).toBe("ANCHOR_WRONG");
    expect(res.wrongDateCount).toBe(48);
    expect(res.firstOffSeq).toBe(1);
    // Buổi 1 đúng phải là 27/06/2026 15:45 giờ VN.
    expect(res.expectedFirst?.toISOString()).toBe(vnDateAt(2026, 5, 27, 15, 45).toISOString());
    expect(res.message).toContain("2026-06-27");
  });

  it("neo đúng nhưng đuôi lệch (đổi lịch giữa khoá) → DRIFT, không phải ANCHOR_WRONG", () => {
    const start = vnStartOfDay(vnDateAt(2026, 5, 27));
    const dates = weeklyT7(vnDateAt(2026, 5, 27, 15, 45), 5);
    // Buổi cuối bị đẩy thêm 1 tuần so với dãy chuẩn (month index 7 = tháng 8).
    dates[4] = vnDateAt(2026, 7, 1, 15, 45); // 01/08 thay vì 25/07
    const res = auditSessionSeries({
      from: start,
      phases: [t7Phase(start)],
      holidays: NO_HOLIDAY,
      sessions: dates.map((d, i) => sess(d, i)),
      classStatus: "ACTIVE",
    });
    expect(res.severity).toBe("DRIFT");
    expect(res.firstOffSeq).toBe(5);
  });

  it("đúng ngày nhưng sai giờ → đếm vào wrongTimeCount", () => {
    const start = vnStartOfDay(vnDateAt(2026, 5, 27));
    const dates = weeklyT7(vnDateAt(2026, 5, 27, 15, 45), 3);
    dates[1] = vnDateAt(2026, 6, 4, 22, 45); // đúng T7 04/07 nhưng 22:45 (dấu vết bug TZ cũ)
    const res = auditSessionSeries({
      from: start,
      phases: [t7Phase(start)],
      holidays: NO_HOLIDAY,
      sessions: dates.map((d, i) => sess(d, i)),
      classStatus: "ACTIVE",
    });
    expect(res.wrongDateCount).toBe(0);
    expect(res.wrongTimeCount).toBe(1);
    expect(res.severity).toBe("DRIFT");
  });

  it("[SA-HUY] ngày có buổi ĐÃ HUỶ là ngày lớp KHÔNG học — dãy sau lùi một nhịp vẫn OK", () => {
    // 27/09/2026 — "Nghỉ & lùi lịch" theo từng lớp để lại một buổi HUỶ ở ngày nghỉ và dời
    // các buổi sau lùi một nhịp. Nếu rà lịch chỉ BỎ QUA buổi huỷ mà không coi ngày của nó là
    // ngày không học, mọi lớp đã nghỉ một buổi đều bị báo "lệch lịch" oan — và ai bấm "Sửa"
    // ở màn Kiểm tra lịch là kéo buổi về đúng ngày lớp đã nghỉ.
    const start = vnStartOfDay(vnDateAt(2026, 5, 27));
    const t7 = weeklyT7(vnDateAt(2026, 5, 27, 15, 45), 4); // 27/06 · 04/07 · 11/07 · 18/07
    const sessions = [
      sess(t7[0], 0),
      sess(t7[1], 98, "CANCELLED"), // lớp nghỉ 04/07
      sess(t7[2], 1),
      sess(t7[3], 2),
    ];
    const res = auditSessionSeries({
      from: start,
      phases: [t7Phase(start)],
      holidays: NO_HOLIDAY,
      sessions,
      classStatus: "ACTIVE",
    });
    expect(res.severity).toBe("OK");
  });

  it("buổi HUỶ không tham gia phép so (không đẩy lệch phần đuôi)", () => {
    const start = vnStartOfDay(vnDateAt(2026, 5, 27));
    const live = weeklyT7(vnDateAt(2026, 5, 27, 15, 45), 3);
    const sessions = [
      sess(live[0], 0),
      sess(vnDateAt(2026, 6, 1, 15, 45), 99, "CANCELLED"), // buổi huỷ xen giữa
      sess(live[1], 1),
      sess(live[2], 2),
    ];
    const res = auditSessionSeries({
      from: start,
      phases: [t7Phase(start)],
      holidays: NO_HOLIDAY,
      sessions,
      classStatus: "ACTIVE",
    });
    expect(res.severity).toBe("OK");
  });

  it("lớp ACTIVE mà chưa có buổi nào → NO_SESSIONS", () => {
    const start = vnStartOfDay(vnDateAt(2026, 6, 16));
    const res = auditSessionSeries({
      from: start,
      phases: [
        (() => {
          const p = legacyPhaseFromClass({
            scheduleDays: [0],
            startTime: "09:00",
            endTime: "10:30",
            slots: [],
            startDate: start,
          });
          if (!p) throw new Error("fixture sai");
          return p;
        })(),
      ],
      holidays: NO_HOLIDAY,
      sessions: [],
      classStatus: "ACTIVE",
    });
    expect(res.severity).toBe("NO_SESSIONS");
  });

  it("lớp mới lên kế hoạch (PLANNED) chưa có buổi → KHÔNG báo lỗi", () => {
    const start = vnStartOfDay(vnDateAt(2026, 6, 16));
    const res = auditSessionSeries({
      from: start,
      phases: [t7Phase(start)],
      holidays: NO_HOLIDAY,
      sessions: [],
      classStatus: "PLANNED",
    });
    expect(res.severity).toBe("OK");
  });

  it("ngày nghỉ đẩy buổi sang tuần kế — dãy chuẩn phải tính cả nghỉ", () => {
    const start = vnStartOfDay(vnDateAt(2026, 5, 27));
    // Nghỉ đúng T7 04/07 → buổi 2 phải là 11/07.
    const holidays = new Set(["2026-07-04"]);
    const sessions = [
      sess(vnDateAt(2026, 5, 27, 15, 45), 0),
      sess(vnDateAt(2026, 6, 11, 15, 45), 1),
    ];
    const res = auditSessionSeries({
      from: start,
      phases: [t7Phase(start)],
      holidays,
      sessions,
      classStatus: "ACTIVE",
    });
    expect(res.severity).toBe("OK");
  });

  it("xếp lại cả dãy đưa buổi 1 về đúng ngày khai giảng (kịch bản prod sata3.15h45)", () => {
    // Ghép đúng thứ tự mà `planScheduleApply` dùng: sinh ứng viên theo giai đoạn rồi rải
    // vào các buổi dời được. Không buổi nào có dữ liệu ⇒ dời hết.
    const start = vnStartOfDay(vnDateAt(2026, 5, 27)); // T7 27/06/2026
    const phases = [t7Phase(start)];
    const current = weeklyT7(vnDateAt(2026, 7, 1, 15, 45), 48); // đang neo ở 01/08

    const { dates: candidates } = computePhasedSessionDates({
      from: start,
      count: current.length + 8,
      phases,
      holidays: NO_HOLIDAY,
    });
    const assigned = assignPhasedDates({
      sessions: current.map((d, i) => ({ id: `s${i}`, date: d, lockReason: null })),
      from: start,
      candidates,
    });

    expect(assigned.ranOut).toBe(false);
    expect(assigned.items).toHaveLength(48);
    expect(vnYmd(assigned.items[0].newDate as Date)).toBe("2026-06-27");
    // 48 buổi T7 liên tiếp từ 27/06/2026 → buổi cuối 22/05/2027 (đúng endDate mà
    // `suggestClassEndDate` đã tính khi admin sửa ngày khai giảng trên prod).
    expect(vnYmd(assigned.items[47].newDate as Date)).toBe("2027-05-22");
    // Sau khi xếp lại thì phép soát phải trả OK.
    const after = auditSessionSeries({
      from: start,
      phases,
      holidays: NO_HOLIDAY,
      sessions: assigned.items.map((it, i) => sess(it.newDate as Date, i)),
      classStatus: "ACTIVE",
    });
    expect(after.severity).toBe("OK");
  });

  it("buổi đã điểm danh giữ nguyên ngày khi xếp lại, buổi trống mới dời", () => {
    const start = vnStartOfDay(vnDateAt(2026, 5, 27));
    const phases = [t7Phase(start)];
    const current = weeklyT7(vnDateAt(2026, 7, 1, 15, 45), 4); // 01/08, 08/08, 15/08, 22/08

    const { dates: candidates } = computePhasedSessionDates({
      from: start,
      count: 12,
      phases,
      holidays: NO_HOLIDAY,
      blockedDays: new Set(["2026-08-01"]),
      untilKey: "2026-08-01",
    });
    const assigned = assignPhasedDates({
      sessions: current.map((d, i) => ({
        id: `s${i}`,
        date: d,
        lockReason: i === 0 ? "đã điểm danh" : null,
      })),
      from: start,
      candidates,
    });

    expect(assigned.items[0].newDate).toBeNull();
    expect(assigned.items[0].keepReason).toBe("đã điểm danh");
    // Buổi khoá đứng ở 01/08 ⇒ các buổi sau chỉ được xếp TỪ 08/08 trở đi (không chạy ngược).
    expect(vnYmd(assigned.items[1].newDate as Date)).toBe("2026-08-08");
  });

  it("lớp chưa có ngày khai giảng nhưng đã có buổi → NO_SCHEDULE", () => {
    const start = vnStartOfDay(vnDateAt(2026, 5, 27));
    const res = auditSessionSeries({
      from: null,
      phases: [t7Phase(start)],
      holidays: NO_HOLIDAY,
      sessions: [sess(vnDateAt(2026, 5, 27, 15, 45), 0)],
      classStatus: "ACTIVE",
    });
    expect(res.severity).toBe("NO_SCHEDULE");
  });
});
