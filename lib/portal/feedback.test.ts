// Portal V2 — nhận xét buổi học: parse THUẦN Json phiếu mở rộng (notes/rubric) +
// map row qua getStudentFeedback với DB mock (không chạm DB thật).
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    studentSessionFeedback: { findMany: vi.fn() },
    // 21/08 — getStudentFeedback nạp thêm buổi của lớp để đánh SỐ BUỔI khớp site GV
    // (lib/lms/session-order). Mặc định rỗng ⇒ số buổi lùi về Lesson.order như trước.
    classSession: { findMany: vi.fn(() => Promise.resolve([])) },
    user: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import {
  getStudentFeedback,
  parseFeedbackNotes,
  parseFeedbackRubric,
} from "@/lib/portal/feedback";

const fbFindMany = db.studentSessionFeedback.findMany as unknown as Mock;
const sessionFindMany = db.classSession.findMany as unknown as Mock;
const userFindMany = db.user.findMany as unknown as Mock;

describe("parseFeedbackNotes — 4 mục văn xuôi từ Json GV ghi", () => {
  it("null / sai dạng (string, số, mảng) → null, không throw", () => {
    expect(parseFeedbackNotes(null)).toBeNull();
    expect(parseFeedbackNotes(undefined)).toBeNull();
    expect(parseFeedbackNotes("kiến thức tốt")).toBeNull();
    expect(parseFeedbackNotes(42)).toBeNull();
    expect(parseFeedbackNotes(["knowledge"])).toBeNull();
  });

  it("object nhưng mọi mục rỗng/toàn khoảng trắng → null (card không hiện khối rỗng)", () => {
    expect(parseFeedbackNotes({ knowledge: "", skill: "  ", attitude: "", proposal: "" })).toBeNull();
    expect(parseFeedbackNotes({})).toBeNull();
  });

  it("có ≥1 mục nội dung → trả đủ 5 key, mục thiếu/sai kiểu thành chuỗi rỗng", () => {
    const out = parseFeedbackNotes({ skill: "Lắp ráp nhanh", knowledge: 5, attitude: null });
    expect(out).toEqual({
      overall: "",
      knowledge: "",
      skill: "Lắp ráp nhanh",
      attitude: "",
      proposal: "",
    });
  });

  // 21/08 — phiếu dạng MỚI: chỉ có "Đánh giá chung". Bỏ `overall` khỏi phép kiểm
  // "có nội dung không" là phiếu mới bị coi như trống ở portal PH, PDF và màn quản lý.
  it("phiếu chỉ có overall (Đánh giá chung) → KHÔNG bị coi là trống", () => {
    const out = parseFeedbackNotes({ overall: "Con tiếp thu tốt, cần chủ động hơn." });
    expect(out?.overall).toBe("Con tiếp thu tốt, cần chủ động hơn.");
    expect(out?.knowledge).toBe("");
  });

  it("overall toàn khoảng trắng + 4 mục rỗng → null", () => {
    expect(parseFeedbackNotes({ overall: "   " })).toBeNull();
  });
});

describe("parseFeedbackRubric — rubric năng lực từ Json GV ghi", () => {
  it("null / sai dạng / object rỗng → null, không throw", () => {
    expect(parseFeedbackRubric(null)).toBeNull();
    expect(parseFeedbackRubric(undefined)).toBeNull();
    expect(parseFeedbackRubric("kt-cu:2")).toBeNull();
    expect(parseFeedbackRubric([1, 2, 3])).toBeNull();
    expect(parseFeedbackRubric({})).toBeNull();
  });

  it("chỉ giữ tiêu chí ĐÃ BIẾT có mức 1-5; KHÔNG chế mức mặc định cho tiêu chí thiếu", () => {
    const out = parseFeedbackRubric({ "kt-cu": 2, "td-gt": 5 });
    expect(out).toEqual({ "kt-cu": 2, "td-gt": 5 }); // không bịa mức 3 cho 7 tiêu chí còn lại
  });

  it("loại giá trị lệch: ngoài thang, không nguyên, boolean, id lạ; nhận chuỗi số hợp lệ", () => {
    const out = parseFeedbackRubric({
      "kt-cu": 0, // ngoài thang
      "kt-moi": 6, // ngoài thang
      "kn-st": "3", // chuỗi số → 3
      "kn-pb": 2.5, // không nguyên
      "kn-mem": true, // boolean → loại
      "id-la": 1, // không thuộc EVAL_CRITERIA
      "td-tt": 4,
    });
    expect(out).toEqual({ "kn-st": 3, "td-tt": 4 });
  });

  it("toàn giá trị hỏng → null (card coi như không có rubric)", () => {
    expect(parseFeedbackRubric({ "kt-cu": 9, "id-la": 3 })).toBeNull();
  });
});

describe("getStudentFeedback — map row (DB mock)", () => {
  beforeEach(() => {
    fbFindMany.mockReset();
    userFindMany.mockReset();
    sessionFindMany.mockReset();
    sessionFindMany.mockResolvedValue([]);
  });

  const baseSession = {
    date: new Date("2026-07-20T02:00:00Z"),
    lesson: { order: 3, title: "Cảm biến siêu âm" },
    class: { classCode: "SR3-CS1-01" },
  };

  it("phiếu rubric-only (comment=null) → trả đủ projectName/notes/rubric, comment coalesce ''", async () => {
    fbFindMany.mockResolvedValue([
      {
        id: "fb1",
        comment: null,
        rating: null,
        projectName: "Dự án 3: Robot tránh vật cản",
        notes: { knowledge: "Nắm chắc vòng lặp", skill: "", attitude: "", proposal: "" },
        rubric: { "kt-cu": 1, "kn-st": 2 },
        createdById: "gv1",
        classSession: baseSession,
      },
    ]);
    userFindMany.mockResolvedValue([{ id: "gv1", name: "Cô Lan" }]);

    const items = await getStudentFeedback("hs-1");
    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0.comment).toBe(""); // null → '' nhưng card KHÔNG rỗng nhờ notes/rubric
    // 26/08 — tên dự án bám BÀI HỌC CỦA BUỔI, KHÔNG phải giá trị lưu trên phiếu.
    // Phiếu này lưu "Dự án 3: Robot tránh vật cản" trong khi buổi là "Cảm biến siêu âm";
    // đó chính là cảnh phụ huynh đọc tiêu đề một đằng, dòng "Dự án" một nẻo (NT-09).
    expect(it0.projectName).toBe("Cảm biến siêu âm");
    expect(it0.notes).toEqual({
      overall: "",
      knowledge: "Nắm chắc vòng lặp",
      skill: "",
      attitude: "",
      proposal: "",
    });
    expect(it0.rubric).toEqual({ "kt-cu": 1, "kn-st": 2 });
    expect(it0.title).toBe("Buổi 3: Cảm biến siêu âm");
    expect(it0.teacher).toBe("Cô Lan");
    expect(it0.className).toBe("SR3-CS1-01");
    expect(it0.dateISO).toBe("2026-07-20T02:00:00.000Z");
  });

  it("nhận xét cũ (chỉ comment+rating) → notes/rubric/projectName null, không vỡ", async () => {
    fbFindMany.mockResolvedValue([
      {
        id: "fb2",
        comment: "Con học tốt",
        rating: 4,
        projectName: null,
        notes: null,
        rubric: null,
        createdById: "gv2",
        classSession: baseSession,
      },
    ]);
    userFindMany.mockResolvedValue([{ id: "gv2", name: "Thầy Minh" }]);

    const [it0] = await getStudentFeedback("hs-1");
    expect(it0.comment).toBe("Con học tốt");
    expect(it0.rating).toBe(4);
    // Phiếu cũ không lưu tên dự án vẫn ra được tên — suy từ bài học của buổi.
    expect(it0.projectName).toBe("Cảm biến siêu âm");
    expect(it0.notes).toBeNull();
    expect(it0.rubric).toBeNull();
  });
});
