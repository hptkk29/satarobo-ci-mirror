// R7-16 — lib/eval pure logic: enum đóng, validate, eligibility, aggregate, round-open.
import { describe, it, expect } from "vitest";
import {
  QUESTION_TYPES,
  evalQuestionInputSchema,
  evalFormInputSchema,
  validateAnswers,
  TEXTBOX_MAX,
  type QuestionDef,
} from "@/lib/eval/forms";
import {
  filterEligibleTeacherEvals,
  isParentEligibleForCenter,
  type EnrollmentForEval,
} from "@/lib/eval/eligibility";
import { aggregateAnswers, type QuestionMeta } from "@/lib/eval/aggregate";
import { isRoundOpen } from "@/lib/eval/rounds";

// ─── AC1/AC2 — ENUM ĐÓNG (không loại thứ 5) ─────────────────────────────────
describe("[R7-16] question type enum đóng", () => {
  it("đúng 5 loại (gồm PHOTO — FL4 R5)", () => {
    expect([...QUESTION_TYPES].sort()).toEqual(["CHECKBOX", "PHOTO", "RADIO", "STAR_RATING", "TEXTBOX"]);
  });

  it("reject loại thứ 5 (vd DROPDOWN/SLIDER)", () => {
    const bad = evalQuestionInputSchema.safeParse({ type: "DROPDOWN", label: "x", required: false });
    expect(bad.success).toBe(false);
  });

  it("RADIO/CHECKBOX cần ≥2 options", () => {
    expect(evalQuestionInputSchema.safeParse({ type: "RADIO", label: "x", options: ["a"], required: true }).success).toBe(false);
    expect(evalQuestionInputSchema.safeParse({ type: "CHECKBOX", label: "x", options: ["a", "b"], required: true }).success).toBe(true);
  });

  it("form schema chấp nhận 4 loại trong 1 form", () => {
    const ok = evalFormInputSchema.safeParse({
      title: "Đánh giá GV",
      scope: "TEACHER_EVAL",
      questions: [
        { type: "STAR_RATING", label: "Thầy dạy dễ hiểu?", required: true },
        { type: "RADIO", label: "Mức độ?", options: ["Tốt", "Khá"], required: true },
        { type: "CHECKBOX", label: "Điểm mạnh?", options: ["Vui", "Tận tâm"], required: false },
        { type: "TEXTBOX", label: "Góp ý", required: false },
      ],
    });
    expect(ok.success).toBe(true);
  });
});

// ─── AC8 — validate đáp án ───────────────────────────────────────────────────
const QS: QuestionDef[] = [
  { id: "star", type: "STAR_RATING", label: "Sao", options: null, required: true },
  { id: "radio", type: "RADIO", label: "Radio", options: ["A", "B"], required: true },
  { id: "check", type: "CHECKBOX", label: "Check", options: ["X", "Y", "Z"], required: true },
  { id: "text", type: "TEXTBOX", label: "Text", options: null, required: false },
];

describe("[R7-16] validateAnswers", () => {
  it("happy path → normalized", () => {
    const r = validateAnswers(QS, [
      { questionId: "star", valueNumber: 5 },
      { questionId: "radio", valueOptions: ["A"] },
      { questionId: "check", valueOptions: ["X", "Z"] },
      { questionId: "text", valueText: "tốt" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.find((a) => a.questionId === "star")?.valueNumber).toBe(5);
      expect(r.normalized.find((a) => a.questionId === "check")?.valueOptions).toEqual(["X", "Z"]);
    }
  });

  it("required bỏ trống → reject đúng field", () => {
    const r = validateAnswers(QS, [{ questionId: "radio", valueOptions: ["A"] }, { questionId: "check", valueOptions: ["X"] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.questionId).toBe("star");
  });

  it("checkbox 0 lựa chọn nhưng required → reject", () => {
    const r = validateAnswers(QS, [
      { questionId: "star", valueNumber: 3 },
      { questionId: "radio", valueOptions: ["B"] },
      { questionId: "check", valueOptions: [] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.questionId).toBe("check");
  });

  it("textbox > 2000 ký tự → reject", () => {
    const r = validateAnswers(QS, [
      { questionId: "star", valueNumber: 4 },
      { questionId: "radio", valueOptions: ["A"] },
      { questionId: "check", valueOptions: ["Y"] },
      { questionId: "text", valueText: "x".repeat(TEXTBOX_MAX + 1) },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.questionId).toBe("text");
  });

  it("sao ngoài 1–5 → reject; radio đáp án lạ → reject", () => {
    expect(validateAnswers(QS, [{ questionId: "star", valueNumber: 7 }]).ok).toBe(false);
    expect(
      validateAnswers(QS, [
        { questionId: "star", valueNumber: 3 },
        { questionId: "radio", valueOptions: ["ZZZ"] },
        { questionId: "check", valueOptions: ["X"] },
      ]).ok,
    ).toBe(false);
  });
});

// ─── AC3 — eligibility GV ─────────────────────────────────────────────────────
const enr = (over: Partial<EnrollmentForEval>): EnrollmentForEval => ({
  enrollmentId: "e1",
  status: "STUDYING",
  courseId: "c1",
  className: "Sata 3 A",
  classCenterId: "cs1",
  teacherId: "t1",
  teacherName: "Cô A",
  assistantId: null,
  assistantName: null,
  ...over,
});

describe("[R7-16] filterEligibleTeacherEvals", () => {
  it("chỉ GV của lớp đã/đang học; lọc theo khóa của đợt", () => {
    const out = filterEligibleTeacherEvals(
      [enr({}), enr({ enrollmentId: "e2", courseId: "OTHER", teacherId: "t2" })],
      { scope: "TEACHER_EVAL", centerId: null, courseId: "c1" },
    );
    expect(out.map((o) => o.teacherId)).toEqual(["t1"]);
  });

  it("status không hợp lệ (PENDING/WITHDREW) → loại", () => {
    const out = filterEligibleTeacherEvals(
      [enr({ status: "PENDING" }), enr({ enrollmentId: "e2", status: "WITHDREW", teacherId: "t9" })],
      { scope: "TEACHER_EVAL", centerId: null, courseId: null },
    );
    expect(out).toHaveLength(0);
  });

  it("đổi GV giữa kỳ (2 enrollment cùng HV) → đánh giá được cả 2 (mỗi GV 1 entry)", () => {
    const out = filterEligibleTeacherEvals(
      [enr({ enrollmentId: "e1", teacherId: "t1" }), enr({ enrollmentId: "e2", teacherId: "t2" })],
      { scope: "TEACHER_EVAL", centerId: null, courseId: null },
    );
    expect(out).toHaveLength(2);
  });

  it("GV chính + trợ giảng cùng lớp → 2 entry; không nhân đôi cùng người", () => {
    const out = filterEligibleTeacherEvals(
      [enr({ teacherId: "t1", assistantId: "t1" })], // cùng người → 1 entry
      { scope: "TEACHER_EVAL", centerId: null, courseId: null },
    );
    expect(out).toHaveLength(1);
    const out2 = filterEligibleTeacherEvals(
      [enr({ teacherId: "t1", assistantId: "ta1", assistantName: "Trợ giảng" })],
      { scope: "TEACHER_EVAL", centerId: null, courseId: null },
    );
    expect(out2).toHaveLength(2);
  });

  it("lọc theo cơ sở của đợt", () => {
    const out = filterEligibleTeacherEvals(
      [enr({ classCenterId: "cs2" })],
      { scope: "TEACHER_EVAL", centerId: "cs1", courseId: null },
    );
    expect(out).toHaveLength(0);
  });
});

// ─── AC5 — eligibility PH khảo sát cơ sở ──────────────────────────────────────
describe("[R7-16] isParentEligibleForCenter", () => {
  it("có con đang học đúng cơ sở → eligible", () => {
    expect(isParentEligibleForCenter([{ status: "STUDYING", classCenterId: "cs1" }], "cs1")).toBe(true);
  });
  it("con học cơ sở khác → không eligible (PH cơ sở khác không thấy)", () => {
    expect(isParentEligibleForCenter([{ status: "STUDYING", classCenterId: "cs2" }], "cs1")).toBe(false);
  });
  it("con đã COMPLETED (không còn đang học) → không eligible cho khảo sát hiện hành", () => {
    expect(isParentEligibleForCenter([{ status: "COMPLETED", classCenterId: "cs1" }], "cs1")).toBe(false);
  });
});

// ─── AC6 — aggregate ──────────────────────────────────────────────────────────
const QMETA: QuestionMeta[] = [
  { id: "star", type: "STAR_RATING", label: "Sao", options: null, order: 0 },
  { id: "radio", type: "RADIO", label: "Radio", options: ["A", "B"], order: 1 },
  { id: "text", type: "TEXTBOX", label: "Text", options: null, order: 2 },
];

describe("[R7-16] aggregateAnswers (ẩn danh)", () => {
  it("avg sao + phân bố + đếm option + list text", () => {
    const agg = aggregateAnswers(
      QMETA,
      [
        { questionId: "star", valueNumber: 5, valueOptions: null, valueText: null },
        { questionId: "star", valueNumber: 3, valueOptions: null, valueText: null },
        { questionId: "radio", valueNumber: null, valueOptions: ["A"], valueText: null },
        { questionId: "radio", valueNumber: null, valueOptions: ["A"], valueText: null },
        { questionId: "text", valueNumber: null, valueOptions: null, valueText: "hay" },
      ],
      3,
    );
    const star = agg.questions[0];
    expect(star.type).toBe("STAR_RATING");
    if (star.type === "STAR_RATING") {
      expect(star.avg).toBe(4);
      expect(star.distribution[5]).toBe(1);
      expect(star.distribution[3]).toBe(1);
    }
    const radio = agg.questions[1];
    if (radio.type === "RADIO") {
      expect(radio.optionCounts.find((o) => o.option === "A")?.count).toBe(2);
    }
    const text = agg.questions[2];
    if (text.type === "TEXTBOX") expect(text.texts).toEqual(["hay"]);
  });
});

// ─── Round open window ─────────────────────────────────────────────────────────
describe("[R7-16] isRoundOpen", () => {
  const now = new Date("2026-06-16T10:00:00Z");
  it("OPEN trong khoảng → mở", () => {
    expect(isRoundOpen({ status: "OPEN", opensAt: null, closesAt: null }, now)).toBe(true);
  });
  it("DRAFT/CLOSED → đóng", () => {
    expect(isRoundOpen({ status: "DRAFT", opensAt: null, closesAt: null }, now)).toBe(false);
    expect(isRoundOpen({ status: "CLOSED", opensAt: null, closesAt: null }, now)).toBe(false);
  });
  it("OPEN nhưng ngoài cửa sổ thời gian → đóng (round đóng giữa lúc điền)", () => {
    expect(isRoundOpen({ status: "OPEN", opensAt: null, closesAt: new Date("2026-06-16T09:00:00Z") }, now)).toBe(false);
    expect(isRoundOpen({ status: "OPEN", opensAt: new Date("2026-06-16T11:00:00Z"), closesAt: null }, now)).toBe(false);
  });
});
