import { describe, it, expect } from "vitest";
import {
  computeShiftAttendance,
  mergeShiftIntervals,
  formatVNTime,
  vnMinutesOfDay,
  teachingUncovered,
} from "./work-schedule";

describe("teachingUncovered — phủ giờ dạy", () => {
  it("không có tiết dạy → không cảnh báo", () => {
    expect(teachingUncovered([], [])).toBe(false);
    expect(teachingUncovered(["CA_SANG"], [])).toBe(false);
  });
  it("ca chiều phủ tiết 14:00–15:30 → ok", () => {
    expect(teachingUncovered(["CA_CHIEU"], [{ start: "14:00", end: "15:30" }])).toBe(false);
  });
  it("không đăng ký ca mà có tiết dạy → cảnh báo", () => {
    expect(teachingUncovered([], [{ start: "14:00", end: "15:30" }])).toBe(true);
  });
  it("đăng ký ca sáng nhưng dạy chiều → cảnh báo (chưa phủ)", () => {
    expect(teachingUncovered(["CA_SANG"], [{ start: "14:00", end: "15:30" }])).toBe(true);
  });
  it("một trong nhiều tiết không phủ → cảnh báo", () => {
    expect(
      teachingUncovered(["CA_CHIEU"], [
        { start: "14:00", end: "15:00" },
        { start: "18:00", end: "19:00" },
      ]),
    ).toBe(true);
  });
});

// Date từ giờ tường VN (UTC+7).
function vn(hm: string): Date {
  return new Date(`2026-05-29T${hm}:00+07:00`);
}
function labels(tags: { label: string }[]): string[] {
  return tags.map((t) => t.label);
}

describe("vnMinutesOfDay / formatVNTime — GMT+7", () => {
  it("07:38 VN → 458 phút", () => {
    expect(vnMinutesOfDay(vn("07:38"))).toBe(7 * 60 + 38);
  });
  it("instant 00:38Z → 07:38 VN", () => {
    expect(formatVNTime(new Date("2026-05-29T00:38:00Z"))).toBe("07:38");
  });
});

describe("mergeShiftIntervals — chồng giờ chiều/tối", () => {
  it("chiều + tối → 1 khoảng liên tục 13:30–21:00 (7.5h)", () => {
    const m = mergeShiftIntervals(["CA_CHIEU", "CA_TOI"]);
    expect(m).toHaveLength(1);
    expect(m[0].end - m[0].start).toBe(7 * 60 + 30); // 450'
  });
  it("sáng + chiều → 2 khoảng (giữ nghỉ trưa) tổng 8h", () => {
    const m = mergeShiftIntervals(["CA_SANG", "CA_CHIEU"]);
    expect(m).toHaveLength(2);
    const total = m.reduce((s, i) => s + (i.end - i.start), 0);
    expect(total).toBe(8 * 60);
  });
  it("cả 3 ca → 4h + 7.5h = 11.5h", () => {
    const m = mergeShiftIntervals(["CA_SANG", "CA_CHIEU", "CA_TOI"]);
    const total = m.reduce((s, i) => s + (i.end - i.start), 0);
    expect(total).toBe(11 * 60 + 30);
  });
});

describe("computeShiftAttendance", () => {
  it("1 ca sáng, có mặt trọn → Đủ công, ~4h", () => {
    const r = computeShiftAttendance({
      checkIn: vn("07:30"), checkOut: vn("11:30"), geofenceFlag: false,
      registeredShifts: ["CA_SANG"],
    });
    expect(r.expectedHours).toBe(4);
    expect(r.workedHours).toBe(4);
    expect(labels(r.tags)).toContain("Đủ công");
  });

  it("chiều + tối (13:30→21:00, ~7.5h) → Đủ công (không bắt 8h)", () => {
    const r = computeShiftAttendance({
      checkIn: vn("13:30"), checkOut: vn("21:00"), geofenceFlag: false,
      registeredShifts: ["CA_CHIEU", "CA_TOI"],
    });
    expect(r.expectedHours).toBe(7.5);
    expect(labels(r.tags)).toContain("Đủ công");
  });

  it("đi làm KHÔNG đăng ký ca → cảnh báo 'Chưa đăng ký ca'", () => {
    const r = computeShiftAttendance({
      checkIn: vn("07:30"), checkOut: vn("11:30"), geofenceFlag: false,
      registeredShifts: [],
    });
    expect(labels(r.tags)).toContain("Chưa đăng ký ca");
  });

  it("đăng ký mà không quét → 'Thiếu ca'", () => {
    const r = computeShiftAttendance({
      checkIn: null, checkOut: null, geofenceFlag: false,
      registeredShifts: ["CA_SANG"],
    });
    expect(labels(r.tags).some((l) => l.startsWith("Thiếu ca"))).toBe(true);
  });

  it("vào muộn ca sáng (07:50) → Đi muộn + thiếu giờ", () => {
    const r = computeShiftAttendance({
      checkIn: vn("07:50"), checkOut: vn("11:30"), geofenceFlag: false,
      registeredShifts: ["CA_SANG"],
    });
    expect(labels(r.tags)).toContain("Đi muộn");
    expect(labels(r.tags)).not.toContain("Đủ công");
  });

  it("geofenceFlag → Ngoài vùng", () => {
    const r = computeShiftAttendance({
      checkIn: vn("07:30"), checkOut: vn("11:30"), geofenceFlag: true,
      registeredShifts: ["CA_SANG"],
    });
    expect(labels(r.tags)).toContain("Ngoài vùng");
  });
});
