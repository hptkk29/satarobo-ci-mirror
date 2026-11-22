// LMS-16 — Báo cáo hiệu suất GV (THUẦN, không cần DB). Pure fixtures + assert từng chỉ số.
import { describe, it, expect } from "vitest";
import {
  buildTeacherPerformanceReport,
  pct,
  round1,
  type TeacherPerformanceInput,
} from "@/lib/reports/teacher-performance";

const baseInput = (): TeacherPerformanceInput => ({
  teachers: [
    { id: "t1", name: "Cô An" },
    { id: "t2", name: "Thầy Bình" },
    { id: "t3", name: null }, // GV chưa đặt tên
  ],
  // t1: 3 buổi COMPLETED + 1 SCHEDULED (không tính). t2: 1 COMPLETED. t3: 0.
  sessions: [
    { teacherId: "t1", status: "COMPLETED" },
    { teacherId: "t1", status: "COMPLETED" },
    { teacherId: "t1", status: "COMPLETED" },
    { teacherId: "t1", status: "SCHEDULED" },
    { teacherId: "t2", status: "COMPLETED" },
    { teacherId: "tX", status: "COMPLETED" }, // GV ngoài danh sách → bỏ.
  ],
  // t1: 4 buổi điểm danh, 3 đi học (1 made-up tính đi học), 1 vắng, 1 CANCELLED không tính.
  attendances: [
    { teacherId: "t1", status: "PRESENT", makeupStatus: "NONE", sessionStatus: "COMPLETED" },
    { teacherId: "t1", status: "LATE", makeupStatus: "NONE", sessionStatus: "COMPLETED" },
    { teacherId: "t1", status: "ABSENT", makeupStatus: "MADE_UP", sessionStatus: "COMPLETED" },
    { teacherId: "t1", status: "ABSENT", makeupStatus: "NEEDS_MAKEUP", sessionStatus: "COMPLETED" },
    { teacherId: "t1", status: "ABSENT", makeupStatus: "NONE", sessionStatus: "CANCELLED" }, // hủy → bỏ
    { teacherId: "t2", status: "PRESENT", makeupStatus: "NONE", sessionStatus: "COMPLETED" },
  ],
  // t1: 3 enrollment đang học nhưng s1 trùng → 2 HV distinct; 1 WITHDREW không tính.
  enrollments: [
    { teacherId: "t1", studentId: "s1", status: "ACTIVE" },
    { teacherId: "t1", studentId: "s1", status: "STUDYING" }, // trùng s1
    { teacherId: "t1", studentId: "s2", status: "CONFIRMED" },
    { teacherId: "t1", studentId: "s3", status: "WITHDREW" }, // không tính
    { teacherId: "t2", studentId: "s4", status: "ACTIVE" },
  ],
  // t1: điểm 4 và 2 → TB 3. t2: chưa có điểm → null.
  scores: [
    { teacherId: "t1", level: 4 },
    { teacherId: "t1", level: 2 },
  ],
});

describe("[LMS-16] pct / round1", () => {
  it("chia 0 an toàn + làm tròn 1 chữ số", () => {
    expect(pct(0, 0)).toBe(0);
    expect(pct(3, 4)).toBe(75);
    expect(round1(3 / 3)).toBe(1);
  });
});

describe("[LMS-16] buildTeacherPerformanceReport", () => {
  it("đếm buổi đã dạy (chỉ COMPLETED), bỏ GV ngoài danh sách", () => {
    const r = buildTeacherPerformanceReport(baseInput());
    const t1 = r.rows.find((x) => x.teacherId === "t1")!;
    const t2 = r.rows.find((x) => x.teacherId === "t2")!;
    const t3 = r.rows.find((x) => x.teacherId === "t3")!;
    expect(t1.sessionsTaught).toBe(3);
    expect(t2.sessionsTaught).toBe(1);
    expect(t3.sessionsTaught).toBe(0);
  });

  it("tỷ lệ điểm danh: made-up tính đi học, buổi hủy không tính mẫu", () => {
    const t1 = buildTeacherPerformanceReport(baseInput()).rows.find((x) => x.teacherId === "t1")!;
    // 4 buổi tính (loại 1 CANCELLED), 3 đi học (PRESENT+LATE+MADE_UP).
    expect(t1.attendanceCounted).toBe(4);
    expect(t1.attendanceAttended).toBe(3);
    expect(t1.attendanceRate).toBe(75);
  });

  it("số HV distinct, chỉ tính enrollment đang hoạt động", () => {
    const t1 = buildTeacherPerformanceReport(baseInput()).rows.find((x) => x.teacherId === "t1")!;
    expect(t1.studentCount).toBe(2); // s1 (trùng) + s2; s3 WITHDREW loại.
  });

  it("điểm học bạ TB, null khi chưa có điểm", () => {
    const r = buildTeacherPerformanceReport(baseInput());
    expect(r.rows.find((x) => x.teacherId === "t1")!.avgReportScore).toBe(3); // (4+2)/2
    expect(r.rows.find((x) => x.teacherId === "t2")!.avgReportScore).toBeNull();
  });

  it("GV null name → nhãn mặc định; sắp xếp theo số buổi giảm dần", () => {
    const r = buildTeacherPerformanceReport(baseInput());
    expect(r.rows[0].teacherId).toBe("t1"); // nhiều buổi nhất
    expect(r.rows.find((x) => x.teacherId === "t3")!.teacherName).toBe("(Chưa đặt tên)");
    expect(r.totalTeachers).toBe(3);
  });

  it("input rỗng → không lỗi, mọi số 0", () => {
    const r = buildTeacherPerformanceReport({
      teachers: [],
      sessions: [],
      attendances: [],
      enrollments: [],
      scores: [],
    });
    expect(r.totalTeachers).toBe(0);
    expect(r.rows).toEqual([]);
  });
});
