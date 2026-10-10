import { describe, it, expect } from "vitest";
import { attendanceLabel, ATTENDANCE_LABELS } from "./labels";

// R7-08 (XĐ-8 PA2) — 6 nhãn điểm danh + buổi hủy.
describe("attendanceLabel", () => {
  it("PRESENT → Có mặt", () => {
    expect(attendanceLabel("PRESENT").key).toBe("PRESENT");
    expect(attendanceLabel("PRESENT").label).toBe("Có mặt");
  });

  it("LATE → Đi muộn", () => {
    expect(attendanceLabel("LATE").label).toBe("Đi muộn");
  });

  it("EXCUSED / ABSENT_EXCUSED → Vắng có phép", () => {
    expect(attendanceLabel("EXCUSED").label).toBe("Vắng có phép");
    expect(attendanceLabel("ABSENT_EXCUSED").label).toBe("Vắng có phép");
  });

  it("ABSENT / ABSENT_UNEXCUSED → Vắng không phép", () => {
    expect(attendanceLabel("ABSENT").label).toBe("Vắng không phép");
    expect(attendanceLabel("ABSENT_UNEXCUSED").label).toBe("Vắng không phép");
  });

  it("makeupStatus NEEDS_MAKEUP → Chờ học bù (ưu tiên hơn status)", () => {
    expect(attendanceLabel("ABSENT", "NEEDS_MAKEUP").label).toBe("Chờ học bù");
  });

  it("makeupStatus MADE_UP → Đã học bù (tính như có mặt)", () => {
    const l = attendanceLabel("ABSENT", "MADE_UP");
    expect(l.label).toBe("Đã học bù");
    expect(l.countsAttended).toBe(true);
    expect(l.countsAbsent).toBe(false);
  });

  it("buổi CANCELLED → Buổi học bị hủy, KHÔNG tính vắng (C7)", () => {
    const l = attendanceLabel("ABSENT", "NEEDS_MAKEUP", "CANCELLED");
    expect(l.label).toBe("Buổi học bị hủy");
    expect(l.countsAbsent).toBe(false);
    expect(l.countsAttended).toBe(false);
  });

  it("đúng 7 nhãn trong registry (6 SRS + buổi hủy)", () => {
    expect(Object.keys(ATTENDANCE_LABELS)).toHaveLength(7);
  });
});
