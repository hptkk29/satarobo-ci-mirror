// #06 (L6) — màn "Nhận xét buổi học": roster HV được nhận xét. Test THUẦN, không DB.
import { describe, it, expect } from "vitest";
import {
  FEEDBACK_ATTENDED_STATUSES,
  deriveFeedbackRoster,
  summarizeSessionFeedback,
} from "@/lib/lms/session-feedback-roster";

const att = (studentId: string, status: string) => ({
  studentId,
  studentName: `HV ${studentId}`,
  status,
});
const enr = (studentId: string) => ({ studentId, studentName: `HV ${studentId}` });

describe("deriveFeedbackRoster", () => {
  it("chỉ PRESENT/LATE được tính là đi học (khớp PRESENT_STATUSES admin)", () => {
    expect(FEEDBACK_ATTENDED_STATUSES).toEqual(["PRESENT", "LATE"]);
  });

  it("có điểm danh → chỉ HV PRESENT/LATE; mọi dạng vắng (cũ + mới) đều loại", () => {
    const { attendanceTaken, students } = deriveFeedbackRoster(
      [
        att("a", "PRESENT"),
        att("b", "LATE"),
        att("c", "ABSENT"), // legacy 2-phase R7-08
        att("d", "EXCUSED"), // legacy 2-phase R7-08
        att("e", "ABSENT_EXCUSED"),
        att("f", "ABSENT_UNEXCUSED"),
      ],
      [enr("a"), enr("b"), enr("c"), enr("d"), enr("e"), enr("f")],
    );
    expect(attendanceTaken).toBe(true);
    expect(students.map((s) => s.studentId)).toEqual(["a", "b"]);
  });

  it("chưa điểm danh (0 bản ghi) → fallback toàn bộ roster active", () => {
    const { attendanceTaken, students } = deriveFeedbackRoster([], [enr("a"), enr("b")]);
    expect(attendanceTaken).toBe(false);
    expect(students.map((s) => s.studentId)).toEqual(["a", "b"]);
  });

  it("đã điểm danh nhưng cả lớp vắng → danh sách RỖNG (không fallback roster)", () => {
    const { attendanceTaken, students } = deriveFeedbackRoster(
      [att("a", "ABSENT_UNEXCUSED")],
      [enr("a"), enr("b")],
    );
    expect(attendanceTaken).toBe(true);
    expect(students).toEqual([]);
  });

  it("dedupe theo studentId, giữ thứ tự đầu vào", () => {
    const { students } = deriveFeedbackRoster(
      [att("a", "PRESENT"), att("b", "LATE"), att("a", "LATE")],
      [],
    );
    expect(students.map((s) => s.studentId)).toEqual(["a", "b"]);
  });
});

describe("summarizeSessionFeedback", () => {
  it("reviewed = feedback ∩ HV đi học — nhận xét cho HV vắng không tính tiến độ", () => {
    const s = summarizeSessionFeedback(
      [
        { studentId: "a", status: "PRESENT" },
        { studentId: "b", status: "LATE" },
        { studentId: "c", status: "ABSENT_UNEXCUSED" },
      ],
      ["a", "c"], // "c" vắng nhưng có feedback → không đếm
    );
    expect(s).toEqual({ attendanceTaken: true, attended: 2, reviewed: 1, complete: false });
  });

  it("complete khi mọi HV đi học đều đã có nhận xét", () => {
    const s = summarizeSessionFeedback(
      [
        { studentId: "a", status: "PRESENT" },
        { studentId: "b", status: "LATE" },
      ],
      ["a", "b"],
    );
    expect(s.complete).toBe(true);
    expect(s.reviewed).toBe(2);
  });

  it("chưa điểm danh → attended=0, không bao giờ complete (kể cả có feedback)", () => {
    const s = summarizeSessionFeedback([], ["a"]);
    expect(s).toEqual({ attendanceTaken: false, attended: 0, reviewed: 1, complete: false });
  });

  it("điểm danh xong nhưng 0 HV đi học → không complete (tránh badge xanh rỗng)", () => {
    const s = summarizeSessionFeedback([{ studentId: "a", status: "ABSENT_EXCUSED" }], []);
    expect(s.complete).toBe(false);
    expect(s.attended).toBe(0);
  });
});
