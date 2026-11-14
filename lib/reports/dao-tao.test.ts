// lib/reports/dao-tao.test.ts — R7-17: test THUẦN cho báo cáo đào tạo (không cần DB).
import { describe, it, expect } from "vitest";
import {
  computeTrainingReport,
  pct,
  round1,
  type AttendanceRecord,
  type ClassRecord,
  type HomeworkRecord,
  type LessonRecord,
} from "@/lib/reports/dao-tao";

const classes: ClassRecord[] = [
  { id: "c1", name: "Sata 1 — Sáng", classCode: "S1A" },
  { id: "c2", name: "Sata 2 — Chiều", classCode: null },
];

describe("[R7-17] pct / round1 (THUẦN)", () => {
  it("round1 làm tròn 1 chữ số", () => {
    expect(round1(66.666)).toBe(66.7);
    expect(round1(50)).toBe(50);
  });
  it("pct mẫu 0 → 0 (kỳ chưa có data)", () => {
    expect(pct(0, 0)).toBe(0);
    expect(pct(3, 4)).toBe(75);
    expect(pct(2, 3)).toBe(66.7);
  });
});

describe("[R7-17] computeTrainingReport — chuyên cần theo lớp", () => {
  it("present/late/made-up tính là đi học; buổi hủy loại khỏi mẫu", () => {
    const attendances: AttendanceRecord[] = [
      // c1: 4 buổi tính + 1 buổi hủy
      { classId: "c1", status: "PRESENT", makeupStatus: "NONE", sessionStatus: "COMPLETED" },
      { classId: "c1", status: "LATE", makeupStatus: "NONE", sessionStatus: "COMPLETED" },
      { classId: "c1", status: "ABSENT_UNEXCUSED", makeupStatus: "NONE", sessionStatus: "COMPLETED" },
      { classId: "c1", status: "ABSENT_EXCUSED", makeupStatus: "MADE_UP", sessionStatus: "COMPLETED" },
      { classId: "c1", status: "ABSENT", makeupStatus: "NONE", sessionStatus: "CANCELLED" }, // bỏ
      // c2: 2 buổi, 1 chờ bù
      { classId: "c2", status: "PRESENT", makeupStatus: "NONE", sessionStatus: "COMPLETED" },
      { classId: "c2", status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", sessionStatus: "COMPLETED" },
    ];
    const r = computeTrainingReport({ classes, attendances, homework: [], lessons: [] });

    expect(r.totalClasses).toBe(2);
    const c1 = r.perClass.find((p) => p.classId === "c1")!;
    expect(c1.counted).toBe(4); // buổi hủy không tính
    expect(c1.attended).toBe(3); // present + late + made-up
    expect(c1.absent).toBe(1);
    expect(c1.madeUp).toBe(1);
    expect(c1.attendanceRate).toBe(75); // 3/4

    const c2 = r.perClass.find((p) => p.classId === "c2")!;
    expect(c2.counted).toBe(2);
    expect(c2.attended).toBe(1);
    expect(c2.needMakeup).toBe(1);
    expect(c2.attendanceRate).toBe(50);

    // overall = 4 attended / 6 counted
    expect(r.overallAttendanceRate).toBe(66.7);
  });

  it("học bù đếm trên toàn bộ attendances (kể cả lớp ngoài danh sách)", () => {
    const attendances: AttendanceRecord[] = [
      { classId: "c1", status: "ABSENT", makeupStatus: "MADE_UP", sessionStatus: "COMPLETED" },
      { classId: "c1", status: "ABSENT", makeupStatus: "NEEDS_MAKEUP", sessionStatus: "COMPLETED" },
      { classId: "zzz", status: "ABSENT", makeupStatus: "MADE_UP", sessionStatus: "COMPLETED" }, // ngoài DS
    ];
    const r = computeTrainingReport({ classes, attendances, homework: [], lessons: [] });
    expect(r.makeupMadeUp).toBe(2);
    expect(r.makeupNeeded).toBe(1);
    // bản ghi lớp "zzz" không nằm trong perClass nhưng vẫn đếm makeup.
    expect(r.perClass).toHaveLength(2);
  });
});

describe("[R7-17] computeTrainingReport — bài tập + buổi thiếu đề", () => {
  it("tỷ lệ hoàn thành = (SUBMITTED+GRADED)/tổng", () => {
    const homework: HomeworkRecord[] = [
      { classId: "c1", status: "SUBMITTED" },
      { classId: "c1", status: "GRADED" },
      { classId: "c1", status: "ASSIGNED" },
      { classId: "c2", status: "MISSED" },
    ];
    const r = computeTrainingReport({ classes, attendances: [], homework, lessons: [] });
    expect(r.homeworkTotal).toBe(4);
    expect(r.homeworkCompleted).toBe(2);
    expect(r.homeworkCompletionRate).toBe(50);
  });

  it("đếm Lesson thiếu đề thi (hasExam=false)", () => {
    const lessons: LessonRecord[] = [
      { id: "l1", title: "Bài 1", hasExam: true },
      { id: "l2", title: "Bài 2", hasExam: false },
      { id: "l3", title: "Bài 3", hasExam: false },
    ];
    const r = computeTrainingReport({ classes, attendances: [], homework: [], lessons });
    expect(r.lessonsTotal).toBe(3);
    expect(r.lessonsMissingExam).toBe(2);
  });
});

describe("[R7-17] kỳ rỗng → render 0, không lỗi", () => {
  it("mọi mảng rỗng", () => {
    const r = computeTrainingReport({ classes: [], attendances: [], homework: [], lessons: [] });
    expect(r.totalClasses).toBe(0);
    expect(r.overallAttendanceRate).toBe(0);
    expect(r.homeworkCompletionRate).toBe(0);
    expect(r.lessonsMissingExam).toBe(0);
    expect(r.makeupMadeUp).toBe(0);
    expect(r.perClass).toEqual([]);
  });
});
