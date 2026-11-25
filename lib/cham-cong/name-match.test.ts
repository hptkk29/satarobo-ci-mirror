import { describe, expect, it } from "vitest";
import { callName, normalizeName, suggestCandidates, type NameCandidate } from "./name-match";

const C: NameCandidate[] = [
  { userId: "u-phuc", employeeId: "e1", fullName: "Hồ Đắc Phúc", userName: "Hồ Đắc Phúc", phone: null, centerCode: null },
  { userId: "u-khoi", employeeId: "e2", fullName: "Lê Khôi", userName: "Lê Khôi", phone: "0905000001", centerCode: "CS1" },
  { userId: "u-tramy", employeeId: "e3", fullName: "Hoàng Trà My", userName: null, phone: null, centerCode: "CS1" },
  { userId: "u-my2", employeeId: "e4", fullName: "Đinh Thảo My", userName: null, phone: null, centerCode: "CS2" },
  { userId: "u-lien", employeeId: "e5", fullName: "Lê Thị Phương Liên", userName: null, phone: null, centerCode: "CS2" },
];

describe("normalizeName / callName", () => {
  it("bỏ dấu, hoa thường, đ→d", () => {
    expect(normalizeName("  Hồ Đắc  Phúc ")).toBe("ho dac phuc");
    expect(normalizeName("Đinh Thảo My")).toBe("dinh thao my");
  });
  it("tên gọi", () => {
    expect(callName("Mr Phúc")).toBe("phuc");
    expect(callName("Cô Trà My")).toBe("tra my");
    expect(callName("Lê Khôi")).toBe("khoi");
    expect(callName("Ms Liên")).toBe("lien");
  });
});

describe("suggestCandidates", () => {
  it("họ tên đầy đủ trùng → điểm cao nhất, cùng cơ sở được cộng", () => {
    const s = suggestCandidates({ displayName: "Thầy Khôi", fullName: "Lê Khôi", unit: "CS1" }, C);
    expect(s[0]).toMatchObject({ userId: "u-khoi", score: 100 });
  });
  it("chỉ có tên hiển thị 'Mr Phúc' → gợi ý theo đuôi họ tên", () => {
    const s = suggestCandidates({ displayName: "Mr Phúc", fullName: "Mr Phúc", unit: "CS1" }, C);
    expect(s[0]).toMatchObject({ userId: "u-phuc" });
    expect(s[0].score).toBeGreaterThanOrEqual(60);
  });
  it("'Cô Trà My' không nhầm sang 'Đinh Thảo My' (tên gọi 2 chữ)", () => {
    const s = suggestCandidates({ displayName: "Cô Trà My", fullName: "Hoàng Trà My", unit: "CS1" }, C);
    expect(s[0].userId).toBe("u-tramy");
    expect(s.find((x) => x.userId === "u-my2")?.score ?? 0).toBeLessThan(s[0].score);
  });
  it("SĐT trùng thắng tất cả", () => {
    const s = suggestCandidates({ displayName: "Ai đó", fullName: "Ai đó", phone: "0905 000 001" }, C);
    expect(s[0]).toMatchObject({ userId: "u-khoi", score: 100, reason: "trùng SĐT" });
  });
  it("không khớp gì → rỗng, không ném", () => {
    expect(suggestCandidates({ displayName: "Mr Zed", fullName: "Mr Zed" }, C)).toEqual([]);
  });
});
