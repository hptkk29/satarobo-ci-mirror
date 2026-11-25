import { describe, it, expect } from "vitest";
import { sessionWindow, rowsToSlots } from "@/lib/lms/schedule-conflict";
import { detectScheduleConflict } from "@/lib/lms/scheduling";
import { vnDateAt } from "@/lib/time/vn";

// TZ: fixture dựng bằng `vnDateAt`, KHÔNG `new Date(y,m,d,h,m)`. CI chạy UTC còn máy
// dev +07 — constructor local cho ra thời điểm lệch 7 tiếng, đủ để rơi sang ngày VN
// khác và làm phép so trùng "không thấy" nhau. Bắt được nhờ CI đỏ 06/08.

describe("sessionWindow", () => {
  it("tính cuối buổi từ startTime/endTime của lớp", () => {
    // 06/08 — mốc ĐẦU nay neo theo giờ lớp (17:30 VN), không còn lấy nguyên phần
    // giờ của `date`; xem schedule-conflict-window.test.ts cho lý do.
    const start = vnDateAt(2026, 5, 1, 17, 30);
    const w = sessionWindow(start, "17:30", "19:00");
    expect(w.startAt).toEqual(start);
    expect((w.endAt.getTime() - w.startAt.getTime()) / 60000).toBe(90);
  });

  it("fallback 90' khi thiếu/đảo giờ", () => {
    // Đo ĐỘ DÀI = endAt − startAt. Bản cũ đo endAt − start (mốc truyền vào) — chỉ
    // đúng khi startAt === start, tức khi khung chưa neo theo giờ lớp.
    const start = vnDateAt(2026, 5, 1, 17, 30);
    const dai = (w: { startAt: Date; endAt: Date }) => (w.endAt.getTime() - w.startAt.getTime()) / 60000;
    expect(dai(sessionWindow(start, null, null))).toBe(90);
    expect(dai(sessionWindow(start, "19:00", "17:30"))).toBe(90);
  });
});

describe("rowsToSlots", () => {
  it("phòng/GV hiệu lực = actual ?? class", () => {
    const date = vnDateAt(2026, 5, 1, 17, 30);
    const slots = rowsToSlots([
      {
        id: "s1",
        date,
        actualRoomId: "R9",
        actualTeacherId: null,
        class: { roomId: "R1", teacherId: "T1", startTime: "17:30", endTime: "19:00" },
      },
    ]);
    expect(slots[0]).toMatchObject({ id: "s1", roomId: "R9", teacherId: "T1" });
  });
});

describe("rowsToSlots + detectScheduleConflict", () => {
  const date = vnDateAt(2026, 5, 1, 17, 30);
  const existing = rowsToSlots([
    {
      id: "s1",
      date,
      actualRoomId: null,
      actualTeacherId: null,
      class: { roomId: "R1", teacherId: "T1", startTime: "17:30", endTime: "19:00" },
    },
  ]);

  it("bắt trùng phòng cùng giờ", () => {
    const r = detectScheduleConflict(existing, {
      roomId: "R1",
      teacherId: "T2",
      startAt: vnDateAt(2026, 5, 1, 18, 0),
      endAt: vnDateAt(2026, 5, 1, 19, 30),
    });
    expect(r.roomConflict).toBe(true);
    expect(r.teacherConflict).toBe(false);
    expect(r.conflictIds).toContain("s1");
  });

  it("bắt trùng GV cùng giờ", () => {
    const r = detectScheduleConflict(existing, {
      roomId: "R2",
      teacherId: "T1",
      startAt: vnDateAt(2026, 5, 1, 18, 0),
      endAt: vnDateAt(2026, 5, 1, 19, 30),
    });
    expect(r.teacherConflict).toBe(true);
    expect(r.roomConflict).toBe(false);
  });

  it("không trùng khi lệch giờ", () => {
    const r = detectScheduleConflict(existing, {
      roomId: "R1",
      teacherId: "T1",
      startAt: vnDateAt(2026, 5, 1, 19, 30),
      endAt: vnDateAt(2026, 5, 1, 21, 0),
    });
    expect(r.roomConflict).toBe(false);
    expect(r.teacherConflict).toBe(false);
  });
});
