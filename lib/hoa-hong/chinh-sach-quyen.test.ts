// @vitest-environment node
// [NHH-FE-PV-*] — CÁCH LY GHI của chính sách. `scopedDb` KHÔNG che write (CLAUDE.md #5) nên Server Action phải tự hỏi
// "người này được ghi cho chủ sở hữu nào". Chính sách của Hội sở (centerId NULL) đọc được ở mọi cơ sở (NULL_IS_GLOBAL) —
// nhưng ĐỌC được không có nghĩa SỬA được: một người chỉ thấy CS1 mà sửa chính sách Hội sở là sửa tiền của mọi cơ sở.
import { describe, expect, it } from "vitest";
import { coTheGhiChoChuSoHuu } from "./chinh-sach-quyen";

describe("[NHH-FE-PV-01] coTheGhiChoChuSoHuu", () => {
  it("tầm nhìn ALL (Hội sở / quản trị) ghi được cả Hội sở lẫn mọi cơ sở", () => {
    expect(coTheGhiChoChuSoHuu("ALL", null)).toBe(true);
    expect(coTheGhiChoChuSoHuu("ALL", "cs1")).toBe(true);
  });

  it("người chỉ thấy CS1: ghi được chính sách của CS1, KHÔNG ghi được của Hội sở hay CS2", () => {
    expect(coTheGhiChoChuSoHuu(["cs1"], "cs1")).toBe(true);
    expect(coTheGhiChoChuSoHuu(["cs1"], null)).toBe(false);
    expect(coTheGhiChoChuSoHuu(["cs1"], "cs2")).toBe(false);
  });

  it("tầm nhìn rỗng (fail-closed) không ghi được gì", () => {
    expect(coTheGhiChoChuSoHuu([], null)).toBe(false);
    expect(coTheGhiChoChuSoHuu([], "cs1")).toBe(false);
  });
});
