// FL4-03 — pure logic khảo sát trung tâm (CENTER_SURVEY) phía portal PH.
// Test pickEligibleCenterRounds: lọc đợt MỞ + cách ly cơ sở + chống trả lời trùng.
import { describe, it, expect } from "vitest";
import { pickEligibleCenterRounds, type CenterRoundForFilter } from "@/lib/eval/center-survey";

const NOW = new Date("2026-06-24T10:00:00Z");

function round(over: Partial<CenterRoundForFilter> = {}): CenterRoundForFilter {
  return {
    id: "r1",
    name: "Khảo sát cơ sở CS1",
    status: "OPEN",
    opensAt: null,
    closesAt: null,
    centerId: "cs1",
    form: {
      questions: [
        { id: "q1", type: "STAR_RATING", label: "Mức hài lòng?", options: null, required: true },
        { id: "q2", type: "CHECKBOX", label: "Điểm tốt?", options: ["GV", "Cơ sở vật chất"], required: false },
        { id: "q3", type: "RADIO", label: "Giới thiệu?", options: ["Có", "Không"], required: true },
        { id: "q4", type: "TEXTBOX", label: "Góp ý", options: null, required: false },
      ],
    },
    ...over,
  };
}

describe("[FL4-03] pickEligibleCenterRounds", () => {
  it("PH thuộc cơ sở → thấy đợt; map đủ 4 loại câu hỏi", () => {
    const out = pickEligibleCenterRounds([round()], new Set(["cs1"]), new Set(), NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.questions.map((q) => q.type)).toEqual([
      "STAR_RATING",
      "CHECKBOX",
      "RADIO",
      "TEXTBOX",
    ]);
    // options của RADIO/CHECKBOX parse từ Json → string[]
    expect(out[0]!.questions[1]!.options).toEqual(["GV", "Cơ sở vật chất"]);
  });

  it("cách ly cơ sở: PH cơ sở khác KHÔNG thấy đợt của cơ sở này", () => {
    const out = pickEligibleCenterRounds([round({ centerId: "cs1" })], new Set(["cs2"]), new Set(), NOW);
    expect(out).toHaveLength(0);
  });

  it("đợt toàn hệ thống (centerId=null): chỉ hiện khi PH có con đang học (khớp submit)", () => {
    // Không có con đang học (default hasStudyingChild = myCenterIds.size > 0) → ẩn,
    // vì isParentEligibleForCenter(null) sẽ từ chối lúc submit.
    const hidden = pickEligibleCenterRounds([round({ centerId: null })], new Set(), new Set(), NOW);
    expect(hidden).toHaveLength(0);
    // Có con đang học cơ sở bất kỳ → hiện.
    const shown = pickEligibleCenterRounds([round({ centerId: null })], new Set(["cs2"]), new Set(), NOW);
    expect(shown).toHaveLength(1);
    // Con học lớp chưa gắn cơ sở (myCenterIds rỗng) nhưng vẫn đang học → hiện.
    const noCenterClass = pickEligibleCenterRounds([round({ centerId: null })], new Set(), new Set(), NOW, true);
    expect(noCenterClass).toHaveLength(1);
  });

  it("đã trả lời → ẩn (chống trùng)", () => {
    const out = pickEligibleCenterRounds([round({ id: "rX" })], new Set(["cs1"]), new Set(["rX"]), NOW);
    expect(out).toHaveLength(0);
  });

  it("đợt chưa mở / đã đóng / DRAFT → ẩn", () => {
    const notYet = round({ id: "a", opensAt: new Date("2026-07-01T00:00:00Z") });
    const closed = round({ id: "b", closesAt: new Date("2026-06-01T00:00:00Z") });
    const draft = round({ id: "c", status: "DRAFT" });
    const out = pickEligibleCenterRounds([notYet, closed, draft], new Set(["cs1"]), new Set(), NOW);
    expect(out).toHaveLength(0);
  });
});
