// #03 — lõi thuần của portalDb: điều-kiện-sở-hữu + hậu-kiểm findUnique. Không DB.
import { describe, it, expect } from "vitest";
import { portalPassesOwnership, portalWhereFor, type PortalOwner } from "@/lib/portal/db";

const owner: PortalOwner = { parentUserId: "parent-a", childIds: ["hs-1", "hs-2"] };

describe("portalWhereFor — điều kiện sở hữu theo model", () => {
  it("Student neo parentUserId (không phụ thuộc childIds)", () => {
    expect(portalWhereFor("Student", owner)).toEqual({ parentUserId: "parent-a" });
  });

  it("model studentId trực tiếp → IN childIds", () => {
    for (const m of ["Enrollment", "Attendance", "ExamAttempt", "AssignmentSubmission", "ParentRequest", "StudentConsent", "MakeupNeed"]) {
      expect(portalWhereFor(m, owner)).toEqual({ studentId: { in: ["hs-1", "hs-2"] } });
    }
  });

  it("SurveyResponse/EvalResponse: studentId HOẶC parentUserId (CENTER_SURVEY response có studentId null)", () => {
    expect(portalWhereFor("SurveyResponse", owner)).toEqual({
      OR: [{ studentId: { in: ["hs-1", "hs-2"] } }, { parentUserId: "parent-a" }],
    });
  });

  it("ConversationMessage đi qua relation enrollment (FK thật)", () => {
    expect(portalWhereFor("ConversationMessage", owner)).toEqual({
      enrollment: { studentId: { in: ["hs-1", "hs-2"] } },
    });
  });

  it("model không có đường sở hữu → null (pass-through, guard tay lo)", () => {
    for (const m of ["Exam", "Assignment", "ExamQuestion", "ExamAnswer", "Survey", "EvaluationRound", "User", "Class", "ClassSessionMedia"]) {
      expect(portalWhereFor(m, owner)).toBeNull();
    }
  });

  it("childIds rỗng → deny-all cho model trực tiếp (fail-safe), Student vẫn theo parentUserId", () => {
    const empty: PortalOwner = { parentUserId: "parent-a", childIds: [] };
    expect(portalWhereFor("Enrollment", empty)).toEqual({ studentId: { in: [] } });
    expect(portalWhereFor("Student", empty)).toEqual({ parentUserId: "parent-a" });
  });
});

describe("portalPassesOwnership — hậu-kiểm findUnique", () => {
  it("record null → false", () => {
    expect(portalPassesOwnership("Enrollment", null, owner)).toBe(false);
  });

  it("studentId thuộc con mình → true; con người khác → false; thiếu field → false (fail-safe)", () => {
    expect(portalPassesOwnership("Enrollment", { studentId: "hs-1" }, owner)).toBe(true);
    expect(portalPassesOwnership("Enrollment", { studentId: "hs-cua-nguoi-khac" }, owner)).toBe(false);
    expect(portalPassesOwnership("Enrollment", {}, owner)).toBe(false);
  });

  it("Student check parentUserId trên chính record", () => {
    expect(portalPassesOwnership("Student", { parentUserId: "parent-a" }, owner)).toBe(true);
    expect(portalPassesOwnership("Student", { parentUserId: "parent-b" }, owner)).toBe(false);
  });

  it("SurveyResponse: đậu bằng 1 trong 2 đường", () => {
    expect(portalPassesOwnership("SurveyResponse", { studentId: "hs-2", parentUserId: null }, owner)).toBe(true);
    expect(portalPassesOwnership("SurveyResponse", { studentId: null, parentUserId: "parent-a" }, owner)).toBe(true);
    expect(portalPassesOwnership("SurveyResponse", { studentId: null, parentUserId: "parent-b" }, owner)).toBe(false);
  });

  it("model không map / via-enrollment → 'unknown' (pass-through có chủ đích, KHÔNG phải true)", () => {
    expect(portalPassesOwnership("Exam", { studentId: "hs-1" }, owner)).toBe("unknown");
    expect(portalPassesOwnership("ConversationMessage", {}, owner)).toBe("unknown");
  });
});
