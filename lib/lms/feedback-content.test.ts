import { describe, it, expect } from "vitest";
import { feedbackHasContent, isBlankFeedbackInput } from "./feedback-content";

// Hồi quy 19/08/2026 — hai đường ghi khác nhau vào cùng bảng StudentSessionFeedback:
//   saveSessionEvalCore     → notes + rubric (+ projectName)
//   saveSessionFeedbackCore → comment + rating
// Mỗi màn tự viết điều kiện riêng đã làm phiếu loại thứ hai bị coi là "không có phiếu".

describe("feedbackHasContent", () => {
  it("phiếu rubric-only (GV chỉ chấm bảng năng lực) là CÓ nội dung", () => {
    expect(feedbackHasContent({ notes: null, rubric: { c1: 4 }, comment: null, rating: null })).toBe(
      true,
    );
  });

  it("phiếu comment-only (/teacher/nhan-xet) là CÓ nội dung — trước đây bị PDF trả 404", () => {
    expect(feedbackHasContent({ notes: null, rubric: null, comment: "Em tiến bộ", rating: null })).toBe(
      true,
    );
  });

  it("phiếu chỉ có SAO cũng là CÓ nội dung", () => {
    expect(feedbackHasContent({ notes: null, rubric: null, comment: null, rating: 4 })).toBe(true);
  });

  it("phiếu 4 mục văn xuôi là CÓ nội dung", () => {
    expect(
      feedbackHasContent({ notes: { knowledge: "ok" }, rubric: null, comment: null, rating: null }),
    ).toBe(true);
  });

  it("comment chỉ toàn khoảng trắng KHÔNG tính là nội dung", () => {
    expect(feedbackHasContent({ notes: null, rubric: null, comment: "   ", rating: null })).toBe(
      false,
    );
  });

  it("phiếu trống hoàn toàn / không có phiếu → false", () => {
    expect(feedbackHasContent({ notes: null, rubric: null, comment: null, rating: null })).toBe(false);
    expect(feedbackHasContent(null)).toBe(false);
    expect(feedbackHasContent(undefined)).toBe(false);
  });
});

describe("isBlankFeedbackInput", () => {
  it("không chữ + không sao = dòng rỗng (ý định XOÁ nhận xét)", () => {
    expect(isBlankFeedbackInput("", null)).toBe(true);
    expect(isBlankFeedbackInput("   ", null)).toBe(true);
  });

  it("CÓ sao mà không chữ thì KHÔNG rỗng — đây chính là ca từng nuốt mất số sao", () => {
    expect(isBlankFeedbackInput("", 5)).toBe(false);
    expect(isBlankFeedbackInput("   ", 1)).toBe(false);
  });

  it("có chữ thì không rỗng", () => {
    expect(isBlankFeedbackInput("Tốt", null)).toBe(false);
  });
});
