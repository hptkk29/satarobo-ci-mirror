// FL4-01 — lib/eval/session-eval PURE logic: áp đợt SESSION_EVAL cho buổi + dedupe key.
import { describe, it, expect } from "vitest";
import {
  isSessionEvalRoundApplicable,
  dedupeKeyForResponse,
  type SessionEvalRoundScope,
  type SessionClassScope,
} from "@/lib/eval/session-eval";
import { validateAnswers, type QuestionDef } from "@/lib/eval/schema";

const NOW = new Date("2026-06-24T10:00:00Z");

function round(over: Partial<SessionEvalRoundScope>): SessionEvalRoundScope {
  return {
    scope: "SESSION_EVAL",
    status: "OPEN",
    opensAt: null,
    closesAt: null,
    centerId: null,
    courseId: null,
    ...over,
  };
}

const CLS: SessionClassScope = { centerId: "cs1", courseId: "course-sata3" };

describe("[FL4-01] isSessionEvalRoundApplicable", () => {
  it("đợt toàn hệ thống (không cơ sở/khóa) áp cho mọi lớp — cả lớp chính lẫn trải nghiệm", () => {
    expect(isSessionEvalRoundApplicable(round({}), CLS, NOW)).toBe(true);
    // lớp trải nghiệm (center/course khác/null) vẫn áp khi đợt global
    expect(isSessionEvalRoundApplicable(round({}), { centerId: "cs2", courseId: "trial" }, NOW)).toBe(true);
  });

  it("đợt gắn cơ sở: chỉ áp lớp đúng cơ sở", () => {
    expect(isSessionEvalRoundApplicable(round({ centerId: "cs1" }), CLS, NOW)).toBe(true);
    expect(isSessionEvalRoundApplicable(round({ centerId: "cs2" }), CLS, NOW)).toBe(false);
  });

  it("đợt gắn khóa: chỉ áp lớp đúng khóa", () => {
    expect(isSessionEvalRoundApplicable(round({ courseId: "course-sata3" }), CLS, NOW)).toBe(true);
    expect(isSessionEvalRoundApplicable(round({ courseId: "course-other" }), CLS, NOW)).toBe(false);
  });

  it("đợt gắn cả cơ sở + khóa: phải khớp cả hai", () => {
    expect(isSessionEvalRoundApplicable(round({ centerId: "cs1", courseId: "course-sata3" }), CLS, NOW)).toBe(true);
    expect(isSessionEvalRoundApplicable(round({ centerId: "cs1", courseId: "course-other" }), CLS, NOW)).toBe(false);
  });

  it("scope khác SESSION_EVAL → không áp", () => {
    expect(isSessionEvalRoundApplicable(round({ scope: "TEACHER_EVAL" }), CLS, NOW)).toBe(false);
    expect(isSessionEvalRoundApplicable(round({ scope: "CENTER_SURVEY" }), CLS, NOW)).toBe(false);
  });

  it("đợt DRAFT/CLOSED hoặc ngoài cửa sổ thời gian → không áp", () => {
    expect(isSessionEvalRoundApplicable(round({ status: "DRAFT" }), CLS, NOW)).toBe(false);
    expect(isSessionEvalRoundApplicable(round({ status: "CLOSED" }), CLS, NOW)).toBe(false);
    expect(
      isSessionEvalRoundApplicable(round({ closesAt: new Date("2026-06-24T09:00:00Z") }), CLS, NOW),
    ).toBe(false);
    expect(
      isSessionEvalRoundApplicable(round({ opensAt: new Date("2026-06-24T11:00:00Z") }), CLS, NOW),
    ).toBe(false);
  });
});

describe("[FL4-01] dedupeKeyForResponse — khóa idempotency round×buổi×HS", () => {
  it("ổn định + phân biệt theo từng chiều", () => {
    expect(dedupeKeyForResponse("r1", "s1", "hv1")).toBe("r1|s1|hv1");
    expect(dedupeKeyForResponse("r1", "s1", "hv1")).toBe(dedupeKeyForResponse("r1", "s1", "hv1"));
    expect(dedupeKeyForResponse("r1", "s1", "hv2")).not.toBe(dedupeKeyForResponse("r1", "s1", "hv1"));
  });
});

// Phiếu buổi học dùng RADIO cho "5 mức mô tả" + TEXTBOX tự luận → validate bằng
// chung engine validateAnswers (mỗi HS một bộ đáp án).
describe("[FL4-01] validate phiếu buổi (RADIO 5 mức + TEXTBOX) theo từng HS", () => {
  const QS: QuestionDef[] = [
    {
      id: "q-knowledge",
      type: "RADIO",
      label: "Kiến thức cũ",
      options: ["Xuất sắc", "Tốt", "Khá", "Trung bình", "Cần cố gắng"],
      required: true,
    },
    { id: "q-note", type: "TEXTBOX", label: "Nhận xét của giáo viên", options: null, required: false },
  ];

  it("chọn 1 trong 5 mức + ghi nhận xét → hợp lệ", () => {
    const r = validateAnswers(QS, [
      { questionId: "q-knowledge", valueOptions: ["Tốt"] },
      { questionId: "q-note", valueText: "Em tiếp thu nhanh." },
    ]);
    expect(r.ok).toBe(true);
  });

  it("bỏ trống mức bắt buộc → reject đúng câu", () => {
    const r = validateAnswers(QS, [{ questionId: "q-note", valueText: "x" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.questionId).toBe("q-knowledge");
  });

  it("chọn mức ngoài danh sách → reject", () => {
    const r = validateAnswers(QS, [{ questionId: "q-knowledge", valueOptions: ["Siêu cấp"] }]);
    expect(r.ok).toBe(false);
  });
});
