import { describe, expect, it } from "vitest";
import {
  hasLinkedCourse,
  normalizeJsonCurriculum,
  resolvePackageCurriculum,
  type CurriculumRef,
} from "./package-course-link";

describe("hasLinkedCourse", () => {
  it("true khi có courseId", () => {
    expect(hasLinkedCourse({ courseId: "c1" })).toBe(true);
  });
  it("false khi null/undefined/rỗng", () => {
    expect(hasLinkedCourse({ courseId: null })).toBe(false);
    expect(hasLinkedCourse({})).toBe(false);
    expect(hasLinkedCourse({ courseId: "" })).toBe(false);
  });
});

describe("normalizeJsonCurriculum", () => {
  it("lọc phần tử hợp lệ, bỏ rác", () => {
    const input = [
      { topic: "Robot cơ bản", lessons: 4 },
      { topic: "", lessons: 2 }, // bỏ — topic rỗng
      "string-rac", // bỏ
      null, // bỏ
      { topic: "Lập trình", lessons: "x" }, // lessons không hợp lệ → 0
    ];
    expect(normalizeJsonCurriculum(input)).toEqual<CurriculumRef[]>([
      { topic: "Robot cơ bản", lessons: 4 },
      { topic: "Lập trình", lessons: 0 },
    ]);
  });
  it("non-array → []", () => {
    expect(normalizeJsonCurriculum(null)).toEqual([]);
    expect(normalizeJsonCurriculum("nope")).toEqual([]);
  });
});

describe("resolvePackageCurriculum", () => {
  const courseItems: CurriculumRef[] = [{ topic: "Buổi 1", lessons: 1 }];
  const jsonItems = [{ topic: "JSON cũ", lessons: 3 }];

  it("ưu tiên giáo trình khoá dạy khi gói có courseId và khoá có data", () => {
    const r = resolvePackageCurriculum({ courseId: "c1", curriculum: jsonItems }, courseItems);
    expect(r.source).toBe("course");
    expect(r.items).toEqual(courseItems);
  });

  it("fallback JSON cũ khi không liên kết khoá", () => {
    const r = resolvePackageCurriculum({ courseId: null, curriculum: jsonItems }, courseItems);
    expect(r.source).toBe("json");
    expect(r.items).toEqual([{ topic: "JSON cũ", lessons: 3 }]);
  });

  it("fallback JSON cũ khi liên kết khoá nhưng khoá chưa có giáo trình", () => {
    const r = resolvePackageCurriculum({ courseId: "c1", curriculum: jsonItems }, []);
    expect(r.source).toBe("json");
    expect(r.items).toEqual([{ topic: "JSON cũ", lessons: 3 }]);
  });
});
