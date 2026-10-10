import { describe, it, expect } from "vitest";
import {
  assignmentTemplateSchema,
  templateToAssignmentData,
  type TemplateCopyFields,
} from "./template";

const baseTemplate: TemplateCopyFields = {
  id: "tpl_1",
  title: "Bài tập Sata 4 — Vòng lặp",
  description: "Viết chương trình điều khiển robot đi theo hình vuông",
  instructions: "Dùng vòng lặp for 4 lần",
  kind: "HOMEWORK",
  lessonId: "lesson_9",
  totalPoints: 8,
  allowText: true,
  allowFile: false,
};

describe("templateToAssignmentData (FL1-06 — sinh bài giao từ template)", () => {
  it("copies content fields verbatim + attaches classId + keeps templateId", () => {
    const data = templateToAssignmentData(baseTemplate, { classId: "cls_1" });
    expect(data.title).toBe(baseTemplate.title);
    expect(data.description).toBe(baseTemplate.description);
    expect(data.instructions).toBe(baseTemplate.instructions);
    expect(data.kind).toBe("HOMEWORK");
    expect(data.lessonId).toBe("lesson_9");
    expect(data.totalPoints).toBe(8);
    expect(data.allowText).toBe(true);
    expect(data.allowFile).toBe(false);
    // Assignment-specific
    expect(data.classId).toBe("cls_1");
    expect(data.templateId).toBe("tpl_1"); // truy vết về template nguồn
  });

  it("new assignment always starts as DRAFT (no auto-publish)", () => {
    const data = templateToAssignmentData(baseTemplate, { classId: "cls_2" });
    expect(data.status).toBe("DRAFT");
  });

  it("passes through createdById + dueAt when provided", () => {
    const due = new Date("2026-07-01T09:00:00Z");
    const data = templateToAssignmentData(baseTemplate, {
      classId: "cls_3",
      createdById: "emp_7",
      dueAt: due,
    });
    expect(data.createdById).toBe("emp_7");
    expect(data.dueAt).toBe(due);
  });

  it("defaults nullable opts (createdById/dueAt) to null", () => {
    const data = templateToAssignmentData(baseTemplate, { classId: "cls_4" });
    expect(data.createdById).toBeNull();
    expect(data.dueAt).toBeNull();
  });

  it("normalises null lessonId/instructions", () => {
    const data = templateToAssignmentData(
      { ...baseTemplate, lessonId: null, instructions: null },
      { classId: "cls_5" },
    );
    expect(data.lessonId).toBeNull();
    expect(data.instructions).toBeNull();
  });
});

describe("assignmentTemplateSchema (FL1-06 — validator template)", () => {
  it("accepts a curriculum-scoped template WITHOUT classId", () => {
    const parsed = assignmentTemplateSchema.safeParse({
      title: "Mẫu Sata 4",
      description: "Mô tả",
      curriculumId: "cur_sata4",
    });
    expect(parsed.success).toBe(true);
    // Template không có khái niệm classId.
    expect(parsed.success && "classId" in parsed.data).toBe(false);
  });

  it("trims blank curriculumId/lessonId/instructions to null", () => {
    const parsed = assignmentTemplateSchema.parse({
      title: "T",
      description: "D",
      curriculumId: "   ",
      lessonId: "",
      instructions: "  ",
    });
    expect(parsed.curriculumId).toBeNull();
    expect(parsed.lessonId).toBeNull();
    expect(parsed.instructions).toBeNull();
  });

  it("rejects empty title", () => {
    const parsed = assignmentTemplateSchema.safeParse({
      title: "",
      description: "D",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects when both allowText and allowFile are false", () => {
    const parsed = assignmentTemplateSchema.safeParse({
      title: "T",
      description: "D",
      allowText: false,
      allowFile: false,
    });
    expect(parsed.success).toBe(false);
  });

  it("defaults kind to HOMEWORK (template = bank theo buổi)", () => {
    const parsed = assignmentTemplateSchema.parse({ title: "T", description: "D" });
    expect(parsed.kind).toBe("HOMEWORK");
  });
});
