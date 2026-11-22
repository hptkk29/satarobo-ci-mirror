import { describe, it, expect } from "vitest";
import { resolveEffectiveCurriculumVersion } from "./snapshot";

describe("resolveEffectiveCurriculumVersion (PURE)", () => {
  it("đã ghim version → dùng version ghim (bỏ qua fallback)", () => {
    expect(
      resolveEffectiveCurriculumVersion({ curriculumId: "c1", curriculumVersion: 2 }, 5),
    ).toBe(2);
  });

  it("ghim version = 1 → vẫn dùng 1 (không coi là falsy)", () => {
    expect(
      resolveEffectiveCurriculumVersion({ curriculumId: "c1", curriculumVersion: 1 }, 9),
    ).toBe(1);
  });

  it("chưa ghim (curriculumVersion null) → fallback version active", () => {
    expect(
      resolveEffectiveCurriculumVersion({ curriculumId: null, curriculumVersion: null }, 4),
    ).toBe(4);
  });

  it("chưa ghim và không có fallback → null", () => {
    expect(
      resolveEffectiveCurriculumVersion({ curriculumId: null, curriculumVersion: null }, null),
    ).toBeNull();
  });

  it("có curriculumId nhưng version null → vẫn fallback (chỉ version quyết định)", () => {
    expect(
      resolveEffectiveCurriculumVersion({ curriculumId: "c1", curriculumVersion: null }, 3),
    ).toBe(3);
  });
});
