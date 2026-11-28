import { describe, expect, it } from "vitest";
import { dongPhuDe, tomTatDe } from "./de-thi-hien";

describe("[DTH-01] dòng phụ của đề", () => {
  it("đếm câu · dạng KHÁC NHAU · câu chấm tay (SHORT_ANSWER/ESSAY)", () => {
    const t = tomTatDe(["SINGLE", "SINGLE", "MULTIPLE", "ESSAY", "SHORT_ANSWER"]);
    expect(t).toEqual({ soCau: 5, soDang: 4, soCauTay: 2 });
    expect(dongPhuDe(t)).toBe("5 câu · 4 dạng · 2 câu chấm tay");
  });
  it("🔴 không có câu chấm tay ⇒ KHÔNG nói '0 câu chấm tay'; đề rỗng nói đúng", () => {
    expect(dongPhuDe(tomTatDe(["SINGLE", "TRUE_FALSE"]))).toBe("2 câu · 2 dạng");
    expect(dongPhuDe(tomTatDe([]))).toBe("Chưa có câu nào");
  });
  it("NUMERIC do máy chấm, không tính là chấm tay", () => {
    expect(tomTatDe(["NUMERIC"]).soCauTay).toBe(0);
  });
});
