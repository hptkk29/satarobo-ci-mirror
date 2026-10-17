// T-LMS (R2-LMS-4) — clone câu hỏi template → Question gắn Assignment khi tự sinh
// bài tập theo buổi. Thuần (không DB) — chạy lane test:unit mặc định.
import { describe, it, expect } from "vitest";
import {
  cloneQuestionForAssignment,
  isLateSubmission,
  type TemplateSourceQuestion,
} from "./assignment";

const SRC: TemplateSourceQuestion = {
  type: "MULTIPLE_CHOICE",
  text: "1 + 1 = ?",
  explanation: "Cộng cơ bản",
  imageUrl: "https://r2/x.png",
  difficulty: "EASY",
  tags: ["math", "grade1"],
  curriculumId: "cur1",
  courseId: "course1",
  points: 2,
  timeLimitSec: 60,
  lessonId: "lesson1",
  correctAnswer: null,
  meta: { ui: "single" }, // Parity 18/08 — payload soạn đề phải theo bản clone
  isPublic: true,
  notes: "note",
  choices: [
    { order: 0, text: "1", isCorrect: false, imageUrl: null },
    { order: 1, text: "2", isCorrect: true, imageUrl: "https://r2/two.png" },
  ],
};

describe("cloneQuestionForAssignment", () => {
  const cloned = cloneQuestionForAssignment(SRC);

  it("[T-LMS-1] KHÔNG copy questionCode/id/authorId/assignmentId (tránh đụng unique + gốc)", () => {
    expect(cloned).not.toHaveProperty("questionCode");
    expect(cloned).not.toHaveProperty("id");
    expect(cloned).not.toHaveProperty("authorId");
    expect(cloned).not.toHaveProperty("assignmentId");
  });

  it("[T-LMS-2] copy đúng các field nội dung", () => {
    expect(cloned.type).toBe("MULTIPLE_CHOICE");
    expect(cloned.text).toBe("1 + 1 = ?");
    expect(cloned.difficulty).toBe("EASY");
    expect(cloned.tags).toEqual(["math", "grade1"]);
    expect(cloned.points).toBe(2);
    expect(cloned.lessonId).toBe("lesson1");
    expect(cloned.isPublic).toBe(true);
    // Parity 18/08 — meta (FILL_BLANK/MATCHING/ORDERING/ui) phải theo bản clone.
    expect(cloned.meta).toEqual({ ui: "single" });
  });

  it("[T-LMS-3] choices clone qua nested create theo order/text/isCorrect/imageUrl", () => {
    expect(cloned.choices.create).toHaveLength(2);
    expect(cloned.choices.create[1]).toEqual({
      order: 1,
      text: "2",
      isCorrect: true,
      imageUrl: "https://r2/two.png",
    });
  });

  it("[T-LMS-4] câu hỏi không có lựa chọn → choices.create rỗng", () => {
    const c = cloneQuestionForAssignment({ ...SRC, choices: [] });
    expect(c.choices.create).toEqual([]);
  });
});

describe("isLateSubmission (regression)", () => {
  it("[T-LMS-5] quá hạn → late; không hạn → không bao giờ late", () => {
    const due = new Date("2026-01-10T00:00:00Z");
    expect(isLateSubmission(due, new Date("2026-01-11T00:00:00Z"))).toBe(true);
    expect(isLateSubmission(due, new Date("2026-01-09T00:00:00Z"))).toBe(false);
    expect(isLateSubmission(null, new Date())).toBe(false);
  });
});
