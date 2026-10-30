import { describe, it, expect } from "vitest";
import { computeStudentProgress } from "@/lib/progress";

// Khoá CÔNG THỨC tính tiến độ (dùng chung getStudentProgress 1 HV + getClassProgress
// batch). Nếu ai đổi công thức, test này gãy → tránh lệch số liệu học bạ/portal/teacher.
describe("computeStudentProgress", () => {
  it("tính đủ các tỉ lệ (có mặt / giáo trình / bài tập / thi)", () => {
    const p = computeStudentProgress({
      studentId: "s1",
      classId: "c1",
      sessions: [
        { id: "ss1", lessonId: "l1" },
        { id: "ss2", lessonId: "l2" },
        { id: "ss3", lessonId: null },
      ],
      // PRESENT + (ABSENT nhưng MADE_UP) + LATE = 3 buổi tính có mặt / 3 = 100%.
      attendances: [
        { status: "PRESENT", makeupStatus: null },
        { status: "ABSENT", makeupStatus: "MADE_UP" },
        { status: "LATE", makeupStatus: null },
      ],
      totalLessons: 5,
      submissions: [
        { status: "GRADED", score: 8, totalPoints: 10 },
        { status: "SUBMITTED", score: null, totalPoints: 10 },
        { status: "GRADED", score: 9, totalPoints: 10 },
      ],
      attempts: [{ passed: true }, { passed: false }, { passed: true }],
    });

    expect(p.totalSessions).toBe(3);
    expect(p.attendedSessions).toBe(3);
    expect(p.attendanceRate).toBe(100);
    expect(p.coveredLessons).toBe(2); // l1, l2 (ss3 lessonId null)
    expect(p.lessonCoverageRate).toBe(40); // round(2/5*100)
    expect(p.totalAssignments).toBe(3);
    expect(p.submittedAssignments).toBe(3);
    expect(p.gradedAssignments).toBe(2);
    expect(p.averageScore).toBe(8.5); // (8/10*10 + 9/10*10)/2
    expect(p.submissionRate).toBe(100);
    expect(p.examAttempts).toBe(3);
    expect(p.passedExams).toBe(2);
  });

  it("an toàn chia-0 khi lớp chưa có buổi/lesson/bài", () => {
    const p = computeStudentProgress({
      studentId: "s1",
      classId: "c1",
      sessions: [],
      attendances: [],
      totalLessons: 0,
      submissions: [],
      attempts: [],
    });
    expect(p.attendanceRate).toBe(0);
    expect(p.lessonCoverageRate).toBe(0);
    expect(p.submissionRate).toBe(0);
    expect(p.averageScore).toBeNull();
    expect(p.passedExams).toBe(0);
  });

  it("điểm TB chuẩn hoá theo totalPoints của từng bài (thang 10, làm tròn 1 số lẻ)", () => {
    const p = computeStudentProgress({
      studentId: "s1",
      classId: "c1",
      sessions: [{ id: "ss1", lessonId: null }],
      attendances: [],
      totalLessons: 0,
      // 15/20*10=7.5 và 4/5*10=8 → TB (7.5+8)/2 = 7.75 → round(*10)/10 = 7.8.
      submissions: [
        { status: "GRADED", score: 15, totalPoints: 20 },
        { status: "GRADED", score: 4, totalPoints: 5 },
      ],
      attempts: [],
    });
    expect(p.averageScore).toBe(7.8);
    expect(p.attendanceRate).toBe(0); // 0 buổi có mặt / 1 buổi
  });
});
