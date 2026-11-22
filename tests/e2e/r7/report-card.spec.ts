/**
 * R7-15 — Học bạ ReportCard: nhập → duyệt → phát hành. Postgres LOCAL.
 *
 * SKELETON (RTM): AC1↔C1 · AC2↔C2 · AC3↔C3,C5 · AC4↔C4 · AC5↔C6.
 * - Transition guard matrix + snapshot freeze (THUẦN) đã phủ ở Vitest:
 *   lib/lms/report-card.test.ts (C4 chặn DRAFT→PUBLISHED, C5 đóng băng số liệu).
 * - Phần đi qua Server Action (auth()+can()+scopedDb) & view PH theo cookie cần lớp UI
 *   Playwright (browser context) — để TODO ở cuối.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached, type Actor } from "../../../lib/auth/actor";
import { can as canV2 } from "../../../lib/auth/can";
import {
  actorCapabilities,
  buildPublishedSnapshot,
  canEditReportCardContent,
  computeReportCardMetrics,
  getPublishedReportCards,
  getPublishedReportCardForStudent,
} from "../../../lib/lms/report-card";
import {
  chuyenTrangThaiHocBaCore,
  luuHocBaCore,
  type NguoiThaoTacHocBa,
} from "../../../lib/lms/report-card-ghi";

const CENTER = "CS1";

async function seedCenter() {
  await db.center.upsert({
    where: { id: CENTER },
    create: { id: CENTER, name: CENTER, code: CENTER, slug: CENTER.toLowerCase(), address: "test" },
    update: {},
  });
}

async function seedCourseClassStudent(slug: string) {
  const course = await db.course.create({ data: { name: `Khoá ${slug}`, slug } });
  const cls = await db.class.create({
    data: { name: `Lớp ${slug}`, courseId: course.id, centerId: CENTER, status: "ACTIVE" },
    select: { id: true },
  });
  const student = await db.student.create({ data: { name: `HV ${slug}`, centerId: CENTER }, select: { id: true } });
  const enr = await db.enrollment.create({
    data: { studentId: student.id, classId: cls.id, courseId: course.id, status: "STUDYING" },
    select: { id: true },
  });
  return { courseId: course.id, classId: cls.id, studentId: student.id, enrollmentId: enr.id };
}

/** Phát hành học bạ trực tiếp (mô phỏng action publish: đóng băng snapshot). */
async function publishReportCard(enrollmentId: string) {
  const enr = await db.enrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: {
      classId: true,
      class: { select: { name: true, centerId: true } },
      course: { select: { name: true } },
      student: { select: { name: true, studentCode: true } },
    },
  });
  const metrics = await computeReportCardMetrics(enrollmentId);
  const publishedAt = new Date();
  const snapshot = buildPublishedSnapshot({
    metrics,
    reportCard: { finalComment: "Hoàn thành tốt", completionStatus: "Đạt", periodComments: [] },
    scores: [],
    criteria: [],
    student: enr.student,
    course: enr.course,
    className: enr.class.name,
    publishedAt,
  });
  return db.reportCard.upsert({
    where: { enrollmentId },
    create: {
      enrollmentId,
      status: "PUBLISHED",
      publishedAt,
      centerId: enr.class.centerId,
      publishedSnapshot: snapshot as unknown as object,
    },
    update: { status: "PUBLISHED", publishedAt, publishedSnapshot: snapshot as unknown as object },
    select: { id: true },
  });
}

test.describe("[R7-15] Học bạ ReportCard", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  // ── AC1/C1 — mở học bạ → số liệu tự đổ đúng helper ───────────────────────────
  test("[R7-15-C1] computeReportCardMetrics khớp attendanceSummary (case rỗng = 0)", async () => {
    await seedCenter();
    const { enrollmentId } = await seedCourseClassStudent("c1");
    const m = await computeReportCardMetrics(enrollmentId);
    expect(m.attendance.total).toBe(0);
    expect(m.exams.count).toBe(0);
    expect(m.exams.averageScore).toBeNull();
    // NOTE: case đầy đủ 48/22/3/1/2 phủ ở Vitest computeAttendanceRate/computeExamAverage.
  });

  // ── AC2/C2 — HV học 2 khóa → 2 học bạ độc lập ────────────────────────────────
  test("[R7-15-C2] HV 2 khoá → 2 học bạ riêng (enrollmentId unique)", async () => {
    await seedCenter();
    const a = await seedCourseClassStudent("c2a");
    // HV thứ 2 có 2 enrollment ở 2 khoá khác nhau.
    const course2 = await db.course.create({ data: { name: "Khoá c2b", slug: "c2b" } });
    const cls2 = await db.class.create({
      data: { name: "Lớp c2b", courseId: course2.id, centerId: CENTER, status: "ACTIVE" },
      select: { id: true },
    });
    const enr2 = await db.enrollment.create({
      data: { studentId: a.studentId, classId: cls2.id, courseId: course2.id, status: "STUDYING" },
      select: { id: true },
    });

    await publishReportCard(a.enrollmentId);
    await publishReportCard(enr2.id);

    const cards = await getPublishedReportCards(a.studentId);
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.enrollmentId)).size).toBe(2);
  });

  // ── AC3/C3 — PH chỉ thấy PUBLISHED; DRAFT/PENDING/RECALLED ẩn ─────────────────
  test("[R7-15-C3] getPublishedReportCards bỏ qua DRAFT/PENDING/RECALLED", async () => {
    await seedCenter();
    const { enrollmentId, studentId } = await seedCourseClassStudent("c3");

    await db.reportCard.create({ data: { enrollmentId, status: "DRAFT" } });
    expect(await getPublishedReportCards(studentId)).toHaveLength(0);

    await db.reportCard.update({ where: { enrollmentId }, data: { status: "PENDING_REVIEW" } });
    expect(await getPublishedReportCards(studentId)).toHaveLength(0);

    await publishReportCard(enrollmentId);
    expect(await getPublishedReportCards(studentId)).toHaveLength(1);

    // Thu hồi → PH lần tải kế tiếp 404 (getPublishedReportCardForStudent null).
    const rc = await db.reportCard.findUniqueOrThrow({ where: { enrollmentId }, select: { id: true } });
    await db.reportCard.update({ where: { enrollmentId }, data: { status: "RECALLED" } });
    expect(await getPublishedReportCardForStudent(rc.id, studentId)).toBeNull();
    expect(await getPublishedReportCards(studentId)).toHaveLength(0);
  });

  // ── AC3/C5 — số liệu trên bản phát hành = snapshot lúc phát hành ──────────────
  test("[R7-15-C5] đổi điểm bài tập SAU phát hành → bản phát hành KHÔNG đổi", async () => {
    await seedCenter();
    const { enrollmentId, classId, studentId, courseId } = await seedCourseClassStudent("c5");

    // 1 exam đã chấm trước khi phát hành.
    const exam = await db.exam.create({
      data: { title: "KT c5", classId, status: "PUBLISHED", totalPoints: 10 },
      select: { id: true },
    });
    await db.examAttempt.create({
      data: { examId: exam.id, studentId, status: "GRADED", totalScore: 6, passed: true },
    });
    void courseId;

    const rc = await publishReportCard(enrollmentId);
    const before = await getPublishedReportCardForStudent(rc.id, studentId);
    const frozen = before?.metrics.exams.averageScore;
    expect(frozen).toBe(6); // 6/10*10 = 6

    // Đổi điểm SAU phát hành.
    await db.examAttempt.updateMany({ where: { examId: exam.id, studentId }, data: { totalScore: 10 } });

    const after = await getPublishedReportCardForStudent(rc.id, studentId);
    expect(after?.metrics.exams.averageScore).toBe(frozen); // snapshot bất biến
  });

  // ── AC3 — phát hành emit DomainEvent reportcard.published (notify PH) ─────────
  // NOTE: emit nằm trong transitionReportCardAction (cần auth()). Ở đây chỉ khẳng định
  // handler tồn tại — chi tiết notify phủ ở integration handler test.
  // TODO (UI Playwright — auth + cookie scope):
  //  • C4: GV bấm "Phát hành" thẳng → bị chặn; QL phát hành OK + AuditLog STATUS_CHANGE;
  //        thu hồi không lý do → chặn (transition guard đã phủ Vitest; cần phủ qua action).
  //  • C6: QL@CS2 mở /report-cards/[enrollmentId] của CS1 → trang báo "ngoài phạm vi".
  //  • AC4: vòng RECALLED→sửa→PENDING_REVIEW→PUBLISHED có đủ AuditLog (đếm log STATUS_CHANGE).
  //  • Portal: PH login → /portal/hoc-ba thấy bản PUBLISHED + tải /api/portal/report-card/[id];
  //        con khác cơ sở/khác PH → 404 (IDOR guard getPublishedReportCardForStudent).
});

// ═══════════════════════════════════════════════════════════════════════════
// [#17] Siết quyền SỬA học bạ sau phát hành (câu 55, Đào tạo & GV — Toại 06/07).
// Actor resolve THẬT từ DB (OrgUnit + RoleDef + UserOrgRole) như security-gate.spec —
// khẳng định seed RBAC v2 (report-cards:*) đúng SAU flip #09 + rule Gap3 (chặn GV).
// ═══════════════════════════════════════════════════════════════════════════
test.describe("[#17] Học bạ — siết quyền sửa sau phát hành (câu 55)", () => {
  const SA: RbacActor = { id: "seed-sa-17", name: "SA", role: "SUPER_ADMIN" };

  async function orgId(code: string) {
    return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
  }
  async function roleId(code: string) {
    return (await db.roleDef.findUnique({ where: { code }, select: { id: true } }))!.id;
  }
  async function makeActor(slug: string, orgCode: string, roleCode: string): Promise<Actor> {
    const u = await seedUser({ email: testEmail(slug), role: "TEACHER" });
    await assignUserOrgRole(SA, {
      userId: u.id,
      orgUnitId: await orgId(orgCode),
      roleId: await roleId(roleCode),
      reason: "seed #17",
    });
    return resolveActorUncached(u.id);
  }
  const caps = (actor: Actor) =>
    actorCapabilities({
      manage: canV2(actor, "report-cards:manage"),
      review: canV2(actor, "report-cards:review"),
    });

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-rc17", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-rc17", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[#17-C55a] TRAINING (Đào tạo) — 24/07 gỡ manage (không tạo/sửa DRAFT); GIỮ review nên vẫn sửa bản THU HỒI", async () => {
    const training = await makeActor("toai17", "HO", "TRAINING");
    // 24/07 (user chốt khoá chặt): gỡ report-cards:manage (không tạo/sửa học bạ DRAFT),
    // GIỮ report-cards:review (duyệt/phát hành/thu hồi).
    expect(canV2(training, "report-cards:manage")).toBe(false);
    expect(canV2(training, "report-cards:review")).toBe(true);
    // Sửa bản ĐÃ THU HỒI (RECALLED) key theo "review" — workflow thu-hồi-sửa-lại của
    // người DUYỆT → Đào tạo vẫn làm được (không cần manage).
    expect(canEditReportCardContent("RECALLED", caps(training))).toBe(true);
  });

  test("[#17-C55b] CENTER_MANAGER duyệt/sửa sau thu hồi vẫn OK sau flip #09 (v2 seed)", async () => {
    const cm = await makeActor("cm17", "CS1", "CENTER_MANAGER");
    expect(canV2(cm, "report-cards:manage")).toBe(true);
    expect(canV2(cm, "report-cards:review")).toBe(true);
    expect(canEditReportCardContent("RECALLED", caps(cm))).toBe(true);
  });

  test("[#17-C55c] TEACHER (GV) BỊ CHẶN sửa học bạ đã THU HỒI (không có review)", async () => {
    const teacher = await makeActor("gv17", "CS1", "TEACHER");
    expect(canV2(teacher, "report-cards:review")).toBe(false);
    expect(canEditReportCardContent("RECALLED", caps(teacher))).toBe(false);
  });

  test("[#17-C55d] PH chỉ thấy PUBLISHED — thu hồi thì học bạ ẩn khỏi portal", async () => {
    const centerId = (await db.orgUnit.findUnique({ where: { code: "CS1" }, select: { centerId: true } }))!.centerId!;
    const course = await db.course.create({ data: { name: "Khoá rc17", slug: "rc17" } });
    const cls = await db.class.create({
      data: { name: "Lớp rc17", courseId: course.id, centerId, status: "ACTIVE" },
      select: { id: true },
    });
    const student = await db.student.create({ data: { name: "HV rc17", centerId }, select: { id: true } });
    const enr = await db.enrollment.create({
      data: { studentId: student.id, classId: cls.id, courseId: course.id, status: "STUDYING" },
      select: { id: true },
    });

    const rc = await publishReportCard(enr.id);
    expect(await getPublishedReportCards(student.id)).toHaveLength(1);

    // Thu hồi (PUBLISHED→RECALLED) → PH không còn thấy + tải PDF 404.
    await db.reportCard.update({ where: { enrollmentId: enr.id }, data: { status: "RECALLED" } });
    expect(await getPublishedReportCards(student.id)).toHaveLength(0);
    expect(await getPublishedReportCardForStudent(rc.id, student.id)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [RC-CORE] Đường GHI học bạ qua hàm lõi (26/09/2026). Trước đó luật nằm inline trong server
// action (cần auth()) nên không spec nào phủ được — xem TODO ở khối [R7-15]. Nay action chỉ là vỏ
// auth()+revalidatePath; ca dưới chạy ĐÚNG luật của nó với actor thật từ DB (OrgUnit + RoleDef +
// UserOrgRole), gồm cả giáo viên đứng lớp (Class.teacherId ⇒ assignedClassIds).
// ═══════════════════════════════════════════════════════════════════════════
test.describe("[RC-CORE] Học bạ — lưu / nộp / phát hành qua hàm lõi", () => {
  const SA: RbacActor = { id: "seed-sa-rccore", name: "SA", role: "SUPER_ADMIN" };

  async function nguoi(slug: string, orgCode: string, roleCode: string, userRole: "TEACHER" | "CENTER_MANAGER") {
    const u = await seedUser({ email: testEmail(slug), role: userRole });
    const org = (await db.orgUnit.findUnique({ where: { code: orgCode }, select: { id: true } }))!.id;
    const role = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
    await assignUserOrgRole(SA, { userId: u.id, orgUnitId: org, roleId: role, reason: "seed rc-core" });
    return u.id;
  }
  async function ctxCua(userId: string): Promise<NguoiThaoTacHocBa> {
    const actor = await resolveActorUncached(userId);
    return {
      userId,
      auditActor: { id: userId, name: userId },
      actor,
      capabilities: actorCapabilities({
        manage: canV2(actor, "report-cards:manage"),
        review: canV2(actor, "report-cards:review"),
      }),
    };
  }
  async function lopCo(gvId: string, maCoSo: string) {
    const centerId = (await db.orgUnit.findUnique({ where: { code: maCoSo }, select: { centerId: true } }))!.centerId!;
    const course = await db.course.create({ data: { name: `Khoá ${gvId}`, slug: `rc-core-${gvId}` } });
    const tc = await Promise.all(
      ["Lắp ráp", "Lập trình"].map((name, order) =>
        db.reportCardCriterion.create({ data: { courseId: course.id, name, order, active: true }, select: { id: true } }),
      ),
    );
    const cls = await db.class.create({
      data: { name: `Lớp ${gvId}`, courseId: course.id, centerId, status: "ACTIVE", teacherId: gvId },
      select: { id: true },
    });
    const st = await db.student.create({ data: { name: "HV rc-core", centerId }, select: { id: true } });
    const enr = await db.enrollment.create({
      data: { studentId: st.id, classId: cls.id, courseId: course.id, status: "STUDYING" },
      select: { id: true },
    });
    return { enrollmentId: enr.id, studentId: st.id, tieuChi: tc.map((t) => t.id) };
  }

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-rccore", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-rccore", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[RC-CORE-01] GV đứng lớp lưu → DRAFT (teacherId = GV); nộp khi chưa chấm đủ bị chặn; chấm đủ → CHỜ DUYỆT", async () => {
    const gv = await nguoi("gv-rccore1", "CS1", "TEACHER", "TEACHER");
    const { enrollmentId, tieuChi } = await lopCo(gv, "CS1");
    const ctx = await ctxCua(gv);

    const luu1 = await luuHocBaCore(ctx, {
      enrollmentId,
      finalComment: "Con tiến bộ rõ.",
      scores: [{ criterionId: tieuChi[0]!, level: 3 }],
    });
    expect(luu1).toEqual({ ok: true, data: { enrollmentId } });
    const rc = await db.reportCard.findUniqueOrThrow({ where: { enrollmentId } });
    expect(rc.status).toBe("DRAFT");
    expect(rc.teacherId).toBe(gv);
    expect(await db.auditLog.count({ where: { entityType: "ReportCard", entityId: rc.id, action: "CREATE" } })).toBe(1);

    const nopThieu = await chuyenTrangThaiHocBaCore(ctx, { enrollmentId, to: "PENDING_REVIEW" });
    expect(nopThieu).toEqual({ ok: false, error: "Còn 1 tiêu chí chưa chấm — cần chấm đủ trước khi nộp duyệt." });

    expect(
      (await luuHocBaCore(ctx, { enrollmentId, scores: tieuChi.map((criterionId) => ({ criterionId, level: 4 })) })).ok,
    ).toBe(true);
    expect((await chuyenTrangThaiHocBaCore(ctx, { enrollmentId, to: "PENDING_REVIEW" })).ok).toBe(true);
    expect((await db.reportCard.findUniqueOrThrow({ where: { enrollmentId } })).status).toBe("PENDING_REVIEW");
  });

  test("[RC-CORE-02] GV KHÔNG phát hành được; QL cơ sở phát hành → snapshot + người phát hành + sự kiện", async () => {
    const gv = await nguoi("gv-rccore2", "CS1", "TEACHER", "TEACHER");
    const ql = await nguoi("ql-rccore2", "CS1", "CENTER_MANAGER", "CENTER_MANAGER");
    const { enrollmentId, studentId, tieuChi } = await lopCo(gv, "CS1");
    const ctxGv = await ctxCua(gv);
    await luuHocBaCore(ctxGv, { enrollmentId, scores: tieuChi.map((criterionId) => ({ criterionId, level: 3 })) });
    await chuyenTrangThaiHocBaCore(ctxGv, { enrollmentId, to: "PENDING_REVIEW" });

    const gvPhatHanh = await chuyenTrangThaiHocBaCore(ctxGv, { enrollmentId, to: "PUBLISHED" });
    expect(gvPhatHanh.ok).toBe(false);
    expect((await db.reportCard.findUniqueOrThrow({ where: { enrollmentId } })).status).toBe("PENDING_REVIEW");

    expect((await chuyenTrangThaiHocBaCore(await ctxCua(ql), { enrollmentId, to: "PUBLISHED" })).ok).toBe(true);
    const rc = await db.reportCard.findUniqueOrThrow({ where: { enrollmentId } });
    expect(rc.status).toBe("PUBLISHED");
    expect(rc.publishedById).toBe(ql);
    expect(rc.teacherId).toBe(gv); // người LẬP vẫn là GV
    expect(rc.publishedSnapshot).not.toBeNull();
    expect(await db.domainEvent.count({ where: { type: "reportcard.published" } })).toBe(1);
    expect(await getPublishedReportCards(studentId)).toHaveLength(1);
  });

  test("[RC-CORE-03] ngoài phạm vi: GV KHÔNG dạy lớp không lưu được; QL cơ sở KHÁC không phát hành được", async () => {
    const gv = await nguoi("gv-rccore3", "CS1", "TEACHER", "TEACHER");
    const gvKhac = await nguoi("gvk-rccore3", "CS1", "TEACHER", "TEACHER");
    const qlCs2 = await nguoi("ql2-rccore3", "CS2", "CENTER_MANAGER", "CENTER_MANAGER");
    const { enrollmentId, tieuChi } = await lopCo(gv, "CS1");
    const diem = tieuChi.map((criterionId) => ({ criterionId, level: 2 }));

    expect((await luuHocBaCore(await ctxCua(gvKhac), { enrollmentId, scores: diem })).ok).toBe(false);
    expect(await db.reportCard.count({ where: { enrollmentId } })).toBe(0);

    // Đối chứng dương: đúng GV đứng lớp thì lưu được.
    const ctxGv = await ctxCua(gv);
    expect((await luuHocBaCore(ctxGv, { enrollmentId, scores: diem })).ok).toBe(true);
    await chuyenTrangThaiHocBaCore(ctxGv, { enrollmentId, to: "PENDING_REVIEW" });
    expect((await chuyenTrangThaiHocBaCore(await ctxCua(qlCs2), { enrollmentId, to: "PUBLISHED" })).ok).toBe(false);
    expect((await db.reportCard.findUniqueOrThrow({ where: { enrollmentId } })).status).toBe("PENDING_REVIEW");
  });
});
