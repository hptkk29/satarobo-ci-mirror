import { describe, it, expect } from "vitest";
import {
  blankQuestion,
  cleanQuestion,
  countBlanks,
  isAutoGraded,
  validateQuestion,
  type ContentQuestion,
} from "./question-content";
import {
  deserializeQuestionRow,
  prepareQuestionsForSave,
  serializeContentQuestion,
  type QuestionRowForContent,
} from "./question-content-db";

/* ------------------------- helpers thuần (port từ source) ------------------ */

describe("countBlanks (điền khuyết — đếm ______)", () => {
  it("đếm mỗi cụm >=2 gạch dưới là một chỗ trống", () => {
    expect(countBlanks("HTML là ______ của ______")).toBe(2);
    expect(countBlanks("a __ b")).toBe(1); // 2 gạch
    expect(countBlanks("a _____________ b")).toBe(1); // 1 cụm dài = 1 chỗ
  });
  it("không có ______ vẫn trả tối thiểu 1", () => {
    expect(countBlanks("không có chỗ trống")).toBe(1);
  });
});

describe("isAutoGraded", () => {
  it("short/essay chấm tay, còn lại tự động", () => {
    expect(isAutoGraded("short")).toBe(false);
    expect(isAutoGraded("essay")).toBe(false);
    for (const t of ["single", "multiple", "boolean", "fill", "matching", "ordering"] as const) {
      expect(isAutoGraded(t)).toBe(true);
    }
  });
});

describe("validateQuestion + cleanQuestion", () => {
  it("single: báo lỗi khi đáp án đúng để trống", () => {
    const q: ContentQuestion = {
      id: "q1",
      type: "single",
      question: "1+1=?",
      options: ["", "2", "3", ""],
      correctIndex: 0,
    };
    expect(validateQuestion(q, 1)).toContain("đáp án đúng đang để trống");
  });

  it("single: clean bỏ ô trống và giữ đúng chỉ số đáp án", () => {
    const q: ContentQuestion = {
      id: "q1",
      type: "single",
      question: " 1+1=? ",
      options: ["", "2", "3", ""],
      correctIndex: 2, // "3"
    };
    const c = cleanQuestion(q);
    expect(c).toMatchObject({ question: "1+1=?", options: ["2", "3"] });
    if (c.type === "single") expect(c.options[c.correctIndex]).toBe("3");
  });

  it("multiple: clean ánh xạ lại correctIndices sau khi bỏ ô trống", () => {
    const q: ContentQuestion = {
      id: "q2",
      type: "multiple",
      question: "Chọn số chẵn",
      options: ["1", "", "2", "4"],
      correctIndices: [2, 3],
    };
    const c = cleanQuestion(q);
    if (c.type === "multiple") {
      expect(c.options).toEqual(["1", "2", "4"]);
      expect(c.correctIndices).toEqual([1, 2]);
    }
  });

  it("fill: số đáp án bám theo số chỗ trống trong đề", () => {
    const q: ContentQuestion = {
      id: "q3",
      type: "fill",
      question: "A là ______, B là ______",
      answers: ["x"],
    };
    expect(validateQuestion(q, 3)).toContain("chỗ trống 2");
    const c = cleanQuestion({ ...q, answers: ["x", "y", "thừa"] });
    if (c.type === "fill") expect(c.answers).toEqual(["x", "y"]);
  });

  it("matching/ordering: cần tối thiểu 2 mục hoàn chỉnh", () => {
    const m: ContentQuestion = {
      id: "q4",
      type: "matching",
      question: "Ghép",
      pairs: [
        { left: "a", right: "1" },
        { left: "", right: "2" },
      ],
    };
    expect(validateQuestion(m, 4)).toContain("2 cặp ghép");
    const o: ContentQuestion = {
      id: "q5",
      type: "ordering",
      question: "Sắp xếp",
      items: ["một", ""],
    };
    expect(validateQuestion(o, 5)).toContain("2 mục");
  });

  it("blankQuestion sinh giá trị mặc định hợp lệ theo loại", () => {
    const b = blankQuestion("matching", "id1");
    expect(b.type).toBe("matching");
    if (b.type === "matching") expect(b.pairs).toHaveLength(2);
  });
});

/* --------------------------- serialize → DB rows --------------------------- */

describe("serializeContentQuestion (ContentQuestion → hàng Question)", () => {
  it("single → MULTIPLE_CHOICE + meta.ui=single + đúng 1 isCorrect", () => {
    const s = serializeContentQuestion({
      id: "q",
      type: "single",
      question: "1+1=?",
      options: ["1", "2"],
      correctIndex: 1,
    });
    expect(s.type).toBe("MULTIPLE_CHOICE");
    expect(s.meta).toEqual({ ui: "single" });
    expect(s.choices).toEqual([
      { order: 1, text: "1", isCorrect: false },
      { order: 2, text: "2", isCorrect: true },
    ]);
  });

  it("boolean → TRUE_FALSE với 2 choices Đúng/Sai theo quy ước admin", () => {
    const s = serializeContentQuestion({
      id: "q",
      type: "boolean",
      question: "Robot biết bay?",
      correct: false,
    });
    expect(s.type).toBe("TRUE_FALSE");
    expect(s.choices).toEqual([
      { order: 1, text: "Đúng", isCorrect: false },
      { order: 2, text: "Sai", isCorrect: true },
    ]);
  });

  it("fill → FILL_BLANK, meta.answers là nguồn sự thật, correctAnswer join để màn cũ đọc", () => {
    const s = serializeContentQuestion({
      id: "q",
      type: "fill",
      question: "HTML là ______",
      answers: ["HyperText Markup Language"],
    });
    expect(s.type).toBe("FILL_BLANK");
    expect(s.meta).toEqual({ answers: ["HyperText Markup Language"] });
    expect(s.correctAnswer).toBe("HyperText Markup Language");
  });

  it("matching/ordering → meta pairs/items, không choices", () => {
    const m = serializeContentQuestion({
      id: "q",
      type: "matching",
      question: "Ghép",
      pairs: [
        { left: "a", right: "1" },
        { left: "b", right: "2" },
      ],
    });
    expect(m.type).toBe("MATCHING");
    expect(m.choices).toHaveLength(0);
    const o = serializeContentQuestion({
      id: "q",
      type: "ordering",
      question: "Sắp",
      items: ["x", "y"],
    });
    expect(o.type).toBe("ORDERING");
    expect(o.meta).toEqual({ items: ["x", "y"] });
  });
});

/* ----------------------------- round-trip 8 loại --------------------------- */

const roundTrip = (q: ContentQuestion): ContentQuestion => {
  const s = serializeContentQuestion(q);
  const row: QuestionRowForContent = {
    id: q.id,
    type: s.type,
    text: s.text,
    correctAnswer: s.correctAnswer,
    meta: s.meta ?? null,
    choices: s.choices,
  };
  return deserializeQuestionRow(row);
};

describe("round-trip serialize → deserialize giữ nguyên nội dung", () => {
  const cases: ContentQuestion[] = [
    { id: "a", type: "single", question: "1+1?", options: ["1", "2", "3"], correctIndex: 1 },
    {
      id: "b",
      type: "multiple",
      question: "Số chẵn?",
      options: ["1", "2", "4"],
      correctIndices: [1, 2],
    },
    { id: "c", type: "boolean", question: "Đúng không?", correct: true },
    { id: "d", type: "fill", question: "A là ______ và ______", answers: ["x", "y"] },
    { id: "e", type: "short", question: "AI là gì?", sampleAnswer: "Trí tuệ nhân tạo" },
    { id: "f", type: "essay", question: "Trình bày...", sampleAnswer: undefined },
    {
      id: "g",
      type: "matching",
      question: "Ghép",
      pairs: [
        { left: "a", right: "1" },
        { left: "b", right: "2" },
      ],
    },
    { id: "h", type: "ordering", question: "Sắp xếp", items: ["b1", "b2", "b3"] },
  ];

  for (const q of cases) {
    it(`giữ nguyên loại ${q.type}`, () => {
      expect(roundTrip(q)).toEqual(q);
    });
  }

  it("multiple với ĐÚNG 1 đáp án đúng vẫn giữ multiple nhờ meta.ui", () => {
    const q: ContentQuestion = {
      id: "m1",
      type: "multiple",
      question: "Chọn nhiều nhưng chỉ 1 đúng",
      options: ["a", "b"],
      correctIndices: [0],
    };
    expect(roundTrip(q).type).toBe("multiple");
  });
});

/* ------------------------ đọc dữ liệu CŨ (trước parity) -------------------- */

describe("deserializeQuestionRow — hàng cũ không meta", () => {
  it("MULTIPLE_CHOICE cũ 1 đáp án đúng → single", () => {
    const q = deserializeQuestionRow({
      id: "old1",
      type: "MULTIPLE_CHOICE",
      text: "Cũ",
      correctAnswer: null,
      meta: null,
      choices: [
        { order: 1, text: "a", isCorrect: false },
        { order: 2, text: "b", isCorrect: true },
      ],
    });
    expect(q).toMatchObject({ type: "single", correctIndex: 1 });
  });

  it("MULTIPLE_CHOICE cũ nhiều đáp án đúng → multiple", () => {
    const q = deserializeQuestionRow({
      id: "old2",
      type: "MULTIPLE_CHOICE",
      text: "Cũ",
      correctAnswer: null,
      meta: null,
      choices: [
        { order: 1, text: "a", isCorrect: true },
        { order: 2, text: "b", isCorrect: true },
      ],
    });
    expect(q).toMatchObject({ type: "multiple", correctIndices: [0, 1] });
  });

  it("TRUE_FALSE nhãn Đúng/Sai → boolean; nhãn lạ → single", () => {
    const bool = deserializeQuestionRow({
      id: "old3",
      type: "TRUE_FALSE",
      text: "Mệnh đề",
      correctAnswer: null,
      meta: null,
      choices: [
        { order: 1, text: "Đúng", isCorrect: true },
        { order: 2, text: "Sai", isCorrect: false },
      ],
    });
    expect(bool).toMatchObject({ type: "boolean", correct: true });

    const custom = deserializeQuestionRow({
      id: "old4",
      type: "TRUE_FALSE",
      text: "Mệnh đề",
      correctAnswer: null,
      meta: null,
      choices: [
        { order: 1, text: "Có thể", isCorrect: false },
        { order: 2, text: "Chưa chắc", isCorrect: true },
      ],
    });
    expect(custom).toMatchObject({ type: "single", correctIndex: 1 });
  });

  it("CODE cũ đọc như essay (không mất nội dung)", () => {
    const q = deserializeQuestionRow({
      id: "old5",
      type: "CODE",
      text: "Viết hàm",
      correctAnswer: "def f(): pass",
      meta: null,
      choices: [],
    });
    expect(q).toMatchObject({ type: "essay", sampleAnswer: "def f(): pass" });
  });

  it("MATCHING meta hỏng → đọc như essay để không vỡ UI", () => {
    const q = deserializeQuestionRow({
      id: "old6",
      type: "MATCHING",
      text: "Ghép",
      correctAnswer: null,
      meta: { pairs: "hỏng" },
      choices: [],
    });
    expect(q.type).toBe("essay");
  });
});

/* --------------------------- prepareQuestionsForSave ----------------------- */

describe("prepareQuestionsForSave (đường lưu server)", () => {
  it("từ chối mảng rỗng và câu hỏi sai shape", () => {
    expect(prepareQuestionsForSave([]).ok).toBe(false);
    expect(prepareQuestionsForSave([{ type: "single" }]).ok).toBe(false);
  });

  it("trả thông điệp VI khi nội dung thiếu (validate trước clean)", () => {
    const r = prepareQuestionsForSave([
      {
        id: "q1",
        type: "single",
        question: "1+1=?",
        options: ["", "2", "3"],
        correctIndex: 0, // đáp án đúng trống (vẫn đủ 2 đáp án có nội dung)
      },
    ]);
    expect(r).toEqual({ ok: false, error: "Câu 1: đáp án đúng đang để trống" });
  });

  it("clean + serialize trọn bộ khi hợp lệ", () => {
    const r = prepareQuestionsForSave([
      {
        id: "q1",
        type: "single",
        question: " 1+1=? ",
        options: ["2", "3", ""],
        correctIndex: 0,
      },
      { id: "q2", type: "boolean", question: "OK?", correct: true },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.questions).toHaveLength(2);
      expect(r.questions[0].text).toBe("1+1=?");
      expect(r.questions[0].choices).toHaveLength(2); // ô trống đã bị bỏ
    }
  });
});
