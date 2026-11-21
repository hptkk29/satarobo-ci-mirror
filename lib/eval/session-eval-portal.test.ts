// FL4-02 — lib/eval/session-eval-portal PURE: renderAnswers map đáp án → khối hiển thị.
import { describe, it, expect } from "vitest";
import { renderAnswers, type QuestionMeta } from "@/lib/eval/session-eval-portal";
import type { SubmittedAnswer } from "@/lib/eval/schema";

function meta(entries: Array<[string, QuestionMeta]>): Map<string, QuestionMeta> {
  return new Map(entries);
}

const QM = meta([
  ["q1", { label: "Mức độ tập trung", type: "STAR_RATING", order: 0 }],
  ["q2", { label: "Thái độ", type: "RADIO", order: 1 }],
  ["q3", { label: "Kỹ năng đạt được", type: "CHECKBOX", order: 2 }],
  ["q4", { label: "Nhận xét thêm", type: "TEXTBOX", order: 3 }],
]);

describe("[FL4-02] renderAnswers", () => {
  it("render đúng từng loại câu hỏi (sao / radio / checkbox / tự luận)", () => {
    const answers: SubmittedAnswer[] = [
      { questionId: "q1", valueNumber: 4 },
      { questionId: "q2", valueOptions: ["Tích cực"] },
      { questionId: "q3", valueOptions: ["Lắp ráp", "Lập trình"] },
      { questionId: "q4", valueText: "Con tiến bộ rõ" },
    ];
    const out = renderAnswers(QM, answers);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ type: "STAR_RATING", stars: 4, options: null, text: null });
    expect(out[1]).toMatchObject({ type: "RADIO", options: ["Tích cực"], stars: null });
    expect(out[2]).toMatchObject({ type: "CHECKBOX", options: ["Lắp ráp", "Lập trình"] });
    expect(out[3]).toMatchObject({ type: "TEXTBOX", text: "Con tiến bộ rõ" });
  });

  it("sắp theo thứ tự câu hỏi (order) bất kể thứ tự đáp án", () => {
    const answers: SubmittedAnswer[] = [
      { questionId: "q4", valueText: "abc" },
      { questionId: "q1", valueNumber: 5 },
    ];
    const out = renderAnswers(QM, answers);
    expect(out.map((a) => a.questionId)).toEqual(["q1", "q4"]);
  });

  it("bỏ câu chưa trả lời (null / rỗng / text khoảng trắng)", () => {
    const answers: SubmittedAnswer[] = [
      { questionId: "q1", valueNumber: null },
      { questionId: "q2", valueOptions: [] },
      { questionId: "q4", valueText: "   " },
    ];
    expect(renderAnswers(QM, answers)).toHaveLength(0);
  });

  it("bỏ đáp án không khớp câu hỏi nào (câu đã xóa)", () => {
    const answers: SubmittedAnswer[] = [
      { questionId: "ghost", valueText: "x" },
      { questionId: "q1", valueNumber: 3 },
    ];
    const out = renderAnswers(QM, answers);
    expect(out.map((a) => a.questionId)).toEqual(["q1"]);
  });

  it("trim text tự luận trước khi hiển thị", () => {
    const out = renderAnswers(QM, [{ questionId: "q4", valueText: "  ổn  " }]);
    expect(out[0]?.text).toBe("ổn");
  });
});
