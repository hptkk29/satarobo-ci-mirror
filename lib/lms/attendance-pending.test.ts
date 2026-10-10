// Canh gác cho lib/lms/attendance-pending.ts — QA site GV vòng 1, nguyên nhân gốc RC-2.
//
// Ca quan trọng nhất trong file này là "một dòng điểm danh đơn lẻ": nó tái hiện đúng
// ngòi nổ trên prod — duyệt phiếu xin nghỉ của phụ huynh ghi một dòng Attendance và
// buổi biến mất khỏi việc cần làm của giáo viên. Ca đó ĐỎ với logic cũ, XANH với logic
// mới. Đừng xoá nó khi refactor.
import { describe, expect, it } from "vitest";

import {
  countMissingAttendanceByClass,
  sessionAttendanceState,
  sessionsMissingAttendance,
} from "@/lib/lms/attendance-pending";

const roster = (...ids: string[]) => new Set(ids);

describe("sessionsMissingAttendance", () => {
  const sessions = [{ id: "s1", classId: "c1" }];
  const rosterByClass = new Map([["c1", roster("a", "b", "c")]]);

  it("MỘT dòng điểm danh KHÔNG làm buổi hết nợ (ngòi nổ phiếu xin nghỉ của PH)", () => {
    const marked = new Map([["s1", roster("a")]]);
    const out = sessionsMissingAttendance({ sessions, markedBySession: marked, rosterByClass });
    expect(out.map((s) => s.id)).toEqual(["s1"]);
  });

  it("không dòng nào ⇒ còn nợ", () => {
    const out = sessionsMissingAttendance({
      sessions,
      markedBySession: new Map(),
      rosterByClass,
    });
    expect(out).toHaveLength(1);
  });

  it("phủ ĐỦ sĩ số ⇒ hết nợ", () => {
    const marked = new Map([["s1", roster("a", "b", "c")]]);
    const out = sessionsMissingAttendance({ sessions, markedBySession: marked, rosterByClass });
    expect(out).toHaveLength(0);
  });

  it("thiếu ĐÚNG MỘT em vẫn còn nợ", () => {
    const marked = new Map([["s1", roster("a", "b")]]);
    expect(
      sessionsMissingAttendance({ sessions, markedBySession: marked, rosterByClass }),
    ).toHaveLength(1);
  });

  it("học viên HỌC BÙ không che được chỗ thiếu — so danh sách, không so số lượng", () => {
    // 3 bản ghi cho sĩ số 3 người, nhưng "x" là em học bù từ lớp khác và "c" chưa chấm.
    const marked = new Map([["s1", roster("a", "b", "x")]]);
    const out = sessionsMissingAttendance({ sessions, markedBySession: marked, rosterByClass });
    expect(out).toHaveLength(1);
  });

  it("sĩ số RỖNG ⇒ không còn việc (lớp đã kết khoá / lớp chưa xếp ai)", () => {
    const out = sessionsMissingAttendance({
      sessions,
      markedBySession: new Map(),
      rosterByClass: new Map([["c1", roster()]]),
    });
    expect(out).toHaveLength(0);
  });

  it("lớp không có trong bảng sĩ số ⇒ không còn việc, không ném lỗi", () => {
    const out = sessionsMissingAttendance({
      sessions,
      markedBySession: new Map(),
      rosterByClass: new Map(),
    });
    expect(out).toHaveLength(0);
  });
});

describe("countMissingAttendanceByClass", () => {
  it("đếm theo lớp, lớp không nợ thì không có khoá trong map", () => {
    const out = countMissingAttendanceByClass({
      sessions: [
        { id: "s1", classId: "c1" },
        { id: "s2", classId: "c1" },
        { id: "s3", classId: "c2" },
      ],
      markedBySession: new Map([["s3", roster("z")]]),
      rosterByClass: new Map([
        ["c1", roster("a", "b")],
        ["c2", roster("z")],
      ]),
    });
    expect(out.get("c1")).toBe(2);
    expect(out.has("c2")).toBe(false);
  });
});

describe("sessionAttendanceState — ba trạng thái thay cho nhị phân", () => {
  it("sĩ số rỗng ⇒ KHONG_CO_VIEC, không phải 'Hoàn tất' (BUG-016)", () => {
    expect(
      sessionAttendanceState({ markedStudentIds: [], rosterStudentIds: [] }),
    ).toBe("KHONG_CO_VIEC");
  });

  it("phủ đủ ⇒ DU", () => {
    expect(
      sessionAttendanceState({ markedStudentIds: ["a", "b"], rosterStudentIds: ["a", "b"] }),
    ).toBe("DU");
  });

  it("phủ thiếu ⇒ THIEU", () => {
    expect(
      sessionAttendanceState({ markedStudentIds: ["a"], rosterStudentIds: ["a", "b"] }),
    ).toBe("THIEU");
  });
});
