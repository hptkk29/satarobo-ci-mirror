import { describe, it, expect } from "vitest";
import { buildQuestionWhere } from "./filter";

describe("buildQuestionWhere (FL1-03)", () => {
  it("returns empty where for empty filter", () => {
    expect(buildQuestionWhere({})).toEqual({});
  });

  it("filters by curriculumId (AC2 — Sata 4 không thấy Sata 3)", () => {
    const where = buildQuestionWhere({ curriculumId: "cur_sata4" });
    expect(where).toEqual({ curriculumId: "cur_sata4" });
    // câu hỏi của curriculum khác sẽ không khớp where này.
  });

  it("ignores blank/whitespace curriculumId", () => {
    expect(buildQuestionWhere({ curriculumId: "   " })).toEqual({});
    expect(buildQuestionWhere({ curriculumId: null })).toEqual({});
  });

  it("filters by courseId independently of curriculumId", () => {
    expect(buildQuestionWhere({ courseId: "course_1" })).toEqual({
      courseId: "course_1",
    });
  });

  it("combines type + difficulty + curriculum + tag", () => {
    const where = buildQuestionWhere({
      type: "MULTIPLE_CHOICE",
      difficulty: "EASY",
      curriculumId: "cur_1",
      tag: "loop",
    });
    expect(where).toEqual({
      type: "MULTIPLE_CHOICE",
      difficulty: "EASY",
      curriculumId: "cur_1",
      tags: { has: "loop" },
    });
  });

  it("builds case-insensitive OR search across text + questionCode", () => {
    const where = buildQuestionWhere({ q: "robot" });
    expect(where.OR).toEqual([
      { text: { contains: "robot", mode: "insensitive" } },
      { questionCode: { contains: "robot", mode: "insensitive" } },
    ]);
  });

  it("applies publicOnly for shared picker", () => {
    expect(buildQuestionWhere({ publicOnly: true, curriculumId: "c1" })).toEqual({
      isPublic: true,
      curriculumId: "c1",
    });
  });

  it("does not set isPublic when publicOnly is false/omitted", () => {
    expect(buildQuestionWhere({ publicOnly: false })).toEqual({});
  });
});
