/**
 * R7-08 — Học bù LIÊN CƠ SỞ + 5 chỉ số + 6 nhãn điểm danh. Postgres LOCAL.
 *
 * SKELETON (RTM): AC1↔C1 · AC2↔C2 · AC3↔C3 · AC4↔C4 · AC5↔C5,C7 · AC6↔C6 · race↔C8.
 * Các case logic thuần (5 chỉ số / 6 nhãn / no-leak whitelist) đã phủ ở Vitest:
 *   - lib/attendance/summary.test.ts (C5 48/22/3/1/2, C7 buổi hủy)
 *   - lib/labels.test.ts (6 nhãn + buổi hủy)
 *   - lib/db-scope.test.ts ([R7-08-AC6] exception không rò Lead/Order/Student/Payment)
 * File này phủ tầng tích hợp DB (suggest/schedule/audit) — gọi service TRỰC TIẾP
 * (service-level spec, không drive UI). Actor resolve THẬT từ DB (OrgUnit+RoleDef+UserOrgRole).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { withMakeupException, scopedDb } from "../../../lib/db-scope";
import { attendanceSummary } from "../../../lib/attendance/summary";
import {
  createMakeupNeed,
  suggestMakeupSessions,
  scheduleMakeup,
  completeMakeup,
} from "../../../lib/makeup/service";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

// ─── helpers ─────────────────────────────────────────────────────────────────
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}

/** Tạo 2 cơ sở + cây OrgUnit + RoleDef. Trả về centerId CS1/CS2. */
async function setupOrg() {
  await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-mk", address: "a", city: "" } });
  await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-mk", address: "b", city: "" } });
  await seedOrg(["HO", "CS1", "CS2"]);
  await seedRoles();
  return { c1: await centerId("CS1"), c2: await centerId("CS2") };
}

/** User + UserOrgRole tại orgCode → Actor resolve thật (mặc định CENTER_MANAGER). */
async function makeActor(slug: string, orgCode: string, roleCode = "CENTER_MANAGER") {
  const u = await seedUser({ email: testEmail(slug), role: "CENTER_MANAGER" });
  const r = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return { actor: await resolveActorUncached(u.id), userId: u.id };
}

/** Tạo lớp + 1 buổi ứng viên (mặc định sĩ số 20). Trả về classId + sessionId. */
async function makeCandidate(p: {
  name: string;
  courseId: string;
  centerId: string;
  lessonId: string;
  date: Date;
  maxStudents?: number;
}) {
  const cls = await db.class.create({
    data: {
      name: p.name,
      courseId: p.courseId,
      centerId: p.centerId,
      status: "ACTIVE",
      maxStudents: p.maxStudents ?? 20,
    },
    select: { id: true },
  });
  const sess = await db.classSession.create({
    data: { classId: cls.id, date: p.date, status: "SCHEDULED", lessonId: p.lessonId },
    select: { id: true },
  });
  return { classId: cls.id, sessionId: sess.id };
}

/**
 * Seed nền chung: khóa + curriculum (lesson order 5/6/7), lớp nhà @CS1, HS@CS1
 * đang học lớp nhà, 1 buổi đã lỡ (lessonId=L5, quá khứ) + attendance NEEDS_MAKEUP,
 * và MakeupNeed PENDING. Trả về toàn bộ id cần dùng.
 */
async function seedBase(opts?: { totalSessions?: number }) {
  const { c1, c2 } = await setupOrg();
  const course = await db.course.create({
    data: { name: "Robot", slug: "robot-mk", totalSessions: opts?.totalSessions ?? null },
    select: { id: true },
  });
  const curriculum = await db.curriculum.create({
    data: { name: "CT Robot", courseId: course.id, isActive: true },
    select: { id: true },
  });
  const lessons: Record<number, string> = {};
  for (const order of [5, 6, 7]) {
    const l = await db.lesson.create({
      data: { curriculumId: curriculum.id, order, title: `Bài ${order}` },
      select: { id: true },
    });
    lessons[order] = l.id;
  }

  const homeClass = await db.class.create({
    data: { name: "Lớp nhà CS1", courseId: course.id, centerId: c1, status: "ACTIVE" },
    select: { id: true },
  });
  const student = await db.student.create({ data: { name: "HV bù", centerId: c1 }, select: { id: true } });
  const enrollment = await db.enrollment.create({
    data: { studentId: student.id, classId: homeClass.id, courseId: course.id, status: "STUDYING" },
    select: { id: true },
  });
  // Buổi đã lỡ (lessonId=L5, quá khứ) + attendance vắng cần bù.
  const missed = await db.classSession.create({
    data: { classId: homeClass.id, date: daysFromNow(-1), status: "SCHEDULED", lessonId: lessons[5] },
    select: { id: true },
  });
  await db.attendance.create({
    data: { sessionId: missed.id, studentId: student.id, status: "ABSENT", makeupStatus: "NEEDS_MAKEUP" },
  });

  const need = await createMakeupNeed({ studentId: student.id, missedSessionId: missed.id });
  expect(need.ok).toBe(true);

  return {
    c1,
    c2,
    courseId: course.id,
    lessons,
    homeClassId: homeClass.id,
    studentId: student.id,
    enrollmentId: enrollment.id,
    missedSessionId: missed.id,
    needId: need.id!,
  };
}

test.beforeEach(async () => {
  await resetDb();
});

// ─── C1 (AC1) — 6 tiêu chí đề xuất ────────────────────────────────────────────
test("[R7-08-C1] seed 5 buổi ứng viên (vượt tiến độ/đầy/trùng lịch) → chỉ 2 hợp lệ", async () => {
  const base = await seedBase();
  const { actor } = await makeActor("c1csm", "CS1");

  // 2 hợp lệ: cùng lesson L5, tương lai, còn chỗ, không trùng lịch.
  await makeCandidate({ name: "Hợp lệ A", courseId: base.courseId, centerId: base.c2, lessonId: base.lessons[5], date: daysFromNow(3) });
  await makeCandidate({ name: "Hợp lệ B", courseId: base.courseId, centerId: base.c2, lessonId: base.lessons[5], date: daysFromNow(4) });

  // (đầy chỗ) sĩ số = maxStudents → capacityLeft 0 → loại.
  const full = await makeCandidate({ name: "Đầy chỗ", courseId: base.courseId, centerId: base.c2, lessonId: base.lessons[5], date: daysFromNow(5), maxStudents: 1 });
  const filler = await db.student.create({ data: { name: "Filler", centerId: base.c2 }, select: { id: true } });
  await db.enrollment.create({ data: { studentId: filler.id, classId: full.classId, courseId: base.courseId, status: "STUDYING" } });

  // (trùng lịch HV) — buổi nhà tương lai (lesson L6) chiếm ngày +10 → ứng viên cùng ngày bị loại.
  await db.classSession.create({ data: { classId: base.homeClassId, date: daysFromNow(10), status: "SCHEDULED", lessonId: base.lessons[6] } });
  await makeCandidate({ name: "Trùng lịch", courseId: base.courseId, centerId: base.c2, lessonId: base.lessons[5], date: daysFromNow(10) });

  // (vượt tiến độ) lesson order 7 > buổi đã lỡ (5) → loại (cả filter lessonId lẫn order).
  await makeCandidate({ name: "Vượt tiến độ", courseId: base.courseId, centerId: base.c2, lessonId: base.lessons[7], date: daysFromNow(6) });

  const out = await suggestMakeupSessions(base.needId, actor);
  expect(out).toHaveLength(2);
  expect(out.map((s) => s.className).sort()).toEqual(["Hợp lệ A", "Hợp lệ B"]);
  for (const s of out) expect(s.capacityLeft).toBeGreaterThan(0);
});

// ─── C2 (AC2) — sort cơ sở nhà trước → lịch gần nhất ──────────────────────────
test("[R7-08-C2] CS1(+7d) vs CS2(+2d) → CS1 trước, trong CS theo ngày tăng", async () => {
  const base = await seedBase();
  const { actor } = await makeActor("c2csm", "CS1");

  // CS nhà (CS1) ngày xa hơn (+7) vs CS2 ngày gần hơn (+2). CS nhà phải đứng trước.
  await makeCandidate({ name: "Nhà CS1 +7", courseId: base.courseId, centerId: base.c1, lessonId: base.lessons[5], date: daysFromNow(7) });
  await makeCandidate({ name: "CS2 +2", courseId: base.courseId, centerId: base.c2, lessonId: base.lessons[5], date: daysFromNow(2) });

  const out = await suggestMakeupSessions(base.needId, actor);
  expect(out).toHaveLength(2);
  expect(out[0].isHomeCenter).toBe(true); // CS nhà trước dù xa ngày hơn
  expect(out[0].centerId).toBe(base.c1);
  expect(out[1].isHomeCenter).toBe(false);
  expect(out[1].centerId).toBe(base.c2);
});

// ─── C3 (AC3) — duyệt bù chéo cơ sở + AuditLog đủ trường ──────────────────────
test("[R7-08-C3] xếp bù CS1→CS2 → AuditLog MAKEUP_CROSS_CENTER đủ trường", async () => {
  const base = await seedBase();
  const { actor, userId } = await makeActor("c3mgr", "CS1");
  const cs2 = await makeCandidate({ name: "Bù CS2", courseId: base.courseId, centerId: base.c2, lessonId: base.lessons[5], date: daysFromNow(3) });

  const requestId = "REQ-PH-001";
  const res = await scheduleMakeup({
    makeupNeedId: base.needId,
    makeupSessionId: cs2.sessionId,
    scheduledById: userId,
    scheduledByName: "Quản lý CS1",
    actor,
    requestId,
  });
  expect(res.ok).toBe(true);

  const need = await db.makeupNeed.findUniqueOrThrow({ where: { id: base.needId } });
  expect(need.status).toBe("SCHEDULED");
  expect(need.makeupSessionId).toBe(cs2.sessionId);

  const log = await db.auditLog.findFirst({ where: { action: "MAKEUP_CROSS_CENTER" } });
  expect(log).not.toBeNull();
  expect(log?.newValues).toMatchObject({
    studentId: base.studentId,
    fromCenterId: base.c1,
    toCenterId: base.c2,
    sessionId: cs2.sessionId,
    approvedById: userId,
  });
  expect(log?.reason).toBe(requestId);
});

// ─── C4 (AC4) — GV CS2 thấy HS bù đúng 1 buổi, KHÔNG mở hồ sơ HS CS1 ──────────
test("[R7-08-C4] staff@CS2 đọc HS bù qua roster ngoại lệ; hồ sơ HS CS1 → null (IDOR)", async () => {
  // Service-level tương đương UI: roster "Học bù" (makeupNeed theo makeupSessionId)
  // đọc CHÉO cơ sở qua withMakeupException; còn scopedDb chặn mở hồ sơ HS CS1 (404).
  const base = await seedBase();
  const { actor: mgrCs1, userId: u1 } = await makeActor("c4mgr1", "CS1");
  const cs2 = await makeCandidate({ name: "Bù CS2", courseId: base.courseId, centerId: base.c2, lessonId: base.lessons[5], date: daysFromNow(3) });
  await scheduleMakeup({ makeupNeedId: base.needId, makeupSessionId: cs2.sessionId, scheduledById: u1, actor: mgrCs1, requestId: "REQ" });

  const { actor: staffCs2 } = await makeActor("c4cs2", "CS2");

  // (1) roster buổi bù @CS2: staff CS2 THẤY nhu cầu bù của HS CS1 (ngoại lệ whitelist).
  const roster = await withMakeupException(staffCs2).makeupNeed.findMany({
    where: { makeupSessionId: cs2.sessionId },
    select: { studentId: true, centerId: true },
  });
  expect(roster).toHaveLength(1);
  expect(roster[0].studentId).toBe(base.studentId);
  expect(roster[0].centerId).toBe(base.c1); // HS thuộc CS1

  // (2) nhưng KHÔNG mở được hồ sơ đầy đủ HS CS1 → scopedDb trả null (404 IDOR).
  const profile = await scopedDb(staffCs2).student.findUnique({ where: { id: base.studentId } });
  expect(profile).toBeNull();
});

// ─── C5 (AC5) — điểm danh bù → MADE_UP sync + 5 chỉ số đúng ───────────────────
test("[R7-08-C5] hoàn tất bù → Attendance buổi gốc MADE_UP + chỉ số madeUp", async () => {
  const base = await seedBase({ totalSessions: 10 });
  const { actor, userId } = await makeActor("c5mgr", "CS1");
  // Xếp bù (cùng CS1 cho gọn) rồi hoàn tất.
  const cand = await makeCandidate({ name: "Bù CS1", courseId: base.courseId, centerId: base.c1, lessonId: base.lessons[5], date: daysFromNow(3) });
  const sched = await scheduleMakeup({ makeupNeedId: base.needId, makeupSessionId: cand.sessionId, scheduledById: userId, actor });
  expect(sched.ok).toBe(true);

  const done = await completeMakeup(base.needId);
  expect(done.ok).toBe(true);

  const att = await db.attendance.findFirst({ where: { studentId: base.studentId, sessionId: base.missedSessionId } });
  expect(att?.makeupStatus).toBe("MADE_UP");
  expect(att?.makeupSessionId).toBe(cand.sessionId);

  const need = await db.makeupNeed.findUniqueOrThrow({ where: { id: base.needId } });
  expect(need.status).toBe("COMPLETED");
  expect(need.completedAt).not.toBeNull();

  // 5 chỉ số: buổi vắng đã bù → tính madeUp + attended, không còn needMakeup/absent.
  // (bảng biên 48/22/3/1/2 đã phủ thuần ở lib/attendance/summary.test.ts.)
  const sum = await attendanceSummary(base.enrollmentId);
  expect(sum.total).toBe(10);
  expect(sum.madeUp).toBe(1);
  expect(sum.attended).toBe(1);
  expect(sum.needMakeup).toBe(0);
  expect(sum.absent).toBe(0);
});

// ─── C6 (AC6) — exception không rò sang query khác ────────────────────────────
test("[R7-08-C6] sau khi thêm exception, query lead vẫn cách ly cơ sở", async () => {
  const { c1, c2 } = await setupOrg();
  await db.lead.create({ data: { parentName: "Lead CS1", phone: "0900000001", centerId: c1 } });
  await db.lead.create({ data: { parentName: "Lead CS2", phone: "0900000002", centerId: c2 } });
  const { actor } = await makeActor("c6csm", "CS1");

  // withMakeupException CHỈ nới Class/ClassSession/Lesson/MakeupNeed; Lead VẪN scope.
  const leads = await withMakeupException(actor).lead.findMany({ select: { parentName: true } });
  expect(leads.map((l) => l.parentName)).toEqual(["Lead CS1"]);
});

// ─── C7 (AC5) — buổi CANCELLED không tính vắng ────────────────────────────────
test("[R7-08-C7] buổi CANCELLED → không tính vắng (chỉ số absent bỏ qua)", async () => {
  const { c1 } = await setupOrg();
  const course = await db.course.create({ data: { name: "Robot C7", slug: "robot-c7", totalSessions: 10 }, select: { id: true } });
  const cls = await db.class.create({ data: { name: "Lớp C7", courseId: course.id, centerId: c1, status: "ACTIVE" }, select: { id: true } });
  const student = await db.student.create({ data: { name: "HV C7", centerId: c1 }, select: { id: true } });
  const enr = await db.enrollment.create({
    data: { studentId: student.id, classId: cls.id, courseId: course.id, status: "STUDYING" },
    select: { id: true },
  });

  // Buổi thường vắng → tính absent=1. Buổi CANCELLED vắng → KHÔNG tính.
  const sA = await db.classSession.create({ data: { classId: cls.id, date: daysFromNow(-3), status: "SCHEDULED" }, select: { id: true } });
  const sB = await db.classSession.create({ data: { classId: cls.id, date: daysFromNow(-2), status: "CANCELLED" }, select: { id: true } });
  await db.attendance.create({ data: { sessionId: sA.id, studentId: student.id, status: "ABSENT" } });
  await db.attendance.create({ data: { sessionId: sB.id, studentId: student.id, status: "ABSENT" } });

  const sum = await attendanceSummary(enr.id);
  expect(sum.absent).toBe(1); // chỉ buổi thường; buổi CANCELLED bị bỏ qua
});

// ─── C8 (race) — 2 confirm song song chỗ cuối ─────────────────────────────────
// scheduleMakeup khóa pg_advisory_xact_lock theo makeupSessionId → serial-hoá
// count→update (chống phantom của READ COMMITTED). 2 request giành chỗ cuối → đúng
// 1 thành công, người sau "đầy chỗ".
test("[R7-08-C8] 2 confirm song song chỗ cuối → 1 thành công, 1 fail rõ ràng", async () => {
  const base = await seedBase();
  const { actor, userId } = await makeActor("c8mgr", "CS1");

  // Buổi bù CHỈ còn 1 chỗ (maxStudents=1, 0 enrollment) → 2 need không thể cùng vào.
  const cand = await makeCandidate({
    name: "Chỗ cuối",
    courseId: base.courseId,
    centerId: base.c1,
    lessonId: base.lessons[5],
    date: daysFromNow(3),
    maxStudents: 1,
  });

  // need1 = base.needId. Tạo need2 cho HV thứ hai (buổi lỡ riêng) cùng lesson L5.
  const student2 = await db.student.create({ data: { name: "HV bù 2", centerId: base.c1 }, select: { id: true } });
  await db.enrollment.create({
    data: { studentId: student2.id, classId: base.homeClassId, courseId: base.courseId, status: "STUDYING" },
  });
  const missed2 = await db.classSession.create({
    data: { classId: base.homeClassId, date: daysFromNow(-1), status: "SCHEDULED", lessonId: base.lessons[5] },
    select: { id: true },
  });
  await db.attendance.create({
    data: { sessionId: missed2.id, studentId: student2.id, status: "ABSENT", makeupStatus: "NEEDS_MAKEUP" },
  });
  const need2 = await createMakeupNeed({ studentId: student2.id, missedSessionId: missed2.id });
  expect(need2.ok).toBe(true);

  const [a, b] = await Promise.all([
    scheduleMakeup({ makeupNeedId: base.needId, makeupSessionId: cand.sessionId, actor, scheduledById: userId }),
    scheduleMakeup({ makeupNeedId: need2.id!, makeupSessionId: cand.sessionId, actor, scheduledById: userId }),
  ]);

  // Đúng 1 thành công, 1 báo đầy chỗ.
  expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  const loser = a.ok ? b : a;
  expect(loser.error).toContain("đầy chỗ");

  // DB nhất quán: đúng 1 MakeupNeed SCHEDULED vào buổi này.
  const scheduledCount = await db.makeupNeed.count({
    where: { makeupSessionId: cand.sessionId, status: "SCHEDULED" },
  });
  expect(scheduledCount).toBe(1);
});
