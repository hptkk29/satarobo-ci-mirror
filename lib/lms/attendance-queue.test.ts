import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_QUEUE_ORDER,
  compareAttendanceQueueOrder,
  photoCoveredCount,
  resolveAttendanceQueuePhase,
  sessionWorkState,
  sortAttendanceQueue,
  type AttendanceQueuePhase,
  type SessionWorkInput,
} from "./attendance-queue";

// Yêu cầu 21/08: /attendance xếp chưa hoàn tất → sắp tới → chưa tới giờ → đã xong.
// "Đã xong" = đủ CẢ BA việc, và cả ba đều xét THEO TỪNG HỌC VIÊN:
//   điểm danh đủ lớp · mọi em đi học có nhận xét · mọi em đi học có ảnh.
// Em vắng thì miễn nhận xét lẫn ảnh.

// 10:00 sáng 21/08/2026 giờ VN = 03:00Z.
const NOW = new Date("2026-08-21T03:00:00.000Z");

const ROSTER = ["s1", "s2", "s3", "s4", "s5"];
/** Cả lớp có mặt trừ s5 (vắng). */
const ALL_MARKED = [
  { studentId: "s1", status: "PRESENT" },
  { studentId: "s2", status: "PRESENT" },
  { studentId: "s3", status: "LATE" },
  { studentId: "s4", status: "PRESENT" },
  { studentId: "s5", status: "ABSENT" },
];
const ATTENDED_IDS = ["s1", "s2", "s3", "s4"];

function input(over: Partial<SessionWorkInput> = {}): SessionWorkInput {
  return {
    rosterStudentIds: ROSTER,
    attendanceRows: ALL_MARKED,
    feedbackStudentIds: ATTENDED_IDS,
    media: { taggedStudentIds: ATTENDED_IDS, hasClassWide: false },
    ...over,
  };
}

function work(over: Partial<SessionWorkInput> = {}) {
  return sessionWorkState(input(over));
}

describe("sessionWorkState — điểm danh", () => {
  it("chấm đủ mọi học viên của lớp mới là xong", () => {
    expect(work().attendanceDone).toBe(true);
  });

  it("bỏ sót 1 em thì chưa xong", () => {
    expect(work({ attendanceRows: ALL_MARKED.slice(0, 4) }).attendanceDone).toBe(false);
  });

  it("HỌC BÙ không được che chỗ trống: 4 em của lớp + 1 khách vẫn là THIẾU", () => {
    // Bẫy của phép so số lượng: 5 bản ghi / sĩ số 5 ⇒ "đủ", trong khi s5 chưa ai chấm.
    const rows = [
      ...ALL_MARKED.slice(0, 4),
      { studentId: "khach-lop-khac", status: "PRESENT" },
    ];
    expect(rows).toHaveLength(ROSTER.length);
    expect(work({ attendanceRows: rows }).attendanceDone).toBe(false);
  });

  it("lớp không còn học viên nào thì không tự nhận là đã điểm danh", () => {
    expect(work({ rosterStudentIds: [] }).attendanceDone).toBe(false);
  });
});

describe("sessionWorkState — nhận xét", () => {
  it("đủ phiếu cho mọi em đi học", () => {
    expect(work().feedbackDone).toBe(true);
  });

  it("thiếu 1 phiếu thì chưa xong", () => {
    expect(work({ feedbackStudentIds: ATTENDED_IDS.slice(0, 3) }).feedbackDone).toBe(false);
  });

  it("ĐỦ SỐ nhưng viết cho NHẦM em (kể cả em vắng) vẫn là thiếu", () => {
    expect(work({ feedbackStudentIds: ["s1", "s2", "s3", "s5"] }).feedbackDone).toBe(false);
  });

  it("chưa điểm danh ai thì không bao giờ xong nhận xét", () => {
    expect(work({ attendanceRows: [], feedbackStudentIds: [] }).feedbackDone).toBe(false);
  });
});

describe("sessionWorkState — ảnh/video phủ từng học viên", () => {
  it("mỗi em đi học đều có ảnh riêng → xong", () => {
    expect(work().photoDone).toBe(true);
  });

  it("MỘT ảnh của MỘT em KHÔNG làm cả buổi thành xong", () => {
    // Đây là điều luật cũ ("buổi có ≥1 tệp") nói sai — chốt 21/08 đã đổi.
    expect(work({ media: { taggedStudentIds: ["s1"], hasClassWide: false } }).photoDone).toBe(
      false,
    );
  });

  it("thiếu ảnh đúng 1 em đi học → chưa xong", () => {
    expect(
      work({ media: { taggedStudentIds: ["s1", "s2", "s3"], hasClassWide: false } }).photoDone,
    ).toBe(false);
  });

  it("một ảnh CHUNG CẢ LỚP phủ hết mọi em, không cần gắn thẻ", () => {
    expect(work({ media: { taggedStudentIds: [], hasClassWide: true } }).photoDone).toBe(true);
  });

  it("em VẮNG không cần ảnh — thẻ chỉ có 4 em đi học vẫn là đủ", () => {
    expect([...ATTENDED_IDS]).not.toContain("s5");
    expect(work().photoDone).toBe(true);
  });

  it("buổi không có ảnh nào → chưa xong", () => {
    expect(work({ media: { taggedStudentIds: [], hasClassWide: false } }).photoDone).toBe(
      false,
    );
  });

  it("chưa điểm danh ai thì không có em nào để phủ → chưa xong", () => {
    expect(
      work({
        attendanceRows: [],
        media: { taggedStudentIds: ["s1"], hasClassWide: false },
      }).photoDone,
    ).toBe(false);
  });
});

describe("photoCoveredCount — chỉ để hiển thị", () => {
  it("đếm số em đi học đã có ảnh", () => {
    expect(
      photoCoveredCount(input({ media: { taggedStudentIds: ["s1", "s2"], hasClassWide: false } })),
    ).toBe(2);
  });

  it("thẻ gắn nhầm em VẮNG không được cộng vào", () => {
    expect(
      photoCoveredCount(input({ media: { taggedStudentIds: ["s5"], hasClassWide: false } })),
    ).toBe(0);
  });

  it("ảnh chung cả lớp ⇒ phủ hết số em đi học", () => {
    expect(
      photoCoveredCount(input({ media: { taggedStudentIds: [], hasClassWide: true } })),
    ).toBe(4);
  });
});

describe("resolveAttendanceQueuePhase", () => {
  const at = (iso: string) => new Date(iso);
  const PAST = at("2026-08-20T01:00:00.000Z");
  const NOTHING_DONE: Partial<SessionWorkInput> = {
    attendanceRows: [],
    feedbackStudentIds: [],
    media: { taggedStudentIds: [], hasClassWide: false },
  };

  it("buổi đã qua giờ, đủ 3 việc → DONE", () => {
    expect(resolveAttendanceQueuePhase({ date: PAST, work: work(), now: NOW })).toBe("DONE");
  });

  it("buổi đã qua giờ nhưng THIẾU ảnh một em → vẫn nằm nhóm chưa hoàn tất", () => {
    expect(
      resolveAttendanceQueuePhase({
        date: PAST,
        work: work({ media: { taggedStudentIds: ["s1", "s2", "s3"], hasClassWide: false } }),
        now: NOW,
      }),
    ).toBe("PENDING");
  });

  it("buổi cùng NGÀY VN nhưng chưa tới giờ → TODAY", () => {
    // 18:00 VN 21/08 = 11:00Z cùng ngày.
    expect(
      resolveAttendanceQueuePhase({
        date: at("2026-08-21T11:00:00.000Z"),
        work: work(NOTHING_DONE),
        now: NOW,
      }),
    ).toBe("TODAY");
  });

  it("buổi 07:00 VN hôm nay đã trôi qua lúc 10:00 → PENDING, không phải TODAY", () => {
    expect(
      resolveAttendanceQueuePhase({
        date: at("2026-08-21T00:00:00.000Z"),
        work: work(NOTHING_DONE),
        now: NOW,
      }),
    ).toBe("PENDING");
  });

  it("buổi 23:30Z hôm nay là 06:30 VN NGÀY MAI → UPCOMING (đừng dùng giờ UTC)", () => {
    expect(
      resolveAttendanceQueuePhase({
        date: at("2026-08-21T23:30:00.000Z"),
        work: work(NOTHING_DONE),
        now: NOW,
      }),
    ).toBe("UPCOMING");
  });

  it("buổi tương lai KHÔNG bao giờ mang nhãn đã hoàn tất, kể cả khi lỡ có sẵn dữ liệu", () => {
    expect(
      resolveAttendanceQueuePhase({
        date: at("2026-08-25T01:00:00.000Z"),
        work: work(),
        now: NOW,
      }),
    ).toBe("UPCOMING");
  });

  it("lớp đã hết học viên: buổi cũ xuống bậc NO_ROSTER, không ghim ở đầu bảng", () => {
    expect(
      resolveAttendanceQueuePhase({
        date: PAST,
        rosterEmpty: true,
        work: work({ rosterStudentIds: [] }),
        now: NOW,
      }),
    ).toBe("NO_ROSTER");
  });

  it("lớp mới chưa xếp học viên: buổi SẮP TỚI vẫn là sắp tới, không phải NO_ROSTER", () => {
    expect(
      resolveAttendanceQueuePhase({
        date: at("2026-08-25T01:00:00.000Z"),
        rosterEmpty: true,
        work: work({ rosterStudentIds: [] }),
        now: NOW,
      }),
    ).toBe("UPCOMING");
  });

  it("buổi huỷ luôn ở bậc CANCELLED dù ngày nào", () => {
    expect(
      resolveAttendanceQueuePhase({ date: PAST, cancelled: true, work: work(), now: NOW }),
    ).toBe("CANCELLED");
  });
});

describe("compareAttendanceQueueOrder", () => {
  const r = (phase: AttendanceQueuePhase, number: number | null, time = 0) => ({
    phase,
    number,
    time,
  });

  it("đúng thứ tự chủ dự án chốt, hai bậc 'hết việc' nằm cuối", () => {
    const shuffled = [
      r("DONE", 1),
      r("CANCELLED", 1),
      r("NO_ROSTER", 1),
      r("UPCOMING", 1),
      r("PENDING", 1),
      r("TODAY", 1),
    ];
    expect(sortAttendanceQueue(shuffled, (x) => x).map((x) => x.phase)).toEqual([
      "PENDING",
      "TODAY",
      "UPCOMING",
      "DONE",
      "NO_ROSTER",
      "CANCELLED",
    ]);
  });

  it("cùng bậc thì số buổi tăng dần", () => {
    const rows = [r("PENDING", 7), r("PENDING", 2), r("PENDING", 11)];
    expect(sortAttendanceQueue(rows, (x) => x).map((x) => x.number)).toEqual([2, 7, 11]);
  });

  it("buổi không tra được số buổi xếp CUỐI nhóm, không lẫn lên đầu", () => {
    const rows = [r("PENDING", null), r("PENDING", 3)];
    expect(sortAttendanceQueue(rows, (x) => x).map((x) => x.number)).toEqual([3, null]);
  });

  it("cùng số buổi (nhiều lớp) thì ngày tăng dần", () => {
    const rows = [r("PENDING", 1, 200), r("PENDING", 1, 100)];
    expect(sortAttendanceQueue(rows, (x) => x).map((x) => x.time)).toEqual([100, 200]);
  });

  it("không sửa mảng gốc", () => {
    const rows = [r("DONE", 1), r("PENDING", 2)];
    const copy = [...rows];
    sortAttendanceQueue(rows, (x) => x);
    expect(rows).toEqual(copy);
  });

  it("bảng thứ tự phủ đủ 6 bậc", () => {
    expect(Object.keys(ATTENDANCE_QUEUE_ORDER)).toHaveLength(6);
  });

  it("comparator đối xứng", () => {
    const a = r("PENDING", 2);
    const b = r("DONE", 1);
    expect(compareAttendanceQueueOrder(a, b)).toBeLessThan(0);
    expect(compareAttendanceQueueOrder(b, a)).toBeGreaterThan(0);
  });
});
