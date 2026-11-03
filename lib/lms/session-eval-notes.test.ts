// Khoá luật R4 (21/08): 4 ô nhận xét gộp thành 1 ô "Đánh giá chung" — nhưng phiếu CŨ
// đã lưu trên prod ở dạng 4 mục vẫn phải đọc được. Không có migration nào chạy, nên hai
// dạng dữ liệu sống song song lâu dài và đây là chỗ chốt cách hiểu chúng.
import { describe, it, expect } from "vitest";
import {
  EVAL_OVERALL_MAX,
  evalNotesProse,
  normalizeEvalNotes,
  toOverallText,
} from "./session-eval-rubric";

describe("normalizeEvalNotes", () => {
  it("đọc được `overall` của phiếu mới", () => {
    expect(normalizeEvalNotes({ overall: "Con học tốt" }).overall).toBe("Con học tốt");
  });

  it("phiếu cũ (không có khoá overall) → overall là chuỗi rỗng, 4 mục giữ nguyên", () => {
    const n = normalizeEvalNotes({ knowledge: "Nắm chắc bài", skill: "Lắp nhanh" });
    expect(n.overall).toBe("");
    expect(n.knowledge).toBe("Nắm chắc bài");
    expect(n.proposal).toBe("");
  });

  it("Json hỏng / sai kiểu → 5 chuỗi rỗng, không throw", () => {
    expect(normalizeEvalNotes(null)).toEqual({
      overall: "",
      knowledge: "",
      skill: "",
      attitude: "",
      proposal: "",
    });
    expect(normalizeEvalNotes({ overall: 42 }).overall).toBe("");
  });
});

describe("evalNotesProse — MỘT cửa đọc văn xuôi cho cả 2 dạng phiếu", () => {
  it("phiếu mới → nhánh overall", () => {
    const p = evalNotesProse(normalizeEvalNotes({ overall: "Nhận xét chung" }));
    expect(p).toEqual({ kind: "overall", text: "Nhận xét chung" });
  });

  it("phiếu cũ → nhánh legacy, BỎ mục trống, giữ đúng thứ tự KT-KN-TĐ-ĐX", () => {
    const p = evalNotesProse(
      normalizeEvalNotes({ knowledge: "A", skill: "", attitude: "C", proposal: "D" }),
    );
    expect(p?.kind).toBe("legacy");
    if (p?.kind !== "legacy") throw new Error("sai nhánh");
    expect(p.rows.map((r) => r.key)).toEqual(["knowledge", "attitude", "proposal"]);
    expect(p.rows[0].label).toBe("Kiến thức");
  });

  it("phiếu vừa được viết lại: CÓ overall thì overall THẮNG, không in hai bản nội dung", () => {
    const p = evalNotesProse(
      normalizeEvalNotes({ overall: "Bản mới", knowledge: "Bản cũ còn sót" }),
    );
    expect(p).toEqual({ kind: "overall", text: "Bản mới" });
  });

  it("phiếu chỉ có rubric (không văn xuôi) → null, để chỗ gọi hiện đúng thông báo", () => {
    expect(evalNotesProse(normalizeEvalNotes({}))).toBeNull();
    expect(evalNotesProse(null)).toBeNull();
  });
});

describe("toOverallText — mồi ô nhập khi GV mở lại phiếu", () => {
  it("phiếu mới → trả thẳng overall", () => {
    expect(toOverallText(normalizeEvalNotes({ overall: "Đã viết rồi" }))).toBe("Đã viết rồi");
  });

  it("phiếu cũ → GHÉP 4 mục kèm nhãn, mỗi mục một dòng (không mất chữ)", () => {
    expect(
      toOverallText(
        normalizeEvalNotes({ knowledge: "A", skill: "B", attitude: "", proposal: "D" }),
      ),
    ).toBe("Kiến thức: A\nKỹ năng: B\nĐề xuất: D");
  });

  it("phiếu rubric-only / null → chuỗi rỗng", () => {
    expect(toOverallText(normalizeEvalNotes({}))).toBe("");
    expect(toOverallText(null)).toBe("");
  });

  it("KHÔNG cắt bớt khi phiếu cũ dài hơn trần 2000 — hộp thoại chặn Lưu để GV tự rút gọn", () => {
    const dai = "x".repeat(1500);
    const out = toOverallText(normalizeEvalNotes({ knowledge: dai, skill: dai }));
    expect(out.length).toBeGreaterThan(EVAL_OVERALL_MAX);
  });
});
