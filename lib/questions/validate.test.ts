import { describe, it, expect } from "vitest";
import { questionSchema } from "@/lib/validators/question";

const base = {
  type: "MULTIPLE_CHOICE" as const,
  text: "Câu hỏi mẫu?",
  difficulty: "EASY" as const,
  tags: [],
  choices: [],
};

describe("questionSchema — type-based validation (FL1-03)", () => {
  it("MULTIPLE_CHOICE: requires 2..6 choices and >=1 correct", () => {
    const tooFew = questionSchema.safeParse({
      ...base,
      choices: [{ order: 1, text: "A", isCorrect: true }],
    });
    expect(tooFew.success).toBe(false);

    const noCorrect = questionSchema.safeParse({
      ...base,
      choices: [
        { order: 1, text: "A", isCorrect: false },
        { order: 2, text: "B", isCorrect: false },
      ],
    });
    expect(noCorrect.success).toBe(false);

    const ok = questionSchema.safeParse({
      ...base,
      choices: [
        { order: 1, text: "A", isCorrect: true },
        { order: 2, text: "B", isCorrect: false },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("TRUE_FALSE: requires exactly 2 choices and exactly 1 correct", () => {
    const ok = questionSchema.safeParse({
      ...base,
      type: "TRUE_FALSE",
      choices: [
        { order: 1, text: "Đúng", isCorrect: true },
        { order: 2, text: "Sai", isCorrect: false },
      ],
    });
    expect(ok.success).toBe(true);

    const twoCorrect = questionSchema.safeParse({
      ...base,
      type: "TRUE_FALSE",
      choices: [
        { order: 1, text: "Đúng", isCorrect: true },
        { order: 2, text: "Sai", isCorrect: true },
      ],
    });
    expect(twoCorrect.success).toBe(false);
  });

  it("SHORT_ANSWER: requires correctAnswer", () => {
    expect(
      questionSchema.safeParse({ ...base, type: "SHORT_ANSWER" }).success,
    ).toBe(false);
    expect(
      questionSchema.safeParse({
        ...base,
        type: "SHORT_ANSWER",
        correctAnswer: "print",
      }).success,
    ).toBe(true);
  });

  it("ESSAY/CODE: correctAnswer optional", () => {
    expect(questionSchema.safeParse({ ...base, type: "ESSAY" }).success).toBe(true);
    expect(questionSchema.safeParse({ ...base, type: "CODE" }).success).toBe(true);
  });

  it("allows an image-only choice (text empty but imageUrl set)", () => {
    const res = questionSchema.safeParse({
      ...base,
      choices: [
        { order: 1, text: "", isCorrect: true, imageUrl: "https://r2/a.png" },
        { order: 2, text: "B", isCorrect: false },
      ],
    });
    expect(res.success).toBe(true);
  });

  it("rejects a choice with neither text nor image", () => {
    const res = questionSchema.safeParse({
      ...base,
      choices: [
        { order: 1, text: "", isCorrect: true },
        { order: 2, text: "B", isCorrect: false },
      ],
    });
    expect(res.success).toBe(false);
  });
});

describe("questionSchema — new FL1-03 fields", () => {
  const mc = {
    ...base,
    choices: [
      { order: 1, text: "A", isCorrect: true },
      { order: 2, text: "B", isCorrect: false },
    ],
  };

  it("accepts curriculumId/courseId/points/timeLimitSec and coerces numeric strings", () => {
    const res = questionSchema.safeParse({
      ...mc,
      curriculumId: "cur_1",
      courseId: "course_1",
      points: "1.5",
      timeLimitSec: "60",
      imageUrl: "https://r2/q.png",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.curriculumId).toBe("cur_1");
      expect(res.data.courseId).toBe("course_1");
      expect(res.data.points).toBe(1.5);
      expect(res.data.timeLimitSec).toBe(60);
      expect(res.data.imageUrl).toBe("https://r2/q.png");
    }
  });

  it("treats blank curriculum/points/time as null", () => {
    const res = questionSchema.safeParse({
      ...mc,
      curriculumId: "",
      points: "",
      timeLimitSec: "",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.curriculumId).toBeNull();
      expect(res.data.points).toBeNull();
      expect(res.data.timeLimitSec).toBeNull();
    }
  });

  it("rejects negative points", () => {
    expect(questionSchema.safeParse({ ...mc, points: -1 }).success).toBe(false);
  });

  it("rejects non-integer / < 1 timeLimitSec", () => {
    expect(questionSchema.safeParse({ ...mc, timeLimitSec: 0 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...mc, timeLimitSec: 1.5 }).success).toBe(
      false,
    );
  });
});
