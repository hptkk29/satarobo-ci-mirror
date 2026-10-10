// @vitest-environment node
/**
 * EL-03 PR2 — LUẬT VALIDATOR. Chỉ những luật DB KHÔNG ép được.
 *
 * Mỗi case kiểm CẢ HAI: từ chối đúng chỗ, VÀ `field` trỏ đúng ô người dùng vừa
 * đổi. Vế thứ hai quan trọng ngang vế thứ nhất — một lỗi trỏ sai ô đẩy người ta
 * đi sửa nhầm rồi lỗi vẫn còn, và họ sẽ kết luận là hệ thống hỏng.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  trnProgramCreateSchema,
  trnCourseCreateSchema,
  trnLessonCreateSchema,
  trnRequirementCreateSchema,
  trnEvaluationResultCreateSchema,
  trnLessonCueCreateSchema,
  trnEvalLinkConfigSchema,
  TRN_PROGRAM_CODE_RE,
} from "@/lib/validators/elearning";

/** Lấy path của issue đầu tiên — đúng cái sẽ hiện lên ô nào trên form. */
function fields(r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (r.error?.issues ?? []).map((i) => String(i.path[0]));
}

const CHUONG_TRINH_OK = {
  code: "SR.DT.TEACHING.2026.1",
  year: 2026,
  seq: 1,
  title: "An toàn thông tin",
  primaryFunctionTag: "TEACHING",
  stageTag: "IN_SERVICE",
  durationTag: "S",
  natureTag: "RECOMMENDED",
  formatTag: "ELEARNING",
  ownerUserId: "u1",
  needExemptReason: "Chương trình mồi ngày mở",
};

const KHOA_OK = {
  code: "EL-SEED-001",
  slug: "an-toan-thong-tin",
  title: "An toàn thông tin",
};

describe("TrnProgram", () => {
  it("mã đúng khuôn SR.DT.[CN].[NĂM].[STT] thì qua", () => {
    expect(trnProgramCreateSchema.safeParse(CHUONG_TRINH_OK).success).toBe(true);
  });

  it("mã còn đoạn cấp bậc [CB] bị TỪ CHỐI — khuôn cũ đã bỏ (C6)", () => {
    // Giữ được mã cũ là giữ được đúng thứ §8.3 mâu thuẫn với §25: 4/6 khoá gắn
    // một DẢI cấp bậc trong khi khuôn mã chỉ mã hoá được MỘT.
    expect(TRN_PROGRAM_CODE_RE.test("SR.DT.L3.TEACHING.2026.1")).toBe(false);
    const r = trnProgramCreateSchema.safeParse({
      ...CHUONG_TRINH_OK,
      code: "SR.DT.L3.TEACHING.2026.1",
    });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("code");
  });

  it("không phiếu nhu cầu VÀ không lý do miễn ⇒ từ chối, trỏ needExemptReason", () => {
    const r = trnProgramCreateSchema.safeParse({
      ...CHUONG_TRINH_OK,
      needExemptReason: null,
    });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("needExemptReason");
  });

  it("có phiếu nhu cầu thì không cần lý do miễn", () => {
    const r = trnProgramCreateSchema.safeParse({
      ...CHUONG_TRINH_OK,
      needExemptReason: null,
      needId: "need-1",
    });
    expect(r.success).toBe(true);
  });

  it("MANDATORY_COMPLIANCE thiếu chu kỳ ⇒ từ chối, trỏ validityMonths", () => {
    const r = trnProgramCreateSchema.safeParse({
      ...CHUONG_TRINH_OK,
      natureTag: "MANDATORY_COMPLIANCE",
    });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("validityMonths");
  });

  it("levelTags không nhận L5 — L5 là GIAI ĐOẠN, nằm ở stageTag", () => {
    const r = trnProgramCreateSchema.safeParse({
      ...CHUONG_TRINH_OK,
      levelTags: ["L5"],
    });
    expect(r.success).toBe(false);
  });
});

describe("TrnCourse — bộ ba hiển thị danh mục", () => {
  it("không chọn gì ⇒ FAIL-CLOSED: ASSIGNED_ONLY + tự ghi danh tắt + không luật", () => {
    const r = trnCourseCreateSchema.safeParse(KHOA_OK);
    expect(r.success).toBe(true);
    expect(r.data?.visibility).toBe("ASSIGNED_ONLY");
    expect(r.data?.selfEnrollEnabled).toBe(false);
    expect(r.data?.catalogRuleJson).toBeNull();
  });

  it("RULE_BASED mà không có luật lọc ⇒ từ chối, trỏ catalogRuleJson", () => {
    const r = trnCourseCreateSchema.safeParse({
      ...KHOA_OK,
      visibility: "RULE_BASED",
    });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("catalogRuleJson");
  });

  it("ASSIGNED_ONLY + bật tự ghi danh ⇒ lỗi trỏ selfEnrollEnabled", () => {
    // Trỏ đúng ô người dùng vừa bật, KHÔNG trỏ `visibility` — họ vừa bật cái này.
    const r = trnCourseCreateSchema.safeParse({
      ...KHOA_OK,
      visibility: "ASSIGNED_ONLY",
      selfEnrollEnabled: true,
    });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("selfEnrollEnabled");
    expect(fields(r)).not.toContain("visibility");
  });

  it("ASSIGNED_ONLY + có luật lọc ⇒ lỗi trỏ catalogRuleJson", () => {
    const r = trnCourseCreateSchema.safeParse({
      ...KHOA_OK,
      visibility: "ASSIGNED_ONLY",
      catalogRuleJson: { department: ["DAO_TAO"] },
    });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("catalogRuleJson");
  });

  it("RULE_BASED + luật hợp lệ ⇒ qua", () => {
    const r = trnCourseCreateSchema.safeParse({
      ...KHOA_OK,
      visibility: "RULE_BASED",
      catalogRuleJson: { department: ["DAO_TAO"] },
    });
    expect(r.success).toBe(true);
  });

  it("luật lọc RỖNG không tính là có luật", () => {
    const r = trnCourseCreateSchema.safeParse({
      ...KHOA_OK,
      visibility: "RULE_BASED",
      catalogRuleJson: {},
    });
    expect(r.success).toBe(false);
  });

  it.each(["RESTRICTED", "CONFIDENTIAL"])(
    "mức %s buộc ASSIGNED_ONLY — bảng giá không rơi vào danh mục tự chọn",
    (muc) => {
      const r = trnCourseCreateSchema.safeParse({
        ...KHOA_OK,
        securityLevel: muc,
        visibility: "SELF_ENROLL",
      });
      expect(r.success).toBe(false);
      expect(fields(r)).toContain("visibility");
    },
  );

  it("PUBLISHED mà thiếu ngày xuất bản ⇒ từ chối", () => {
    // `publishedAt` là cột riêng, không tự suy từ status: báo cáo "số khoá xuất
    // bản mỗi tháng" đọc thẳng cột đó.
    const r = trnCourseCreateSchema.safeParse({ ...KHOA_OK, status: "PUBLISHED" });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("publishedAt");
  });
});

describe("TrnLesson — nội dung bắt buộc theo loại bài", () => {
  const NEN = { moduleId: "m1", title: "Bài 1", orderIndex: 0 };

  it("READ phải có nội dung hoặc trỏ bài hướng dẫn có sẵn", () => {
    const r = trnLessonCreateSchema.safeParse({ ...NEN, kind: "READ" });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("contentMd");
    expect(
      trnLessonCreateSchema.safeParse({ ...NEN, kind: "READ", contentMd: "xin chào" })
        .success,
    ).toBe(true);
    expect(
      trnLessonCreateSchema.safeParse({
        ...NEN,
        kind: "READ",
        sourceGuideSlug: "admin/tong-quan",
      }).success,
    ).toBe(true);
  });

  it("VIDEO thiếu tệp và thời lượng ⇒ hai lỗi, trỏ đúng hai ô", () => {
    const r = trnLessonCreateSchema.safeParse({ ...NEN, kind: "VIDEO" });
    expect(r.success).toBe(false);
    expect(fields(r)).toEqual(expect.arrayContaining(["videoKey", "durationSec"]));
  });

  it("LIVE_SESSION cần sessionDate (KHÔNG có cột liveSessionPlace)", () => {
    const r = trnLessonCreateSchema.safeParse({ ...NEN, kind: "LIVE_SESSION" });
    expect(fields(r)).toContain("sessionDate");
  });

  describe("SCORM khoá bằng cờ, không khoá bằng schema", () => {
    const cu = process.env.SCORM_ENABLED;
    afterEach(() => {
      if (cu === undefined) delete process.env.SCORM_ENABLED;
      else process.env.SCORM_ENABLED = cu;
    });

    it("cờ OFF ⇒ từ chối, trỏ kind", () => {
      delete process.env.SCORM_ENABLED;
      const r = trnLessonCreateSchema.safeParse({
        ...NEN,
        kind: "SCORM",
        scormPackageId: "pkg1",
      });
      expect(r.success).toBe(false);
      expect(fields(r)).toContain("kind");
    });

    it("cờ ON ⇒ qua (cột đã khai từ GĐ1, phạm vi là GĐ4)", () => {
      process.env.SCORM_ENABLED = "true";
      const r = trnLessonCreateSchema.safeParse({
        ...NEN,
        kind: "SCORM",
        scormPackageId: "pkg1",
      });
      expect(r.success).toBe(true);
    });
  });

  it("cueCount KHÔNG nhận từ client — là cột đếm, không phải ô nhập", () => {
    const r = trnLessonCreateSchema.safeParse({
      ...NEN,
      kind: "READ",
      contentMd: "x",
      cueCount: 99,
    });
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).cueCount).toBeUndefined();
  });
});

describe("TrnRequirement — scopeKind quyết định ĐÚNG MỘT cột đích", () => {
  const NEN = { courseId: "c1", dueDays: 30 };

  it.each([
    ["POSITION", "positionId"],
    ["DEPARTMENT", "departmentId"],
    ["ORG_UNIT", "orgUnitId"],
  ])("%s thiếu cột đích ⇒ lỗi trỏ %s", (scope, cot) => {
    const r = trnRequirementCreateSchema.safeParse({ ...NEN, scopeKind: scope });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain(cot);
  });

  it("LEVEL_TAG thiếu levelTag ⇒ lỗi trỏ levelTag", () => {
    const r = trnRequirementCreateSchema.safeParse({ ...NEN, scopeKind: "LEVEL_TAG" });
    expect(fields(r)).toContain("levelTag");
  });

  it("ALL_STAFF điền cột đích nào cũng bị từ chối, trỏ đúng cột thừa", () => {
    const r = trnRequirementCreateSchema.safeParse({
      ...NEN,
      scopeKind: "ALL_STAFF",
      departmentId: "d1",
    });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("departmentId");
  });

  it("ALL_STAFF cũng không được gắn đơn vị — áp toàn công ty mà gắn đơn vị là hai câu trái nhau", () => {
    const r = trnRequirementCreateSchema.safeParse({
      ...NEN,
      scopeKind: "ALL_STAFF",
      orgUnitId: "ou1",
    });
    expect(fields(r)).toContain("orgUnitId");
  });

  it("ALL_STAFF để trống cả 4 ⇒ qua", () => {
    expect(
      trnRequirementCreateSchema.safeParse({ ...NEN, scopeKind: "ALL_STAFF" }).success,
    ).toBe(true);
  });

  it("DEPARTMENT VẪN được gắn orgUnitId — cột đó kiêm 'yêu cầu này của đơn vị nào'", () => {
    // Đây là chỗ dễ sai nhất của bảng này: `orgUnitId` mang HAI vai. Kẹp nó vào
    // vòng lặp "cột đích thừa" sẽ cấm luôn việc gắn đơn vị cho yêu cầu phòng ban.
    const r = trnRequirementCreateSchema.safeParse({
      ...NEN,
      scopeKind: "DEPARTMENT",
      departmentId: "d1",
      orgUnitId: "ou-cs1",
    });
    expect(r.success).toBe(true);
  });

  it("DEPARTMENT mà điền thêm positionId ⇒ từ chối", () => {
    const r = trnRequirementCreateSchema.safeParse({
      ...NEN,
      scopeKind: "DEPARTMENT",
      departmentId: "d1",
      positionId: "p1",
    });
    expect(fields(r)).toContain("positionId");
  });
});

describe("TrnEvaluationResult — cơ sở và đơn vị BẮT BUỘC ở tầng ghi", () => {
  const NEN = {
    programId: "p1",
    level: "L1",
    subjectUserId: "u1",
    sourceRef: "survey-1",
    payloadJson: {},
  };

  it("thiếu centerId ⇒ từ chối trước khi chạm DB", () => {
    // DB cho nullable, nhưng model khai `BAT_BUOC` trong BACKFILL_SPECS và nằm
    // trong SCOPED_MODELS ⇒ dòng NULL sẽ VÔ HÌNH với chính người của cơ sở đó.
    // `scopedDb` KHÔNG che write, nên đây là chỗ duy nhất chặn được.
    const r = trnEvaluationResultCreateSchema.safeParse({ ...NEN, orgUnitId: "ou1" });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("centerId");
  });

  it("thiếu orgUnitId ⇒ từ chối", () => {
    const r = trnEvaluationResultCreateSchema.safeParse({ ...NEN, centerId: "cs1" });
    expect(fields(r)).toContain("orgUnitId");
  });

  it("đủ cả hai ⇒ qua", () => {
    expect(
      trnEvaluationResultCreateSchema.safeParse({
        ...NEN,
        centerId: "cs1",
        orgUnitId: "ou1",
      }).success,
    ).toBe(true);
  });
});

describe("TrnLessonCue — đúng MỘT nguồn câu hỏi", () => {
  const NEN = { lessonId: "l1", atSec: 30 };

  it("cả hai đều trống ⇒ từ chối", () => {
    const r = trnLessonCueCreateSchema.safeParse(NEN);
    expect(r.success).toBe(false);
  });

  it("cả hai cùng có ⇒ từ chối", () => {
    const r = trnLessonCueCreateSchema.safeParse({
      ...NEN,
      questionId: "q1",
      inlineJson: { text: "?" },
    });
    expect(r.success).toBe(false);
  });

  it("chỉ inlineJson ⇒ qua — đó là đường của GĐ2, ngân hàng câu hỏi tới GĐ3 mới có", () => {
    expect(
      trnLessonCueCreateSchema.safeParse({ ...NEN, inlineJson: { text: "?" } }).success,
    ).toBe(true);
  });

  it("atSec phải > 0 — mốc 0 giây là hỏi trước khi video chạy", () => {
    const r = trnLessonCueCreateSchema.safeParse({
      ...NEN,
      atSec: 0,
      inlineJson: { text: "?" },
    });
    expect(r.success).toBe(false);
  });
});

describe("TrnEvalLinkConfig — LINKED cần ĐỦ SÁU thứ", () => {
  const DU = {
    programId: "p1",
    mode: "LINKED",
    criteria: ["ON_TIME", "EXAM_SCORE"],
    weightOnTime: 60,
    weightExamScore: 40,
    effectiveFrom: "2026-12-01",
    decisionDocCode: "SR.QD.231-SD1",
    decisionDocEffectiveAt: "2026-11-01",
    hrApprovedByUserId: "hr1",
  };

  it("REPORT_ONLY không cần gì — mặc định fail-closed của giai đoạn đầu", () => {
    expect(trnEvalLinkConfigSchema.safeParse({ programId: "p1" }).success).toBe(true);
  });

  it("đủ sáu thứ ⇒ qua", () => {
    expect(trnEvalLinkConfigSchema.safeParse(DU).success).toBe(true);
  });

  it.each([
    ["decisionDocCode"],
    ["decisionDocEffectiveAt"],
    ["hrApprovedByUserId"],
    ["effectiveFrom"],
  ])("LINKED thiếu %s ⇒ lỗi trỏ đúng ô đó", (thieu) => {
    const r = trnEvalLinkConfigSchema.safeParse({ ...DU, [thieu]: null });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain(thieu);
  });

  it("tổng trọng số khác 100 ⇒ từ chối", () => {
    const r = trnEvalLinkConfigSchema.safeParse({ ...DU, weightExamScore: 30 });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("weightOnTime");
  });

  it("chọn một tiêu chí thì trọng số của nó phải là 100", () => {
    expect(
      trnEvalLinkConfigSchema.safeParse({
        ...DU,
        criteria: ["ON_TIME"],
        weightOnTime: 100,
        weightExamScore: null,
      }).success,
    ).toBe(true);
  });

  it("ngày áp dụng sớm hơn ngày hiệu lực quyết định ⇒ từ chối (không hồi tố)", () => {
    // Người ta đã được xét lương theo luật cũ; đổi luật rồi tính lại là đổi kết
    // quả SAU KHI đã công bố.
    const r = trnEvalLinkConfigSchema.safeParse({
      ...DU,
      effectiveFrom: "2026-10-01",
    });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("effectiveFrom");
  });

  it("LINKED không tiêu chí nào ⇒ từ chối", () => {
    const r = trnEvalLinkConfigSchema.safeParse({ ...DU, criteria: [] });
    expect(r.success).toBe(false);
    expect(fields(r)).toContain("criteria");
  });
});

describe("Không luật nào của module sinh grant DENY", () => {
  beforeEach(() => undefined);
  it("mã validator không nhắc tới DENY", async () => {
    // `can()` v2 là ALLOW-wins thuần — một grant DENY bị bỏ qua IM LẶNG. Loại trừ
    // phải đi bằng bảng dữ liệu, không bằng quyền.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "lib/validators/elearning.ts"),
      "utf8",
    );
    expect(src).not.toContain('"DENY"');
    expect(src).not.toContain("'DENY'");
  });
});
