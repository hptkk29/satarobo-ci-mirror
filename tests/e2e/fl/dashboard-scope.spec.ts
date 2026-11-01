/**
 * #10 (Dashboard đa vai trò) — cách ly cơ sở cho MỌI số liệu panel Quản lý (câu 16) +
 * khu "Cần xử lý". Postgres LOCAL (KHÔNG Supabase). Mẫu theo fl/enrollment-session-scope.
 *
 * Mục tiêu: CENTER_MANAGER @ CS1 chỉ thấy dữ liệu CS1, KHÔNG CS2, qua từng helper #10:
 *  - getRevenueTargets(actor)            → mục tiêu doanh thu (scope TAY visibleCenterIds).
 *  - sdb.payment (doanh thu THỰC)        + buildRevenueTargetReport → actual chỉ CS1.
 *  - sdb.classSession hôm nay            → GV đứng lớp hôm nay chỉ CS1.
 *  - sdb.lead + groupByWeek              → phễu lead theo tuần chỉ CS1.
 *  - getDebtRows(sdb)                    → công nợ chỉ CS1.
 *  - getPendingTasks(TaskUser)           → class_no_teacher / registered_stale /
 *                                          parent_request chỉ đếm CS1.
 * SUPER_ADMIN thấy cả 2 (đối chứng bypass).
 *
 * ⚠️ Phụ thuộc seed như fl/enrollment-session-scope: cần OrgUnit + RoleDef + centerId
 * denormalized trên Enrollment/ClassSession/Payment (đã flip SCOPED_MODELS). Chạy trên
 * DB test đã migrate + seed-roles.
 */
import { test, expect } from "@playwright/test";
import type { Role } from "@prisma/client";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached, type Actor } from "../../../lib/auth/actor";
import { scopedDb } from "../../../lib/db-scope";
import { getRevenueTargets } from "../../../lib/reports/revenue-target-data";
import { groupByWeek, monthKeyVN, type LeadReportRecord } from "../../../lib/reports/lead";
import { buildRevenueTargetReport } from "../../../lib/reports/revenue-target";
import { getDebtRows } from "../../../lib/finance/debt";
import { getPendingTasks, type TaskUser } from "../../../lib/pending-tasks";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
/** Tạo user (base role = roleCode) + gán RoleDef tại orgUnit → resolve Actor RBAC v2. */
async function makeUser(email: string, orgCode: string, roleCode: string): Promise<{ id: string; actor: Actor }> {
  const u = await seedUser({ email: testEmail(email), role: roleCode as Role });
  const r = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return { id: u.id, actor: await resolveActorUncached(u.id) };
}

const now = new Date();
const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const dayEnd = new Date(dayStart);
dayEnd.setDate(dayEnd.getDate() + 1);
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 86_400_000);
const period = monthKeyVN(now);

/** GV đứng lớp hôm nay (giống logic manager-dashboard): distinct actual ?? class.teacher. */
async function teachersToday(actor: Actor): Promise<Set<string>> {
  const rows = await scopedDb(actor).classSession.findMany({
    where: { date: { gte: dayStart, lt: dayEnd } },
    select: { actualTeacherId: true, class: { select: { teacherId: true } } },
  });
  const set = new Set<string>();
  for (const s of rows) {
    const tid = s.actualTeacherId ?? s.class?.teacherId ?? null;
    if (tid) set.add(tid);
  }
  return set;
}

/** Tổng lead trong cửa sổ phễu tuần (8 tuần) theo scope actor. */
async function weeklyLeadTotal(actor: Actor): Promise<number> {
  const leads = await scopedDb(actor).lead.findMany({
    where: { deletedAt: null, createdAt: { gte: eightWeeksAgo } },
    select: { createdAt: true, status: true },
  });
  const recs: LeadReportRecord[] = leads.map((l) => ({
    status: l.status, source: null, centerId: null, commissionSource: null, createdAt: l.createdAt,
  }));
  return groupByWeek(recs, 8, now).reduce((s, w) => s + w.total, 0);
}

test.describe("[#10] Dashboard đa vai trò — cách ly cơ sở panel Quản lý + Cần xử lý", () => {
  let c1 = "", c2 = "";
  let teacherC1 = "", teacherC2 = "";
  let cmCs1Id = "";

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-dsc", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-dsc", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    c1 = await centerId("CS1");
    c2 = await centerId("CS2");

    const course = await db.course.create({ data: { name: "Sata 1", slug: "sata-1-dsc" } });

    for (const [tag, ctr] of [["c1", c1], ["c2", c2]] as const) {
      // GV của cơ sở + lớp có GV + buổi HÔM NAY (GV đứng lớp hôm nay).
      const teacher = await seedUser({ email: testEmail(`gv-${tag}`), role: "TEACHER" });
      if (tag === "c1") teacherC1 = teacher.id; else teacherC2 = teacher.id;
      const clsWithTeacher = await db.class.create({
        data: { name: `Lop-GV-${tag}`, courseId: course.id, centerId: ctr, teacherId: teacher.id },
      });
      await db.classSession.create({ data: { classId: clsWithTeacher.id, date: now, centerId: ctr } });

      // Lớp CHƯA có GV + buổi NGÀY MAI (pending class_no_teacher).
      const clsNoTeacher = await db.class.create({
        data: { name: `Lop-NoGV-${tag}`, courseId: course.id, centerId: ctr, teacherId: null },
      });
      await db.classSession.create({ data: { classId: clsNoTeacher.id, date: tomorrow, centerId: ctr } });

      // HS + ghi danh (finalPrice) + Order + Payment CONFIRMED (công nợ + doanh thu thực).
      const student = await db.student.create({ data: { name: `HS-${tag}`, centerId: ctr } });
      const enr = await db.enrollment.create({
        data: { studentId: student.id, classId: clsWithTeacher.id, courseId: course.id, centerId: ctr, finalPrice: 2_000_000, tuition: 2_000_000 },
      });
      const order = await db.order.create({
        data: { code: `ORD-${tag}`, type: "COURSE", customerName: `KH-${tag}`, customerPhone: "0900000000", centerId: ctr, studentId: student.id },
      });
      await db.payment.create({
        data: { orderId: order.id, enrollmentId: enr.id, amount: 500_000, method: "cash", paidDate: now, accountantStatus: "CONFIRMED", centerId: ctr },
      });

      // Mục tiêu doanh thu kỳ hiện tại (RevenueTarget — SCOPE_EXEMPT, scope TAY).
      await db.revenueTarget.create({ data: { centerId: ctr, period, targetAmount: 10_000_000 } });

      // 2 lead mới (phễu tuần) + 1 lead DA_DANG_KY tồn quá lâu (registered_stale).
      await db.lead.create({ data: { parentName: `PH1-${tag}`, phone: "0911111111", centerId: ctr, status: "MOI", createdAt: now } });
      await db.lead.create({ data: { parentName: `PH2-${tag}`, phone: "0922222222", centerId: ctr, status: "MOI", createdAt: now } });
      const reg = await db.lead.create({
        data: { parentName: `PH-REG-${tag}`, phone: "0933333333", childName: `Con-${tag}`, centerId: ctr, status: "DA_DANG_KY", createdAt: fiveDaysAgo },
      });
      // Backdate CẢ HAI cột, và `statusChangedAt` mới là cột quyết định.
      //
      // ⚠️ `updatedAt` là `@updatedAt` (Prisma tự set now), còn `statusChangedAt` là
      // `@default(now())` — nên lead vừa tạo KHÔNG BAO GIỜ có `statusChangedAt = NULL`.
      // `registeredStale` đọc:
      //     OR: [ statusChangedAt < mốc , (statusChangedAt IS NULL AND updatedAt < mốc) ]
      // Nhánh dự phòng `IS NULL` viết cho lead CŨ có sẵn trên prod, không cứu được lead
      // seed ra ở đây. Backdate mỗi `updatedAt` ⇒ cả hai nhánh cùng trượt ⇒ nhóm đếm 0,
      // và triệu chứng trông y hệt "không có việc tồn đọng nào" chứ không giống lỗi.
      await db.$executeRaw`UPDATE "Lead" SET "updatedAt" = ${fiveDaysAgo}, "statusChangedAt" = ${fiveDaysAgo} WHERE id = ${reg.id}`;

      // Yêu cầu phụ huynh PENDING (pending parent_request).
      await db.parentRequest.create({
        data: { studentId: student.id, type: "OTHER", content: `req-${tag}`, status: "PENDING" },
      });
    }
  });

  test("[#10-T1] getRevenueTargets — CM@CS1 chỉ mục tiêu CS1", async () => {
    const { actor } = await makeUser("cm1-rt", "CS1", "CENTER_MANAGER");
    const targets = await getRevenueTargets(actor);
    expect(targets.map((t) => t.centerId)).toEqual([c1]);
  });

  test("[#10-T2] Doanh thu THỰC vs mục tiêu — CM@CS1 actual chỉ CS1 (500k, không 1tr)", async () => {
    const { actor } = await makeUser("cm1-rev", "CS1", "CENTER_MANAGER");
    const payments = await scopedDb(actor).payment.findMany({
      where: { accountantStatus: "CONFIRMED", deletedAt: null },
      select: { amount: true, centerId: true, paidDate: true },
    });
    const targets = await getRevenueTargets(actor);
    const report = buildRevenueTargetReport(
      payments.map((p) => ({ amount: p.amount, centerId: p.centerId, paidDate: p.paidDate })),
      targets,
    );
    const row = report.find((r) => r.period === period);
    expect(row?.actual).toBe(500_000); // CHỈ CS1 (nếu leak CS2 sẽ là 1_000_000)
    expect(row?.target).toBe(10_000_000);
  });

  test("[#10-T3] GV đứng lớp hôm nay — CM@CS1 chỉ GV CS1", async () => {
    const { actor } = await makeUser("cm1-gv", "CS1", "CENTER_MANAGER");
    const set = await teachersToday(actor);
    expect([...set]).toEqual([teacherC1]);
    expect(set.has(teacherC2)).toBe(false);
  });

  test("[#10-T4] Phễu lead theo tuần — CM@CS1 chỉ lead CS1 (3, không 6)", async () => {
    const { actor } = await makeUser("cm1-week", "CS1", "CENTER_MANAGER");
    expect(await weeklyLeadTotal(actor)).toBe(3); // 2 NEW + 1 REGISTERED của CS1
  });

  test("[#10-T5] Công nợ (getDebtRows) — CM@CS1 chỉ ghi danh CS1", async () => {
    const { actor } = await makeUser("cm1-debt", "CS1", "CENTER_MANAGER");
    const rows = await getDebtRows(scopedDb(actor) as unknown as Parameters<typeof getDebtRows>[0]);
    expect(rows.map((r) => r.centerId)).toEqual([c1]);
    expect(rows[0]?.debt).toBe(1_500_000); // finalPrice 2tr − đã thu 500k
  });

  test("[#10-T6] Cần xử lý — CM@CS1: class_no_teacher / registered_stale / parent_request chỉ CS1", async () => {
    await makeUser("cm1-pend", "CS1", "CENTER_MANAGER"); // gán RoleDef (legacy can() dùng role)
    cmCs1Id = (await db.user.findUnique({ where: { email: testEmail("cm1-pend") }, select: { id: true } }))!.id;
    const taskUser: TaskUser = { id: cmCs1Id, role: "CENTER_MANAGER", centerId: c1 };
    const groups = await getPendingTasks(taskUser, await resolveActorUncached(cmCs1Id));
    const by = (t: string) => groups.find((g) => g.type === t);

    expect(by("class_no_teacher")?.count).toBe(1);
    expect(by("registered_stale")?.count).toBe(1);
    expect(by("parent_request")?.count).toBe(1);
    // click-through href có sẵn (nguồn mới không phá contract).
    expect(by("class_no_teacher")?.items[0]?.href).toMatch(/^\/sessions\//);
    expect(by("registered_stale")?.items[0]?.href).toMatch(/^\/leads\//);
  });

  test("[#10-T7] SUPER_ADMIN — đối chứng cross-center thấy cả CS1+CS2", async () => {
    const { actor } = await makeUser("sa-dsc", "HO", "SUPER_ADMIN");
    // Doanh thu thực toàn hệ = 1tr (500k×2); GV hôm nay = 2; phễu tuần = 6; công nợ 2 ghi danh.
    const payments = await scopedDb(actor).payment.findMany({
      where: { accountantStatus: "CONFIRMED", deletedAt: null }, select: { amount: true },
    });
    expect(payments.reduce((s, p) => s + p.amount, 0)).toBe(1_000_000);
    expect((await teachersToday(actor)).size).toBe(2);
    expect(await weeklyLeadTotal(actor)).toBe(6);
    const debt = await getDebtRows(scopedDb(actor) as unknown as Parameters<typeof getDebtRows>[0]);
    expect(debt.length).toBe(2);
  });
});
