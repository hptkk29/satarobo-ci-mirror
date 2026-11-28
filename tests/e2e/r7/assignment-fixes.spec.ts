/**
 * ASSIGNMENT-FIXES — vá 6 lỗi GIAO/NỘP/CHẤM bài tập (rà soát lớp học 08/2026).
 * Postgres LOCAL (.env.test). Test service-level (mẫu bulk-convert.spec.ts).
 *
 * Các server action đều cần session (requireActiveStudent / auth+checkPermission)
 * nên logic được TÁCH ra lib để test thẳng — action chỉ còn gate + gọi helper:
 *   - buildPortalSubmissionSchema (lib/validators/portal-submission.ts)
 *       ← submitAssignment (app/(portal)/portal/bai-tap/actions.ts) validate input thô.
 *   - resolveTemplateDup + publishDraftAssignment (lib/assignments/publish-draft.ts)
 *       ← assignTemplateAction (app/(teacher)/teacher/cham-bai/_actions.ts) xử lý dup DRAFT.
 *   - studentCanAccessExam + markHomeworkAfterAttempt (lib/lms/exam-access.ts)
 *       ← startAttempt + [examId]/page.tsx (ownership đề dùng chung) và submitAttempt
 *         (flip HomeworkAssignment ASSIGNED → SUBMITTED/GRADED).
 *
 * Chạy: $env:R7_SKIP_WEBSERVER='1'; pnpm test:e2e:r7 assignment-fixes
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import {
  buildPortalSubmissionSchema,
  PORTAL_SUBMISSION_MAX_FILE_SIZE,
  PORTAL_SUBMISSION_MAX_TEXT,
} from "../../../lib/validators/portal-submission";
import {
  resolveTemplateDup,
  publishDraftAssignment,
} from "../../../lib/assignments/publish-draft";
import {
  studentCanAccessExam,
  markHomeworkAfterAttempt,
} from "../../../lib/lms/exam-access";

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${seq++}`;

// ═══════════════════════════════════════════════════════════════════════════
// Nhóm 1 — SEC: PH nộp bài phải qua zod + fileUrl thuộc R2 của app (fix #1).
// Schema thuần → không cần DB.
// ═══════════════════════════════════════════════════════════════════════════
test.describe("[AF] Portal nộp bài — validate fileUrl (stored XSS/phishing)", () => {
  const R2 = "https://cdn.test.local";
  const schema = buildPortalSubmissionSchema(R2);
  const okFile = {
    fileUrl: `${R2}/uploads/submissions/2026-08/bai-lam-abc123.pdf`,
    fileName: "bai-lam.pdf",
    fileSize: 1234,
    mimeType: "application/pdf",
  };

  test("[AF-01] fileUrl javascript: → TỪ CHỐI (new URL() coi là hợp lệ nên .url() không đủ)", () => {
    const res = schema.safeParse({
      assignmentId: "a1",
      files: [{ ...okFile, fileUrl: "javascript:alert(1)" }],
    });
    expect(res.success).toBe(false);
  });

  test("[AF-02] fileUrl NGOÀI R2 (phishing) → TỪ CHỐI, kể cả trick host", () => {
    for (const evil of [
      "https://evil.com/uploads/phishing.pdf",
      `${R2}.evil.com/uploads/x.pdf`, // cdn.test.local.evil.com
      "https://cdn.test.localx/uploads/x.pdf", // prefix gần giống
      "https://cdn.test.local@evil.com/uploads/x.pdf", // userinfo trick
      `${R2}/khong-phai-uploads/x.pdf`, // đúng host, sai prefix key
    ]) {
      const res = schema.safeParse({
        assignmentId: "a1",
        files: [{ ...okFile, fileUrl: evil }],
      });
      expect(res.success, `phải từ chối: ${evil}`).toBe(false);
    }
  });

  test("[AF-03] fileUrl đúng kho R2/uploads/ → PASS; env không scheme cũng chuẩn hoá được", () => {
    expect(schema.safeParse({ assignmentId: "a1", files: [okFile] }).success).toBe(true);
    // R2_PUBLIC_URL="cdn.test.local" (không scheme) — như r2-client tự thêm https://
    const schemaNoScheme = buildPortalSubmissionSchema("cdn.test.local");
    expect(
      schemaNoScheme.safeParse({ assignmentId: "a1", files: [okFile] }).success,
    ).toBe(true);
  });

  test("[AF-04] thiếu R2_PUBLIC_URL → fail-closed: file bị từ chối, text-only vẫn nộp được", () => {
    const noEnv = buildPortalSubmissionSchema(undefined);
    expect(noEnv.safeParse({ assignmentId: "a1", files: [okFile] }).success).toBe(false);
    expect(
      noEnv.safeParse({ assignmentId: "a1", textAnswer: "em nộp bài" }).success,
    ).toBe(true);
  });

  test("[AF-05] giới hạn: textAnswer ≤ 10k, fileName ≤ 255, fileSize > 0 và ≤ trần upload", () => {
    expect(
      schema.safeParse({
        assignmentId: "a1",
        textAnswer: "x".repeat(PORTAL_SUBMISSION_MAX_TEXT + 1),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        assignmentId: "a1",
        files: [{ ...okFile, fileName: "f".repeat(256) }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ assignmentId: "a1", files: [{ ...okFile, fileSize: 0 }] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        assignmentId: "a1",
        files: [{ ...okFile, fileSize: PORTAL_SUBMISSION_MAX_FILE_SIZE + 1 }],
      }).success,
    ).toBe(false);
    // Hợp lệ biên: fileSize = trần, fileName 255, fileSize null (không khai).
    expect(
      schema.safeParse({
        assignmentId: "a1",
        files: [
          { ...okFile, fileSize: PORTAL_SUBMISSION_MAX_FILE_SIZE, fileName: "f".repeat(255) },
          { ...okFile, fileSize: null },
        ],
      }).success,
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Nhóm 2 — Deadlock giao bài từ template có DRAFT auto-sinh (fix #2) — cần DB.
// ═══════════════════════════════════════════════════════════════════════════
test.describe("[AF] Giao bài GV — template đã có Assignment DRAFT/PUBLISHED", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  async function seedClassWithStudents() {
    const center = await db.center.create({
      data: { code: "CS1", name: "Cơ sở 1", slug: `cs1-${uniq()}`, address: "x" },
    });
    const course = await db.course.create({
      data: { name: `Sata ${uniq()}`, slug: `sata-${uniq()}`, price: 4_000_000 },
    });
    const cls = await db.class.create({
      data: { name: `Lớp ${uniq()}`, courseId: course.id, centerId: center.id },
    });
    const students = [];
    for (const name of ["Bé Một", "Bé Hai"]) {
      const s = await db.student.create({ data: { name, centerId: center.id } });
      // Enrollment ∈ SCOPED_MODELS → luôn set centerId (CLAUDE.md §5).
      await db.enrollment.create({
        data: {
          studentId: s.id,
          classId: cls.id,
          courseId: course.id,
          status: "STUDYING",
          centerId: center.id,
        },
      });
      students.push(s);
    }
    return { center, course, cls, students };
  }

  async function seedTemplateWithDraft(classId: string, status: "DRAFT" | "PUBLISHED" = "DRAFT") {
    const template = await db.assignmentTemplate.create({
      data: { title: `Đầu bài ${uniq()}`, description: "Mô tả đề" },
    });
    const assignment = await db.assignment.create({
      data: {
        classId,
        templateId: template.id,
        title: template.title,
        description: template.description,
        kind: "HOMEWORK",
        status,
      },
    });
    return { template, assignment };
  }

  test("[AF-06] dup DRAFT → PUBLISH bản đó: PUBLISHED + dueAt + bản nộp NOT_SUBMITTED roster + file GV đính kèm (KHÔNG báo lỗi trùng)", async () => {
    const { cls, students } = await seedClassWithStudents();
    const { assignment } = await seedTemplateWithDraft(cls.id, "DRAFT");

    // Quyết định trong assignTemplateAction: DRAFT → publish (không nổ "đã giao rồi").
    expect(resolveTemplateDup({ status: "DRAFT" })).toBe("PUBLISH_DRAFT");

    const dueAt = new Date("2026-08-15T16:59:59Z");
    await publishDraftAssignment({
      assignmentId: assignment.id,
      dueAt,
      studentIds: students.map((s) => s.id),
      attachments: [
        { fileUrl: "https://cdn.test.local/uploads/documents/de-bai-gv.pdf", fileName: "de-bai-gv.pdf" },
      ],
      uploadedById: null,
    });

    const after = await db.assignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(after.status).toBe("PUBLISHED");
    expect(after.dueAt?.toISOString()).toBe(dueAt.toISOString());

    // Bản nộp NOT_SUBMITTED cho cả roster → site GV hiện "Đã nộp 0/2", portal HV nộp được.
    const subs = await db.assignmentSubmission.findMany({
      where: { assignmentId: assignment.id },
    });
    expect(subs).toHaveLength(2);
    expect(subs.every((s) => s.status === "NOT_SUBMITTED")).toBe(true);

    expect(
      await db.assignmentAttachment.count({
        where: { assignmentId: assignment.id, fileName: "de-bai-gv.pdf" },
      }),
    ).toBe(1);

    // Replay-safe phần bản nộp (skipDuplicates) — dù thực tế lượt 2 của action đã
    // bị chặn từ resolveTemplateDup (bài giờ là PUBLISHED → ALREADY_ASSIGNED).
    await publishDraftAssignment({
      assignmentId: assignment.id,
      dueAt,
      studentIds: students.map((s) => s.id),
    });
    expect(
      await db.assignmentSubmission.count({ where: { assignmentId: assignment.id } }),
    ).toBe(2);
  });

  test("[AF-07] dup PUBLISHED/CLOSED/ARCHIVED → vẫn báo trùng như cũ; không dup → tạo mới", async () => {
    // Hành vi cũ GIỮ NGUYÊN: chỉ DRAFT (auto-sinh, HV chưa thấy) mới được publish-thay-vì-lỗi.
    expect(resolveTemplateDup({ status: "PUBLISHED" })).toBe("ALREADY_ASSIGNED");
    expect(resolveTemplateDup({ status: "CLOSED" })).toBe("ALREADY_ASSIGNED");
    expect(resolveTemplateDup({ status: "ARCHIVED" })).toBe("ALREADY_ASSIGNED");
    expect(resolveTemplateDup(null)).toBe("CREATE_NEW");

    // Khẳng định bản PUBLISHED không bị helper đụng tới trong luồng action:
    // (action return lỗi trước khi gọi helper — đây chỉ chốt bất biến dữ liệu).
    const { cls } = await seedClassWithStudents();
    const { assignment } = await seedTemplateWithDraft(cls.id, "PUBLISHED");
    expect(resolveTemplateDup({ status: assignment.status })).toBe("ALREADY_ASSIGNED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Nhóm 3 — HomeworkAssignment status + ownership đề dùng chung (fix #3, #4) — cần DB.
// ═══════════════════════════════════════════════════════════════════════════
test.describe("[AF] HomeworkAssignment — flip status khi nộp + ownership đề classId=null", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  async function seedBase() {
    const center = await db.center.create({
      data: { code: "CS1", name: "Cơ sở 1", slug: `cs1-${uniq()}`, address: "x" },
    });
    const course = await db.course.create({
      data: { name: `Sata ${uniq()}`, slug: `sata-${uniq()}`, price: 4_000_000 },
    });
    const cls = await db.class.create({
      data: { name: `Lớp ${uniq()}`, courseId: course.id, centerId: center.id },
    });
    // ClassSession ∈ SCOPED_MODELS → set centerId.
    const session = await db.classSession.create({
      data: { classId: cls.id, date: new Date(), centerId: center.id },
    });
    const student = await db.student.create({ data: { name: "Bé Một", centerId: center.id } });
    return { center, course, cls, session, student };
  }

  test("[AF-08] submitAttempt xong → HomeworkAssignment rời ASSIGNED (SUBMITTED khi có tự luận, GRADED khi auto-chấm); MISSED/HV khác không bị đụng", async () => {
    const { center, session, student } = await seedBase();
    const student2 = await db.student.create({ data: { name: "Bé Hai", centerId: center.id } });
    const examA = await db.exam.create({
      data: { title: "Đề A (có tự luận)", status: "PUBLISHED" },
    });
    const examB = await db.exam.create({
      data: { title: "Đề B (trắc nghiệm)", status: "PUBLISHED" },
    });

    const hwA = await db.homeworkAssignment.create({
      data: { classSessionId: session.id, examId: examA.id, studentId: student.id },
    });
    const hwB = await db.homeworkAssignment.create({
      data: { classSessionId: session.id, examId: examB.id, studentId: student.id },
    });
    // HV khác đã MISSED cùng đề A — không được lật lại.
    const hwMissed = await db.homeworkAssignment.create({
      data: {
        classSessionId: session.id,
        examId: examA.id,
        studentId: student2.id,
        status: "MISSED",
      },
    });

    // Đề CÓ tự luận → SUBMITTED (chờ GV chấm) — như submitAttempt set ExamAttempt.
    const n1 = await db.$transaction((tx) =>
      markHomeworkAfterAttempt(tx, { studentId: student.id, examId: examA.id, graded: false }),
    );
    expect(n1).toBe(1);
    expect(
      (await db.homeworkAssignment.findUniqueOrThrow({ where: { id: hwA.id } })).status,
    ).toBe("SUBMITTED");

    // Đề KHÔNG tự luận (auto-chấm xong) → GRADED.
    await db.$transaction((tx) =>
      markHomeworkAfterAttempt(tx, { studentId: student.id, examId: examB.id, graded: true }),
    );
    expect(
      (await db.homeworkAssignment.findUniqueOrThrow({ where: { id: hwB.id } })).status,
    ).toBe("GRADED");

    // MISSED của HV khác giữ nguyên; gọi cho HV đó count = 0 (chỉ đụng ASSIGNED).
    const n3 = await db.$transaction((tx) =>
      markHomeworkAfterAttempt(tx, { studentId: student2.id, examId: examA.id, graded: false }),
    );
    expect(n3).toBe(0);
    expect(
      (await db.homeworkAssignment.findUniqueOrThrow({ where: { id: hwMissed.id } })).status,
    ).toBe("MISSED");
  });

  test("[AF-09] đề DÙNG CHUNG (classId=null): có HomeworkAssignment → được làm; không có → chặn", async () => {
    const { session, student } = await seedBase();
    const shared = await db.exam.create({
      data: { title: "Đề dùng chung", status: "PUBLISHED", classId: null },
    });

    // Chưa được giao → false (không phải cứ biết examId là làm được).
    expect(
      await studentCanAccessExam({ studentId: student.id, examId: shared.id, classId: null }),
    ).toBe(false);

    await db.homeworkAssignment.create({
      data: { classSessionId: session.id, examId: shared.id, studentId: student.id },
    });
    expect(
      await studentCanAccessExam({ studentId: student.id, examId: shared.id, classId: null }),
    ).toBe(true);
  });

  test("[AF-10] đề gắn lớp: enrollment active → được làm; enrollment đã xoá mềm / không học lớp → chặn (giữ luật cũ)", async () => {
    const { center, course, cls, student } = await seedBase();
    const examClass = await db.exam.create({
      data: { title: "Đề của lớp", status: "PUBLISHED", classId: cls.id },
    });

    // Không học lớp → false.
    expect(
      await studentCanAccessExam({ studentId: student.id, examId: examClass.id, classId: cls.id }),
    ).toBe(false);

    const enr = await db.enrollment.create({
      data: {
        studentId: student.id,
        classId: cls.id,
        courseId: course.id,
        status: "STUDYING",
        centerId: center.id,
      },
    });
    expect(
      await studentCanAccessExam({ studentId: student.id, examId: examClass.id, classId: cls.id }),
    ).toBe(true);

    // Soft-delete (FIX-C3) → mất quyền.
    await db.enrollment.update({ where: { id: enr.id }, data: { deletedAt: new Date() } });
    expect(
      await studentCanAccessExam({ studentId: student.id, examId: examClass.id, classId: cls.id }),
    ).toBe(false);
  });
});
