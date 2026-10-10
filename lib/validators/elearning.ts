import { z } from "zod";
import { isScormEnabled } from "@/lib/flags";

/**
 * EL-03 PR2 — VALIDATOR cho lõi `Trn*`.
 *
 * Chỉ chứa những luật DB KHÔNG ép được. Luật DB ép được (unique, FK, enum) không
 * lặp lại ở đây — lặp là đẻ ra hai nguồn sự thật rồi có ngày chúng lệch nhau.
 *
 * ─── Tên cột lấy từ SCHEMA THẬT, không lấy từ kế hoạch ────────────────────────
 * Bản §3.3 của kế hoạch dùng vài tên khác với schema đã migrate. Đây là danh sách
 * đã đối chiếu, ghi ra để người sau không "sửa lại cho khớp tài liệu":
 *   `contentMd`  chứ không phải `bodyMd`      ·  `sessionDate` chứ không `liveSessionAt`
 *   `securityLevel` trên TrnCourse (còn `securityTag` nằm ở TrnProgram)
 *   `major`/`minor` chứ không phải `version`  ·  `versionId` chứ không `courseVersionId`
 *   `orderIndex` chứ không phải `order`
 *
 * ─── `field` trong lỗi phải trỏ ĐÚNG Ô NGƯỜI DÙNG VỪA ĐỔI ─────────────────────
 * Mỗi luật một `ctx.addIssue` riêng với `path` riêng. Gộp hai luật vào một issue
 * là đẩy người dùng đi dò từng ô — họ sẽ sửa ô sai rồi lỗi vẫn còn.
 */

// ═══ Helper dùng chung ═══════════════════════════════════════════════════════

const nullableStr = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

// ⚠️ THỨ TỰ NHÁNH TRONG UNION LÀ QUAN TRỌNG, không phải gạch đầu dòng thẩm mỹ.
// `z.coerce.date()` NHẬN được `null`: `new Date(null)` = 1970-01-01, một Date hợp lệ.
// `z.coerce.number()` cũng nhận: `Number(null)` = 0. Nên nếu để nhánh coerce ĐỨNG TRƯỚC,
// nhánh `z.null()` KHÔNG BAO GIỜ tới lượt và việc xoá trống một ô sẽ được ghi thành
// năm 1970 hoặc số 0 — không báo lỗi, không ai biết. Đặt null/"" trước là vá gốc.
const nullableDate = z
  .union([z.null(), z.literal(""), z.coerce.date()])
  .optional()
  .transform((v) => (v === "" || v === undefined || v === null ? null : (v as Date)));

const nullableInt = z
  .union([z.null(), z.literal(""), z.coerce.number().int()])
  .optional()
  .transform((v) => (v === "" || v === undefined || v === null ? null : (v as number)));

// ═══ Enum — khớp ĐÚNG bộ đã CREATE TYPE trong migration `el_add_trn_core` ═════
// Không thêm giá trị ở đây mà không có migration: Zod nhận thì Prisma vẫn ném.

export const trnFunctionTag = z.enum([
  "SALE",
  "TEACHING",
  "MARKETING",
  "HR",
  "ACCOUNTING",
  "OPERATION",
  "COMPANY_WIDE",
]);
/** L1–L4. KHÔNG có L5 — "dưới 60 ngày / CTV / thực tập" là GIAI ĐOẠN, nằm ở stageTag. */
export const trnLevelTag = z.enum(["L1", "L2", "L3", "L4"]);
export const trnStageTag = z.enum(["NEW_HIRE", "IN_SERVICE"]);
export const trnDurationTag = z.enum(["S", "M", "LG"]);
export const trnNatureTag = z.enum([
  "MANDATORY",
  "MANDATORY_COMPLIANCE",
  "RECOMMENDED",
  "OPTIONAL",
]);
export const trnFormatTag = z.enum([
  "ELEARNING",
  "OFFLINE",
  "BLENDED",
  "OJT",
  "COACHING",
  "WEBINAR",
]);
export const trnSecurityTag = z.enum([
  "PUBLIC",
  "INTERNAL",
  "RESTRICTED",
  "CONFIDENTIAL",
]);
export const trnProgramStatus = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "RUNNING",
  "DONE",
  "EVALUATED",
  "CANCELLED",
]);
export const trnCourseStatus = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const trnCourseVisibility = z.enum([
  "ASSIGNED_ONLY",
  "SELF_ENROLL",
  "RULE_BASED",
]);
export const trnVersionStatus = z.enum([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "ARCHIVED",
]);
export const trnLessonKind = z.enum([
  "READ",
  "VIDEO",
  "SCORM",
  "QUIZ",
  "TASK",
  "LIVE_SESSION",
]);
export const trnReqScope = z.enum([
  "POSITION",
  "DEPARTMENT",
  "LEVEL_TAG",
  "ORG_UNIT",
  "ALL_STAFF",
]);
export const trnReqStatus = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export const trnEvalLevel = z.enum(["L1", "L2", "L3", "L4"]);
export const trnEvalLinkMode = z.enum(["REPORT_ONLY", "LINKED"]);
export const trnEvalCriterion = z.enum(["ON_TIME", "EXAM_SCORE"]);

/**
 * ⚠️ CỐ Ý ĐỂ MỞ. `catalogRuleJson` phải dùng CHUNG schema và CHUNG hàm thuần
 * `ruleToWhere()` với `TrnAssignmentRule.filterJson` — nhưng bảng và hàm đó
 * thuộc EL-05 và CHƯA TỒN TẠI (đã kiểm: `grep ruleToWhere\|filterJson` = 0 kết quả).
 *
 * Bịa ra một bộ luật lọc ở đây rồi EL-05 viết bộ thứ hai chính là thứ đặc tả cấm
 * đích danh: "hai bộ dịch lệch nhau là loại lỗi không ai phát hiện được bằng mắt".
 * Nên PR2 chỉ kiểm CẤU TRÚC (là object, không rỗng) và để nội dung cho EL-05 —
 * lúc đó thay đúng một dòng dưới đây bằng schema thật, không phải sửa 10 chỗ.
 */
export const catalogRuleJsonSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => Object.keys(v).length > 0, {
    message: "Luật lọc danh mục không được rỗng",
  });

// ═══ TrnProgram ══════════════════════════════════════════════════════════════

/** `SR.DT.[CN].[NĂM].[STT]` — ĐÃ BỎ đoạn `[CB]` (C6), mã còn đoạn đó là mã cũ. */
export const TRN_PROGRAM_CODE_RE =
  /^SR\.DT\.(SALE|TEACHING|MARKETING|HR|ACCOUNTING|OPERATION|COMPANY_WIDE)\.\d{4}\.\d+$/;

export const trnProgramCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(
        TRN_PROGRAM_CODE_RE,
        "Mã chương trình phải dạng SR.DT.[CHỨC NĂNG].[NĂM].[STT] — bản mới đã bỏ đoạn cấp bậc",
      ),
    year: z.coerce.number().int().min(2020).max(2100),
    seq: z.coerce.number().int().min(1),
    title: z.string().trim().min(1, "Tên chương trình không được trống"),
    objectivesJson: z.unknown().nullable().optional(),

    primaryFunctionTag: trnFunctionTag,
    functionTags: z.array(trnFunctionTag).default([]),
    levelTags: z.array(trnLevelTag).default([]),
    stageTag: trnStageTag,
    durationTag: trnDurationTag,
    natureTag: trnNatureTag,
    formatTag: trnFormatTag,
    securityTag: trnSecurityTag.default("INTERNAL"),

    sourceDocCode: nullableStr,
    sourceDocVersion: nullableStr,
    sourceDocEffectiveAt: nullableDate,
    needsReview: z.boolean().default(false),

    validityMonths: nullableInt,
    expiresAt: nullableDate,

    needId: nullableStr,
    needExemptReason: nullableStr,

    budgetPlanned: z.coerce.number().nonnegative().nullable().optional(),

    status: trnProgramStatus.default("DRAFT"),
    ownerUserId: z.string().trim().min(1),
    contentOwnerUserId: nullableStr,

    // NULL = ÁP TOÀN CÔNG TY. Trên form phải là lựa chọn TƯỜNG MINH, không bao giờ
    // là mặc định im lặng — người dùng phải biết mình vừa tạo thứ cả công ty thấy.
    centerId: nullableStr,
    orgUnitId: nullableStr,
  })
  .superRefine((d, ctx) => {
    // §8.1 — không có phiếu nhu cầu thì phải có lý do miễn. Để trống CẢ HAI là
    // mở một chương trình không ai truy được vì sao nó tồn tại.
    if (!d.needId && !d.needExemptReason) {
      ctx.addIssue({
        code: "custom",
        path: ["needExemptReason"],
        message:
          "Chưa gắn phiếu nhu cầu thì phải nêu lý do miễn — không được để trống cả hai",
      });
    }
    // §13.4 — khoá tuân thủ bắt buộc phải có chu kỳ, nếu không thì không có mốc
    // nào để tính hạn tái chứng nhận và ma trận đào tạo tô xám vĩnh viễn.
    if (d.natureTag === "MANDATORY_COMPLIANCE" && d.validityMonths == null) {
      ctx.addIssue({
        code: "custom",
        path: ["validityMonths"],
        message:
          "Chương trình tuân thủ bắt buộc phải khai chu kỳ tái chứng nhận (số tháng)",
      });
    }
  });

/**
 * Điều kiện XUẤT BẢN — KHÁC điều kiện lưu nháp, có chủ đích.
 * Bắt đủ từ lúc tạo thì không ai lưu nổi một bản nháp; bỏ hẳn thì xuất bản được
 * một chương trình không rõ dựa trên văn bản nào và ai chịu trách nhiệm nội dung.
 */
export const trnProgramPublishSchema = z
  .object({
    sourceDocCode: z.string().trim().min(1),
    sourceDocVersion: z.string().trim().min(1),
    sourceDocEffectiveAt: z.coerce.date(),
    contentOwnerUserId: z.string().trim().min(1),
  })
  .superRefine((d, ctx) => {
    for (const [k, v] of Object.entries(d)) {
      if (v == null || v === "") {
        ctx.addIssue({
          code: "custom",
          path: [k],
          message: "Bắt buộc trước khi xuất bản",
        });
      }
    }
  });

// ═══ TrnCourse ═══════════════════════════════════════════════════════════════

export const trnCourseCreateSchema = z
  .object({
    programId: nullableStr,
    code: z.string().trim().min(1, "Mã khoá không được trống"),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug chỉ gồm chữ thường, số và dấu gạch ngang"),
    title: z.string().trim().min(1),
    summary: nullableStr,
    estimatedMinutes: nullableInt,
    sequential: z.boolean().default(false),

    status: trnCourseStatus.default("DRAFT"),
    publishedAt: nullableDate,

    securityLevel: trnSecurityTag.default("INTERNAL"),

    // Bộ ba hiển thị danh mục. Mặc định FAIL-CLOSED: khoá mới tạo không tự hiện
    // với ai. Mở rộng tầm nhìn là hành động CÓ CHỦ ĐÍCH, không phải trạng thái mặc định.
    visibility: trnCourseVisibility.default("ASSIGNED_ONLY"),
    selfEnrollEnabled: z.boolean().default(false),
    catalogRuleJson: catalogRuleJsonSchema.nullable().optional().default(null),

    clonedFromCourseId: nullableStr,
    ownerUserId: nullableStr,
    centerId: nullableStr,
    orgUnitId: nullableStr,
  })
  .superRefine((d, ctx) => {
    if (d.visibility === "RULE_BASED" && d.catalogRuleJson == null) {
      ctx.addIssue({
        code: "custom",
        path: ["catalogRuleJson"],
        message: "Chế độ theo luật thì phải khai luật lọc danh mục",
      });
    }
    // Hai luật dưới đây là hai MẶT của cùng một ràng buộc, nhưng tách riêng để
    // lỗi trỏ đúng ô người dùng vừa đổi — họ đổi `selfEnrollEnabled` thì lỗi phải
    // nằm ở đó, không phải ở `visibility`.
    if (d.visibility === "ASSIGNED_ONLY" && d.selfEnrollEnabled) {
      ctx.addIssue({
        code: "custom",
        path: ["selfEnrollEnabled"],
        message:
          "Khoá chỉ dành cho người được giao thì không thể bật tự ghi danh",
      });
    }
    if (d.visibility === "ASSIGNED_ONLY" && d.catalogRuleJson != null) {
      ctx.addIssue({
        code: "custom",
        path: ["catalogRuleJson"],
        message:
          "Khoá chỉ dành cho người được giao thì không dùng luật lọc danh mục",
      });
    }
    // Bảng giá, chính sách ưu đãi, chuẩn ngạch lương không được rơi vào danh mục
    // tự chọn của toàn công ty vì một cú bấm nhầm.
    if (
      (d.securityLevel === "RESTRICTED" || d.securityLevel === "CONFIDENTIAL") &&
      d.visibility !== "ASSIGNED_ONLY"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["visibility"],
        message: `Mức bảo mật ${d.securityLevel} buộc khoá chỉ dành cho người được giao`,
      });
    }
    // `publishedAt` là cột riêng, KHÔNG tự suy từ status — báo cáo "số khoá xuất
    // bản mỗi tháng" đọc thẳng cột này.
    if (d.status === "PUBLISHED" && d.publishedAt == null) {
      ctx.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "Khoá đã xuất bản phải có ngày xuất bản",
      });
    }
  });

// ═══ TrnModule / TrnLesson ═══════════════════════════════════════════════════

export const trnModuleCreateSchema = z.object({
  courseId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  orderIndex: z.coerce.number().int().min(0),
});

export const trnLessonCreateSchema = z
  .object({
    moduleId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    orderIndex: z.coerce.number().int().min(0),
    kind: trnLessonKind,

    contentMd: nullableStr,
    sourceGuideSlug: nullableStr,
    minReadSeconds: z.coerce.number().int().min(30).default(30),

    videoKey: nullableStr,
    videoKey360: nullableStr,
    durationSec: nullableInt,
    videoMeta: z.unknown().nullable().optional(),
    captionKey: nullableStr,
    transcriptMd: nullableStr,
    audioKey: nullableStr,

    scormPackageId: nullableStr,
    examId: nullableStr,
    rubricId: nullableStr,
    sessionDate: nullableDate,
    // `cueCount` CỐ Ý không nhận từ client: nó là cột đếm, cập nhật trong cùng
    // transaction với thêm/xoá cue. Nhận từ client là mở đường cho số đếm nói dối.
  })
  .superRefine((d, ctx) => {
    // Cột đã khai từ GĐ1 (thêm cột vào bảng có dữ liệu prod vướng luật cứng #4),
    // nhưng phạm vi SCORM là GĐ4 ⇒ khoá bằng validator, không khoá bằng schema.
    if (d.kind === "SCORM" && !isScormEnabled()) {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: "Bài SCORM chưa mở trong giai đoạn này",
      });
    }
    const thieu = (path: string, msg: string) =>
      ctx.addIssue({ code: "custom", path: [path], message: msg });

    switch (d.kind) {
      case "READ":
        if (!d.contentMd && !d.sourceGuideSlug) {
          thieu("contentMd", "Bài đọc phải có nội dung hoặc trỏ bài hướng dẫn có sẵn");
        }
        break;
      case "VIDEO":
        if (!d.videoKey) thieu("videoKey", "Bài video phải có tệp video");
        if (d.durationSec == null)
          thieu("durationSec", "Bài video phải có thời lượng");
        break;
      case "SCORM":
        if (!d.scormPackageId) thieu("scormPackageId", "Bài SCORM phải có gói nội dung");
        break;
      case "QUIZ":
        if (!d.examId) thieu("examId", "Bài kiểm tra phải trỏ một đề thi");
        break;
      case "TASK":
        if (!d.rubricId) thieu("rubricId", "Bài tập phải trỏ một khung chấm");
        break;
      case "LIVE_SESSION":
        if (d.sessionDate == null)
          thieu("sessionDate", "Buổi học trực tiếp phải có ngày giờ");
        break;
    }
  });

// ═══ TrnCourseVersion ════════════════════════════════════════════════════════

export const trnCourseVersionCreateSchema = z.object({
  courseId: z.string().trim().min(1),
  major: z.coerce.number().int().min(0),
  minor: z.coerce.number().int().min(0),
  clonedFromVersionId: nullableStr,
  status: trnVersionStatus.default("DRAFT"),
  changeNote: nullableStr,
});

export const trnCourseVersionLessonSchema = z.object({
  versionId: z.string().trim().min(1),
  lessonId: z.string().trim().min(1),
  orderIndex: z.coerce.number().int().min(0),
  required: z.boolean().default(true),
  // Thứ cho phép diff(v1, v2) phát hiện bài ĐÃ ĐỔI NỘI DUNG mà vẫn giữ nguyên id.
  contentHash: z.string().trim().min(1),
});

// ═══ TrnRequirement ══════════════════════════════════════════════════════════

/** `scopeKind` → tên cột đích DUY NHẤT được phép có giá trị. */
const COT_DICH: Record<
  z.infer<typeof trnReqScope>,
  "positionId" | "departmentId" | "levelTag" | "orgUnitId" | null
> = {
  POSITION: "positionId",
  DEPARTMENT: "departmentId",
  LEVEL_TAG: "levelTag",
  ORG_UNIT: "orgUnitId",
  ALL_STAFF: null,
};

export const trnRequirementCreateSchema = z
  .object({
    courseId: z.string().trim().min(1),
    scopeKind: trnReqScope,

    positionId: nullableStr,
    departmentId: nullableStr,
    levelTag: trnLevelTag.nullable().optional().default(null),

    dueDays: z.coerce.number().int().min(0),
    validityMonths: nullableInt,

    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: nullableDate,
    status: trnReqStatus.default("ACTIVE"),
    createdByUserId: nullableStr,

    centerId: nullableStr,
    // ⚠️ HAI VAI: cột đơn vị của bản ghi, VÀ cột đích khi scopeKind='ORG_UNIT'.
    // §3.3 chốt là một cột, không đẻ cột thứ hai.
    orgUnitId: nullableStr,
  })
  .superRefine((d, ctx) => {
    const dich = COT_DICH[d.scopeKind];
    const giaTri: Record<string, unknown> = {
      positionId: d.positionId,
      departmentId: d.departmentId,
      levelTag: d.levelTag,
      orgUnitId: d.orgUnitId,
    };

    if (dich && giaTri[dich] == null) {
      ctx.addIssue({
        code: "custom",
        path: [dich],
        message: `Phạm vi ${d.scopeKind} phải chọn đúng một giá trị`,
      });
    }

    for (const cot of ["positionId", "departmentId", "levelTag"] as const) {
      if (cot !== dich && giaTri[cot] != null) {
        ctx.addIssue({
          code: "custom",
          path: [cot],
          message: `Phạm vi ${d.scopeKind} thì ô này phải để trống`,
        });
      }
    }
    // `orgUnitId` xử riêng vì nó kiêm cột đơn vị: ở các phạm vi KHÁC `ORG_UNIT`
    // nó vẫn được phép có giá trị (nghĩa là "yêu cầu này của đơn vị nào"), nên
    // KHÔNG kẹp nó vào vòng lặp trên. Chỉ `ALL_STAFF` mới buộc rỗng — vì áp toàn
    // công ty mà lại gắn một đơn vị là hai câu trái nhau.
    if (d.scopeKind === "ALL_STAFF" && d.orgUnitId != null) {
      ctx.addIssue({
        code: "custom",
        path: ["orgUnitId"],
        message: "Phạm vi toàn công ty thì không gắn đơn vị nào",
      });
    }
    if (d.effectiveTo && d.effectiveFrom && d.effectiveTo < d.effectiveFrom) {
      ctx.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "Ngày hết hiệu lực phải sau ngày bắt đầu",
      });
    }
  });

// ═══ TrnEvaluationResult ═════════════════════════════════════════════════════

/**
 * ⚠️ `centerId`/`orgUnitId` là BẮT BUỘC ở đây dù DB cho nullable.
 * Model này khai `nullMeaning: "BAT_BUOC"` trong `BACKFILL_SPECS` — NULL nghĩa là
 * dữ liệu chưa backfill, KHÔNG phải "toàn công ty". Và vì `Trn*` ∈ SCOPED_MODELS,
 * một dòng NULL sẽ VÔ HÌNH với chính người của cơ sở đó. Chặn ở tầng ghi là chỗ
 * duy nhất chặn được: `scopedDb` KHÔNG che write.
 */
export const trnEvaluationResultCreateSchema = z.object({
  programId: z.string().trim().min(1),
  level: trnEvalLevel,
  subjectUserId: z.string().trim().min(1),
  sourceRef: z.string().trim().min(1),
  score: z.coerce.number().nullable().optional(),
  payloadJson: z.unknown(),
  recordedAt: z.coerce.date().optional(),
  centerId: z.string().trim().min(1, "Kết quả đánh giá phải gắn một cơ sở"),
  orgUnitId: z.string().trim().min(1, "Kết quả đánh giá phải gắn một đơn vị"),
});

// ═══ TrnLessonCue ════════════════════════════════════════════════════════════

export const trnLessonCueCreateSchema = z
  .object({
    lessonId: z.string().trim().min(1),
    atSec: z.coerce.number().int().positive("Mốc giây phải lớn hơn 0"),
    questionId: nullableStr,
    inlineJson: z.unknown().nullable().optional(),
    blocking: z.boolean().default(true),
    orderIndex: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((d, ctx) => {
    const coQuestion = d.questionId != null;
    const coInline = d.inlineJson != null;
    // ĐÚNG MỘT. Cả hai = không biết lấy cái nào; không cái nào = cue rỗng, phát
    // video tới mốc đó rồi dừng mà chẳng hỏi gì.
    if (coQuestion === coInline) {
      ctx.addIssue({
        code: "custom",
        path: ["inlineJson"],
        message:
          "Chọn đúng một: dùng câu hỏi có sẵn trong ngân hàng, hoặc soạn tại chỗ",
      });
    }
  });

// ⚠️ Luật `0 < atSec < TrnLesson.durationSec` KHÔNG kiểm được ở đây: nó cần đọc
// bài học từ DB. Kiểm ở tầng service, cùng transaction với việc cập nhật `cueCount`.

// ═══ TrnEvalLinkConfig ═══════════════════════════════════════════════════════

export const trnEvalLinkConfigSchema = z
  .object({
    programId: z.string().trim().min(1),
    mode: trnEvalLinkMode.default("REPORT_ONLY"),
    criteria: z.array(trnEvalCriterion).default([]),
    weightOnTime: nullableInt,
    weightExamScore: nullableInt,
    effectiveFrom: nullableDate,

    decisionDocCode: nullableStr,
    decisionDocEffectiveAt: nullableDate,
    hrApprovedByUserId: nullableStr,

    centerId: nullableStr,
    orgUnitId: nullableStr,
  })
  .superRefine((d, ctx) => {
    // REPORT_ONLY là mặc định fail-closed và nó KHÔNG cần gì cả — giai đoạn đầu
    // chỉ báo cáo, chưa gắn vào xét lương.
    if (d.mode !== "LINKED") return;

    // `LINKED` chỉ lưu được khi ĐỦ SÁU thứ. Thiếu một là từ chối, nêu đúng ô thiếu.
    if (!d.decisionDocCode) {
      ctx.addIssue({
        code: "custom",
        path: ["decisionDocCode"],
        message: "Bật liên kết lương phải khai số hiệu quyết định",
      });
    }
    if (!d.decisionDocEffectiveAt) {
      ctx.addIssue({
        code: "custom",
        path: ["decisionDocEffectiveAt"],
        message: "Bật liên kết lương phải khai ngày hiệu lực của quyết định",
      });
    }
    if (!d.hrApprovedByUserId) {
      ctx.addIssue({
        code: "custom",
        path: ["hrApprovedByUserId"],
        message: "Bật liên kết lương phải có người của Nhân sự duyệt",
      });
    }
    if (!d.effectiveFrom) {
      ctx.addIssue({
        code: "custom",
        path: ["effectiveFrom"],
        message: "Bật liên kết lương phải khai ngày bắt đầu áp dụng",
      });
    }
    if (d.criteria.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "Phải chọn ít nhất một tiêu chí",
      });
    }

    // Không cho hiệu lực HỒI TỐ vào một kỳ đã đóng: người ta đã được xét lương
    // theo luật cũ rồi, đổi luật rồi tính lại là đổi kết quả sau khi công bố.
    if (d.effectiveFrom && d.decisionDocEffectiveAt && d.effectiveFrom < d.decisionDocEffectiveAt) {
      ctx.addIssue({
        code: "custom",
        path: ["effectiveFrom"],
        message: "Ngày áp dụng không được sớm hơn ngày hiệu lực của quyết định",
      });
    }

    const tong =
      (d.criteria.includes("ON_TIME") ? (d.weightOnTime ?? 0) : 0) +
      (d.criteria.includes("EXAM_SCORE") ? (d.weightExamScore ?? 0) : 0);
    if (d.criteria.includes("ON_TIME") && d.weightOnTime == null) {
      ctx.addIssue({
        code: "custom",
        path: ["weightOnTime"],
        message: "Đã chọn tiêu chí đúng hạn thì phải khai trọng số",
      });
    }
    if (d.criteria.includes("EXAM_SCORE") && d.weightExamScore == null) {
      ctx.addIssue({
        code: "custom",
        path: ["weightExamScore"],
        message: "Đã chọn tiêu chí điểm thi thì phải khai trọng số",
      });
    }
    if (d.criteria.length > 0 && tong !== 100) {
      ctx.addIssue({
        code: "custom",
        path: ["weightOnTime"],
        message: `Tổng trọng số các tiêu chí đã chọn phải bằng 100 (hiện ${tong})`,
      });
    }
  });

// ═══ TrnPolicyAcceptance ═════════════════════════════════════════════════════

export const trnPolicyAcceptanceSchema = z.object({
  userId: z.string().trim().min(1),
  policyKey: z.string().trim().min(1),
  policyVersion: z.string().trim().min(1),
});

export type TrnProgramCreateInput = z.infer<typeof trnProgramCreateSchema>;
export type TrnCourseCreateInput = z.infer<typeof trnCourseCreateSchema>;
export type TrnLessonCreateInput = z.infer<typeof trnLessonCreateSchema>;
export type TrnRequirementCreateInput = z.infer<typeof trnRequirementCreateSchema>;
export type TrnEvalLinkConfigInput = z.infer<typeof trnEvalLinkConfigSchema>;
