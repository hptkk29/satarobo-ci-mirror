import { describe, it, expect } from "vitest";
import { attendanceRatePercent, courseProgressPercent } from "@/lib/lms/report-card-core";
import {
  computeAttendanceSummary,
  type AttendanceSummaryItem,
} from "./summary";

// R7-08 — bảng biên 5 chỉ số (US-MKP-2 / test case C5: 48/22/3/1/2).
describe("computeAttendanceSummary", () => {
  it("[C5] bảng biên kỳ vọng total=48, attended=22, absent=3, needMakeup=1, madeUp=2", () => {
    const items: AttendanceSummaryItem[] = [
      // 20 buổi có mặt (PRESENT/LATE).
      ...Array.from({ length: 18 }, () => ({ status: "PRESENT" as const })),
      { status: "LATE" },
      { status: "LATE" },
      // 2 buổi vắng đã học bù xong → tính attended + madeUp.
      { status: "ABSENT", makeupStatus: "MADE_UP" },
      { status: "EXCUSED", makeupStatus: "MADE_UP" },
      // 1 buổi đang chờ bù.
      { status: "ABSENT", makeupStatus: "NEEDS_MAKEUP" },
      // 3 buổi vắng không bù.
      { status: "ABSENT", makeupStatus: "NONE" },
      { status: "EXCUSED", makeupStatus: "NONE" },
      { status: "ABSENT_UNEXCUSED", makeupStatus: "NONE" },
      // 1 buổi bị hủy → KHÔNG tính vắng/học.
      { status: "ABSENT", makeupStatus: "NONE", sessionStatus: "CANCELLED" },
    ];
    const r = computeAttendanceSummary({ totalLessons: 48, attendances: items });
    // `daDienRa` không truyền ⇒ lui về số DÒNG điểm danh hợp lệ (bỏ dòng CANCELLED).
    expect(r).toEqual({
      total: 48,
      daDienRa: r.attended + r.absent + r.needMakeup,
      attended: 22,
      absent: 3,
      needMakeup: 1,
      madeUp: 2,
    });
  });

  it("madeUp là tập con của attended (không double-count)", () => {
    const r = computeAttendanceSummary({
      totalLessons: 10,
      attendances: [
        { status: "PRESENT" },
        { status: "ABSENT", makeupStatus: "MADE_UP" },
      ],
    });
    expect(r.attended).toBe(2);
    expect(r.madeUp).toBe(1);
  });

  it("buổi CANCELLED không tính vắng (C7)", () => {
    const r = computeAttendanceSummary({
      totalLessons: 5,
      attendances: [{ status: "ABSENT", sessionStatus: "CANCELLED" }],
    });
    expect(r.absent).toBe(0);
    expect(r.attended).toBe(0);
  });

  it("buổi bù KHÔNG tăng total (total = số buổi chuẩn của khoá)", () => {
    const r = computeAttendanceSummary({
      totalLessons: 8,
      attendances: [{ status: "ABSENT", makeupStatus: "MADE_UP" }],
    });
    expect(r.total).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [vé 04/09] HAI MẪU SỐ — chuyên cần vs tiến độ khoá
//
// Lỗi gốc: site phụ huynh chia cho TỔNG BUỔI KHOÁ, giáo viên/admin chia cho số buổi
// ĐÃ DIỄN RA ⇒ cùng một đứa trẻ, cùng một lúc, phụ huynh đọc 7/12 còn giáo viên đọc
// 7/11. Đo được trên dữ liệu thật (Đỗ Duy Khoa, lớp Sata 4 — CS1.01).
// ─────────────────────────────────────────────────────────────────────────────
describe("[04/09] daDienRa tách khỏi total", () => {
  const coMat = (n: number) =>
    Array.from({ length: n }, () => ({ status: "PRESENT" as const }));

  it("ca thật đã đo: 7 có mặt · 11 buổi đã dạy · khoá 12 buổi", () => {
    const r = computeAttendanceSummary({
      totalLessons: 12,
      sessionsHeld: 11,
      attendances: coMat(7),
    });
    expect(r.attended).toBe(7);
    expect(r.daDienRa).toBe(11); // mẫu số CHUYÊN CẦN
    expect(r.total).toBe(12); // mẫu số TIẾN ĐỘ KHOÁ
    expect(attendanceRatePercent(r)).toBe(64); // 7/11
    expect(courseProgressPercent(r)).toBe(92); // 11/12
  });

  it("đầu khoá: đi đủ buổi 1 là chuyên cần 100%, KHÔNG phải 8%", () => {
    // Đây là lý do không được lấy tổng buổi khoá làm mẫu số chuyên cần.
    const r = computeAttendanceSummary({
      totalLessons: 12,
      sessionsHeld: 1,
      attendances: coMat(1),
    });
    expect(attendanceRatePercent(r)).toBe(100);
    expect(courseProgressPercent(r)).toBe(8);
  });

  it("lớp chưa dạy buổi nào → 0%, không chia cho 0", () => {
    const r = computeAttendanceSummary({ totalLessons: 12, sessionsHeld: 0, attendances: [] });
    expect(attendanceRatePercent(r)).toBe(0);
    expect(courseProgressPercent(r)).toBe(0);
  });

  it("dạy bù vượt số buổi chuẩn → tiến độ kẹp trần 100%", () => {
    const r = computeAttendanceSummary({
      totalLessons: 10,
      sessionsHeld: 13,
      attendances: coMat(13),
    });
    expect(courseProgressPercent(r)).toBe(100);
  });

  it("nơi gọi CHƯA truyền sessionsHeld → lùi về số DÒNG điểm danh, không lùi về total", () => {
    // Lùi về `total` là dựng lại đúng cái lệch vừa vá, nên đường lui phải khác.
    const r = computeAttendanceSummary({ totalLessons: 12, attendances: coMat(7) });
    expect(r.daDienRa).toBe(7);
    expect(r.total).toBe(12);
  });
});
