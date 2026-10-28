// (b) 10/07 — hội thoại THEO HỌC VIÊN: HV chuyển lớp/cơ sở không mất liền mạch 2 phía.
// Test tầng service + entitlement (sdb.student = tiền lệ câu 20). Postgres LOCAL.
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { scopedDb } from "../../../lib/db-scope";
import {
  countUnreadForParentByStudent,
  getThreadForStudent,
  listStudentThreadSummaries,
  markStudentThreadRead,
  postMessage,
} from "../../../lib/conversation/service";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerIdOf(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function makeManager(email: string, orgCode: string) {
  const u = await seedUser({ email: testEmail(email), role: "CENTER_MANAGER" });
  const r = (await db.roleDef.findUnique({ where: { code: "CENTER_MANAGER" }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return resolveActorUncached(u.id);
}

test.describe("[(b)] hội thoại theo học viên — chuyển cơ sở không mất liền mạch", () => {
  let c1 = "", c2 = "";
  let parentId = "", staffId = "", studentId = "";
  let classAId = "", classBId = "";

  test.beforeEach(async () => {
    await resetDb();
    await db.center.upsert({
      where: { code: "CS1" },
      create: { code: "CS1", name: "CS1", slug: "cs1-conv", address: "a", city: "" },
      update: {},
    });
    await db.center.upsert({
      where: { code: "CS2" },
      create: { code: "CS2", name: "CS2", slug: "cs2-conv", address: "b", city: "" },
      update: {},
    });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    c1 = await centerIdOf("CS1");
    c2 = await centerIdOf("CS2");

    const parent = await seedUser({ email: testEmail("ph-conv"), role: "PARENT" });
    parentId = parent.id;
    const staff = await seedUser({ email: testEmail("gv-conv"), role: "TEACHER", centerId: c1 });
    staffId = staff.id;

    const student = await db.student.create({
      data: { name: "HV Chuyển", centerId: c1, parentUserId: parentId },
      select: { id: true },
    });
    studentId = student.id;

    const rand = Math.random().toString(36).slice(2, 8);
    const course = await db.course.create({ data: { name: `K ${rand}`, slug: `kc-${rand}` }, select: { id: true } });
    const clsA = await db.class.create({
      data: { name: "Lớp A (CS1)", courseId: course.id, centerId: c1, status: "ACTIVE" },
      select: { id: true },
    });
    classAId = clsA.id;
    const e1 = await db.enrollment.create({
      data: { studentId, classId: clsA.id, courseId: course.id, centerId: c1, status: "STUDYING" },
      select: { id: true },
    });

    // Trao đổi ở CS1: 1 tin PH (staff chưa đọc) + 1 tin GV (PH chưa đọc).
    await postMessage({ enrollmentId: e1.id, authorUserId: parentId, authorSide: "PARENT", body: "Bé hay nghỉ thứ 7, nhờ cô lưu ý" });
    await postMessage({ enrollmentId: e1.id, authorUserId: staffId, authorSide: "STAFF", body: "Trung tâm đã ghi nhận, cảm ơn chị" });

    // CHUYỂN CƠ SỞ (mirror lib/transfer/service.ts): enrollment mới CS2 + e1 TRANSFERRED
    // + Student.centerId → CS2.
    const clsB = await db.class.create({
      data: { name: "Lớp B (CS2)", courseId: course.id, centerId: c2, status: "ACTIVE" },
      select: { id: true },
    });
    classBId = clsB.id;
    const e2 = await db.enrollment.create({
      data: { studentId, classId: clsB.id, courseId: course.id, centerId: c2, status: "STUDYING" },
      select: { id: true },
    });
    await db.enrollment.update({ where: { id: e1.id }, data: { status: "TRANSFERRED" } });
    await db.student.update({ where: { id: studentId }, data: { centerId: c2 } });

    // PH nhắn tiếp trên luồng mới (CS2) — staff CS2 chưa đọc.
    await postMessage({ enrollmentId: e2.id, authorUserId: parentId, authorSide: "PARENT", body: "Bên cơ sở mới lịch học thế nào ạ?" });
  });

  test("[B-01] getThreadForStudent gộp đủ 3 tin qua 2 enrollment, đúng thứ tự + nhãn lớp", async () => {
    const thread = await getThreadForStudent(studentId);
    expect(thread.map((m) => m.body)).toEqual([
      "Bé hay nghỉ thứ 7, nhờ cô lưu ý",
      "Trung tâm đã ghi nhận, cảm ơn chị",
      "Bên cơ sở mới lịch học thế nào ạ?",
    ]);
    expect(thread.map((m) => m.className)).toEqual(["Lớp A (CS1)", "Lớp A (CS1)", "Lớp B (CS2)"]);
  });

  test("[B-02] câu 19 — GV giới hạn classIds chỉ thấy luồng lớp mình", async () => {
    const onlyB = await getThreadForStudent(studentId, { classIds: [classBId] });
    expect(onlyB.length).toBe(1);
    expect(onlyB[0].className).toBe("Lớp B (CS2)");
    const onlyA = await getThreadForStudent(studentId, { classIds: [classAId] });
    expect(onlyA.length).toBe(2);
  });

  test("[B-03] entitlement câu 20 — CM cơ sở TIẾP NHẬN thấy HV (đọc full), CM cơ sở cũ mất", async () => {
    const cm2 = await makeManager("cm2-conv", "CS2");
    const cm1 = await makeManager("cm1-conv", "CS1");
    // Student.centerId = CS2 → sdb CS2 thấy, CS1 không (HV đã rời).
    expect(await scopedDb(cm2).student.findUnique({ where: { id: studentId } })).not.toBeNull();
    expect(await scopedDb(cm1).student.findUnique({ where: { id: studentId } })).toBeNull();
  });

  test("[B-04] markStudentThreadRead(STAFF) phủ MỌI enrollment + badge PH theo học viên", async () => {
    // Trước: 2 tin PARENT chưa đọc (1 ở e1 CS1 + 1 ở e2 CS2).
    const before = await listStudentThreadSummaries([studentId]);
    expect(before.get(studentId)?.unreadFromParent).toBe(2);

    const marked = await markStudentThreadRead(studentId, "STAFF");
    expect(marked).toBe(2);
    const after = await listStudentThreadSummaries([studentId]);
    expect(after.get(studentId)?.unreadFromParent).toBe(0);

    // Badge phía PH: 1 tin STAFF (ở lớp cũ) chưa đọc — vẫn đếm dù enrollment TRANSFERRED.
    const parentUnread = await countUnreadForParentByStudent(parentId);
    expect(parentUnread.get(studentId)).toBe(1);
    await markStudentThreadRead(studentId, "PARENT");
    expect((await countUnreadForParentByStudent(parentId)).get(studentId)).toBeUndefined();
  });

  test("[B-05] summaries: lastMessageAt = tin mới nhất (luồng CS2); GV lớp A không đếm tin lớp B", async () => {
    const all = await listStudentThreadSummaries([studentId]);
    const thread = await getThreadForStudent(studentId);
    expect(all.get(studentId)?.lastMessageAt?.getTime()).toBe(
      thread[thread.length - 1].createdAt.getTime(),
    );
    // GV lớp A: chỉ 1 tin PARENT chưa đọc trong lớp mình.
    const scoped = await listStudentThreadSummaries([studentId], { classIds: [classAId] });
    expect(scoped.get(studentId)?.unreadFromParent).toBe(1);
  });
});
