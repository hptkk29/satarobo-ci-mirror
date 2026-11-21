/**
 * #03 Pha A — denormalize centerId cho ConversationMessage + ReportCard.
 *
 * Bài học #04 (Attendance): flip model vào SCOPED_MODELS trong khi còn dòng `centerId = NULL`
 * ⇒ scopedDb inject `centerId IN (...)` ⇒ ẩn nhầm, im lặng. Nên pha A chỉ (a) thêm cột,
 * (b) backfill dòng cũ bằng migration, (c) ép MỌI đường tạo set centerId. Pha B mới flip.
 *
 * Spec này khoá (c) và khoá luôn "chưa flip" — nếu ai đó vội thêm vào SCOPED_MODELS,
 * test đỏ và buộc phải đọc runbook trước.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { postMessage } from "../../../lib/conversation/service";
import { NULL_IS_GLOBAL_MODELS, SCOPED_MODELS } from "../../../lib/db-scope";

const CS1 = "CS1";

async function seedEnrollment() {
  await db.center.upsert({
    where: { id: CS1 },
    create: { id: CS1, name: CS1, code: CS1, slug: "cs1", address: "test" },
    update: {},
  });
  const course = await db.course.create({ data: { name: "Khoá A", slug: "khoa-a" } });
  const cls = await db.class.create({
    data: { name: "Lớp A", courseId: course.id, centerId: CS1, status: "ACTIVE" },
    select: { id: true },
  });
  const student = await db.student.create({ data: { name: "HV", centerId: CS1 }, select: { id: true } });
  const enr = await db.enrollment.create({
    data: { studentId: student.id, classId: cls.id, courseId: course.id, centerId: CS1, status: "STUDYING" },
    select: { id: true },
  });
  const user = await db.user.create({
    data: { email: "gv.p03@t.vn", name: "GV", role: "TEACHER", roles: ["TEACHER"] },
    select: { id: true },
  });
  return { enrollmentId: enr.id, userId: user.id };
}

test.describe("[#03] centerId denormalize + flip scope", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[#03-A1] postMessage set centerId từ Enrollment", async () => {
    const { enrollmentId, userId } = await seedEnrollment();

    const msg = await postMessage({
      enrollmentId,
      authorUserId: userId,
      authorSide: "STAFF",
      body: "Chào phụ huynh",
    });

    const row = await db.conversationMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(row.centerId).toBe(CS1); // null ⇒ sau flip pha B sẽ bị ẩn nhầm
  });

  test("[#03-A2] postMessage trong transaction cũng set centerId", async () => {
    const { enrollmentId, userId } = await seedEnrollment();

    const msg = await db.$transaction((tx) =>
      postMessage({ enrollmentId, authorUserId: userId, authorSide: "PARENT", body: "Cảm ơn cô", tx }),
    );

    const row = await db.conversationMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(row.centerId).toBe(CS1);
  });

  test("[#03-B1] ĐÃ flip: 3 model nằm trong SCOPED_MODELS (prod xác nhận 0 null 10/07)", () => {
    for (const m of ["ConversationMessage", "ReportCard", "EvaluationRound"]) {
      expect({ model: m, scoped: SCOPED_MODELS.has(m) }).toEqual({ model: m, scoped: true });
    }
  });

  test("[#03-B2] chỉ EvaluationRound/Survey coi centerId=null là 'toàn hệ thống'", () => {
    // Với ReportCard/ConversationMessage, null = dữ liệu chưa backfill → PHẢI bị chặn,
    // không được biến thành "ai cũng thấy".
    expect(NULL_IS_GLOBAL_MODELS.has("EvaluationRound")).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has("Survey")).toBe(true);
    expect(NULL_IS_GLOBAL_MODELS.has("ReportCard")).toBe(false);
    expect(NULL_IS_GLOBAL_MODELS.has("ConversationMessage")).toBe(false);
  });

  test("[#03-A3] backfill migration: 2 câu UPDATE heal dòng null từ Enrollment.centerId", async () => {
    // Mô phỏng dữ liệu QUÁ KHỨ (trước Pha A): row centerId=null trên enrollment CÓ cơ sở
    // + enrollment KHÔNG cơ sở (phải giữ null). Chạy đúng 2 UPDATE của migration
    // 20260710000000_p03_phase_a_center_id_backfill rồi assert — SQL backfill trước đó
    // ship KHÔNG có test (gap A1-review 10/07).
    const { enrollmentId, userId } = await seedEnrollment();
    // Enrollment thứ 2 KHÔNG centerId (lớp HO/legacy) — backfill phải bỏ qua.
    const course2 = await db.course.create({ data: { name: "Khoá B", slug: "khoa-b-a3" } });
    const cls2 = await db.class.create({
      data: { name: "Lớp B", courseId: course2.id, status: "ACTIVE" },
      select: { id: true },
    });
    const student2 = await db.student.create({ data: { name: "HV2", centerId: CS1 }, select: { id: true } });
    const enrNull = await db.enrollment.create({
      data: { studentId: student2.id, classId: cls2.id, courseId: course2.id, status: "STUDYING" },
      select: { id: true },
    });

    const msg = await db.conversationMessage.create({
      data: { enrollmentId, authorUserId: userId, authorSide: "STAFF", body: "legacy" },
      select: { id: true },
    });
    const msgNull = await db.conversationMessage.create({
      data: { enrollmentId: enrNull.id, authorUserId: userId, authorSide: "STAFF", body: "legacy-null" },
      select: { id: true },
    });
    const rc = await db.reportCard.create({
      data: { enrollmentId, teacherId: userId, status: "DRAFT" },
      select: { id: true },
    });

    // 2 câu UPDATE — GIỮ NGUYÊN VĂN theo migration.sql.
    await db.$executeRaw`UPDATE "ConversationMessage" AS m
      SET "centerId" = e."centerId"
      FROM "Enrollment" AS e
      WHERE m."enrollmentId" = e."id" AND m."centerId" IS NULL AND e."centerId" IS NOT NULL`;
    await db.$executeRaw`UPDATE "ReportCard" AS r
      SET "centerId" = e."centerId"
      FROM "Enrollment" AS e
      WHERE r."enrollmentId" = e."id" AND r."centerId" IS NULL AND e."centerId" IS NOT NULL`;

    expect((await db.conversationMessage.findUniqueOrThrow({ where: { id: msg.id } })).centerId).toBe(CS1);
    expect((await db.reportCard.findUniqueOrThrow({ where: { id: rc.id } })).centerId).toBe(CS1);
    // Enrollment không cơ sở → giữ null (backfill không đoán bừa).
    expect((await db.conversationMessage.findUniqueOrThrow({ where: { id: msgNull.id } })).centerId).toBeNull();
  });
});
