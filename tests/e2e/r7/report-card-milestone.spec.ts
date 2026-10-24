/**
 * #17 Gap 1 (câu 55) — mốc học bạ buổi 5 & buổi 12. Postgres LOCAL, DB thật.
 *
 * Lõi thuần (reachedMilestones/missingMilestoneComments/ensureMilestonePeriods) đã phủ
 * ở Vitest `lib/lms/report-card-milestone.test.ts`. Spec này phủ phần CHỈ DB mới lộ:
 * - đếm buổi COMPLETED của lớp (ClassSession không có số thứ tự buổi);
 * - lọc ghi danh theo ENROLLMENT_ACTIVE_STATUS_LIST (không phải status "ACTIVE" trần);
 * - phân vai: GV thấy lớp mình dạy; QL cơ sở thấy lớp cơ sở mình; GV lớp khác không thấy.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { getPendingTasks, type TaskUser } from "../../../lib/pending-tasks";

const CS1 = "CS1";
const CS2 = "CS2";

async function seedCenters() {
  for (const id of [CS1, CS2]) {
    await db.center.upsert({
      where: { id },
      create: { id, name: id, code: id, slug: id.toLowerCase(), address: "test" },
      update: {},
    });
  }
}

/** Lớp + học viên + ghi danh + N buổi COMPLETED (kèm `extraNonCompleted` buổi chưa xong). */
async function seedClassWithSessions(opts: {
  slug: string;
  centerId: string;
  teacherId?: string;
  completed: number;
  extraNonCompleted?: number;
  enrollmentStatus?: "STUDYING" | "COMPLETED";
}) {
  const course = await db.course.create({ data: { name: `Khoá ${opts.slug}`, slug: opts.slug } });
  const cls = await db.class.create({
    data: {
      name: `Lớp ${opts.slug}`,
      classCode: opts.slug.toUpperCase(),
      courseId: course.id,
      centerId: opts.centerId,
      teacherId: opts.teacherId ?? null,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const student = await db.student.create({
    data: { name: `HV ${opts.slug}`, centerId: opts.centerId },
    select: { id: true },
  });
  const enr = await db.enrollment.create({
    data: {
      studentId: student.id,
      classId: cls.id,
      courseId: course.id,
      centerId: opts.centerId,
      status: opts.enrollmentStatus ?? "STUDYING",
    },
    select: { id: true },
  });

  const base = new Date("2026-01-05T09:00:00Z");
  const sessions: { classId: string; date: Date; status: "COMPLETED" | "SCHEDULED"; centerId: string }[] = [];
  for (let i = 0; i < opts.completed; i++) {
    sessions.push({
      classId: cls.id,
      centerId: opts.centerId,
      date: new Date(base.getTime() + i * 86_400_000),
      status: "COMPLETED",
    });
  }
  for (let i = 0; i < (opts.extraNonCompleted ?? 0); i++) {
    sessions.push({
      classId: cls.id,
      centerId: opts.centerId,
      date: new Date(base.getTime() + (opts.completed + i) * 86_400_000),
      status: "SCHEDULED",
    });
  }
  if (sessions.length) await db.classSession.createMany({ data: sessions });

  return { classId: cls.id, enrollmentId: enr.id, studentId: student.id };
}

async function setPeriodComments(enrollmentId: string, periods: { period: string; comment: string }[]) {
  await db.reportCard.upsert({
    where: { enrollmentId },
    create: { enrollmentId, periodComments: periods },
    update: { periodComments: periods },
  });
}

const teacher = (id: string, centerId: string): TaskUser => ({
  id,
  role: "TEACHER",
  roles: ["TEACHER"],
  centerId,
});
const manager = (id: string, centerId: string): TaskUser => ({
  id,
  role: "CENTER_MANAGER",
  roles: ["CENTER_MANAGER"],
  centerId,
});

async function milestoneGroup(user: TaskUser) {
  // Actor thật từ DB (user không có UserOrgRole → v2 rỗng quyền; cờ OFF nên v1 quyết định).
  const groups = await getPendingTasks(user, await resolveActorUncached(user.id));
  return groups.find((g) => g.type === "report_card_milestone") ?? null;
}

test.describe("[#17] mốc học bạ buổi 5 / buổi 12", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedCenters();
  });

  test("[#17-M1] chưa đạt buổi 5 → không nhắc", async () => {
    const gv = await db.user.create({
      data: { email: "gv.m1@t.vn", name: "GV", role: "TEACHER", roles: ["TEACHER"], centerId: CS1 },
      select: { id: true },
    });
    await seedClassWithSessions({ slug: "m1", centerId: CS1, teacherId: gv.id, completed: 4, extraNonCompleted: 3 });

    expect(await milestoneGroup(teacher(gv.id, CS1))).toBeNull();
  });

  test("[#17-M2] đạt buổi 5, chưa viết → nhắc kỳ 1; buổi SCHEDULED không được tính", async () => {
    const gv = await db.user.create({
      data: { email: "gv.m2@t.vn", name: "GV", role: "TEACHER", roles: ["TEACHER"], centerId: CS1 },
      select: { id: true },
    });
    // 5 COMPLETED + 9 SCHEDULED: nếu đếm nhầm cả buổi chưa xong sẽ ra "đạt buổi 12".
    await seedClassWithSessions({ slug: "m2", centerId: CS1, teacherId: gv.id, completed: 5, extraNonCompleted: 9 });

    const g = await milestoneGroup(teacher(gv.id, CS1));
    expect(g?.count).toBe(1);
    expect(g?.items[0]?.label).toContain("Kỳ 1 — buổi 5");
    expect(g?.overdueCount).toBe(0); // chưa tới buổi 12 → chưa trễ hẳn một kỳ
  });

  test("[#17-M3] viết xong kỳ 1 → hết nhắc; comment trắng KHÔNG tính là đã viết", async () => {
    const gv = await db.user.create({
      data: { email: "gv.m3@t.vn", name: "GV", role: "TEACHER", roles: ["TEACHER"], centerId: CS1 },
      select: { id: true },
    });
    const { enrollmentId } = await seedClassWithSessions({
      slug: "m3", centerId: CS1, teacherId: gv.id, completed: 5,
    });

    await setPeriodComments(enrollmentId, [{ period: "SESSION_5", comment: "   " }]);
    expect((await milestoneGroup(teacher(gv.id, CS1)))?.count).toBe(1);

    await setPeriodComments(enrollmentId, [{ period: "SESSION_5", comment: "Em tiến bộ" }]);
    expect(await milestoneGroup(teacher(gv.id, CS1))).toBeNull();
  });

  test("[#17-M4] đạt buổi 12, mới viết kỳ 1 → nhắc kỳ 2 và đánh dấu quá hạn", async () => {
    const gv = await db.user.create({
      data: { email: "gv.m4@t.vn", name: "GV", role: "TEACHER", roles: ["TEACHER"], centerId: CS1 },
      select: { id: true },
    });
    const { enrollmentId } = await seedClassWithSessions({
      slug: "m4", centerId: CS1, teacherId: gv.id, completed: 12,
    });
    await setPeriodComments(enrollmentId, [{ period: "SESSION_5", comment: "ổn" }]);

    const g = await milestoneGroup(teacher(gv.id, CS1));
    expect(g?.count).toBe(1);
    expect(g?.items[0]?.label).toContain("Kỳ 2 — buổi 12");
    expect(g?.overdueCount).toBe(1);
  });

  test("[#17-M5] period tự do cũ KHÔNG thay được kỳ chuẩn", async () => {
    const gv = await db.user.create({
      data: { email: "gv.m5@t.vn", name: "GV", role: "TEACHER", roles: ["TEACHER"], centerId: CS1 },
      select: { id: true },
    });
    const { enrollmentId } = await seedClassWithSessions({
      slug: "m5", centerId: CS1, teacherId: gv.id, completed: 5,
    });
    await setPeriodComments(enrollmentId, [{ period: "Giữa khoá", comment: "nhận xét cũ" }]);

    expect((await milestoneGroup(teacher(gv.id, CS1)))?.count).toBe(1);
  });

  test("[#17-M6] ghi danh STUDYING được tính (status 'ACTIVE' trần sẽ bỏ sót)", async () => {
    const gv = await db.user.create({
      data: { email: "gv.m6@t.vn", name: "GV", role: "TEACHER", roles: ["TEACHER"], centerId: CS1 },
      select: { id: true },
    });
    await seedClassWithSessions({
      slug: "m6", centerId: CS1, teacherId: gv.id, completed: 5, enrollmentStatus: "STUDYING",
    });
    expect((await milestoneGroup(teacher(gv.id, CS1)))?.count).toBe(1);
  });

  test("[#17-M7] ghi danh đã COMPLETED (rời lớp) không nhắc nữa", async () => {
    const gv = await db.user.create({
      data: { email: "gv.m7@t.vn", name: "GV", role: "TEACHER", roles: ["TEACHER"], centerId: CS1 },
      select: { id: true },
    });
    await seedClassWithSessions({
      slug: "m7", centerId: CS1, teacherId: gv.id, completed: 12, enrollmentStatus: "COMPLETED",
    });
    expect(await milestoneGroup(teacher(gv.id, CS1))).toBeNull();
  });

  test("[#17-M8] phân vai: GV chỉ thấy lớp MÌNH dạy", async () => {
    const [gvA, gvB] = await Promise.all([
      db.user.create({ data: { email: "gv.a@t.vn", name: "A", role: "TEACHER", roles: ["TEACHER"], centerId: CS1 }, select: { id: true } }),
      db.user.create({ data: { email: "gv.b@t.vn", name: "B", role: "TEACHER", roles: ["TEACHER"], centerId: CS1 }, select: { id: true } }),
    ]);
    await seedClassWithSessions({ slug: "lopa", centerId: CS1, teacherId: gvA.id, completed: 5 });

    expect((await milestoneGroup(teacher(gvA.id, CS1)))?.count).toBe(1);
    expect(await milestoneGroup(teacher(gvB.id, CS1))).toBeNull();
  });

  test("[#17-M9] phân vai: QL cơ sở thấy lớp cơ sở mình, KHÔNG thấy cơ sở khác", async () => {
    const gv = await db.user.create({
      data: { email: "gv.m9@t.vn", name: "GV", role: "TEACHER", roles: ["TEACHER"], centerId: CS2 },
      select: { id: true },
    });
    await seedClassWithSessions({ slug: "m9", centerId: CS2, teacherId: gv.id, completed: 5 });

    const qlCs2 = await milestoneGroup(manager("ql-cs2", CS2));
    expect(qlCs2?.count).toBe(1);

    const qlCs1 = await milestoneGroup(manager("ql-cs1", CS1));
    expect(qlCs1).toBeNull();
  });

  test("[#17-M10] không có role liên quan → không thấy nhóm việc này", async () => {
    const gv = await db.user.create({
      data: { email: "gv.m10@t.vn", name: "GV", role: "TEACHER", roles: ["TEACHER"], centerId: CS1 },
      select: { id: true },
    });
    await seedClassWithSessions({ slug: "m10", centerId: CS1, teacherId: gv.id, completed: 5 });

    const sale: TaskUser = { id: "sale-1", role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS1 };
    expect(await milestoneGroup(sale)).toBeNull();
  });
});
