// #06 L6 (câu 47/50/46) — điểm danh site GV: guard sở hữu buổi + makeup liên cơ sở +
// không lộ contact PH. Kiểm TẦNG DỮ LIỆU (guard + roster) — đúng cơ chế mà
// saveClassAttendanceAction dùng: withMakeupException nạp buổi + isSessionOwnedByTeacher
// gác quyền sở hữu. Postgres LOCAL, không cần dev server.
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { actorGiangDay, scopedDb, withMakeupException } from "../../../lib/db-scope";
import { isSessionOwnedByTeacher } from "../../../lib/lms/session-ownership";
import { buildSessionAttendanceRows } from "../../../lib/attendance/roster";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerIdOf(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function makeClass(ctr: string, teacherId: string) {
  const rand = Math.random().toString(36).slice(2, 8);
  const course = await db.course.create({ data: { name: `Khoá ${rand}`, slug: `ka-${rand}` }, select: { id: true } });
  return db.class.create({
    data: { name: `Lớp ${rand}`, courseId: course.id, centerId: ctr, teacherId, status: "ACTIVE" },
    select: { id: true, courseId: true },
  });
}
async function makeSession(
  classId: string,
  ctr: string,
  extra: { substituteTeacherId?: string; actualTeacherId?: string } = {},
) {
  return db.classSession.create({
    data: { classId, centerId: ctr, date: new Date("2026-08-01T02:00:00Z"), status: "SCHEDULED", ...extra },
    select: { id: true },
  });
}
const ownerArgs = (s: { classId: string; substituteTeacherId: string | null; actualTeacherId: string | null }) => s;

test.describe("[#06-L6] teacher attendance guard + makeup liên cơ sở", () => {
  let c1 = "", c2 = "";
  let gv1 = { id: "" }, gv2 = { id: "" };
  let cls1: { id: string; courseId: string };
  let cls2: { id: string; courseId: string };
  let actorGv1: Awaited<ReturnType<typeof resolveActorUncached>>;

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-att", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-att", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    c1 = await centerIdOf("CS1");
    c2 = await centerIdOf("CS2");
    gv1 = await seedUser({ email: testEmail("gv1-att"), role: "TEACHER", centerId: c1 });
    gv2 = await seedUser({ email: testEmail("gv2-att"), role: "TEACHER", centerId: c2 });
    const teacherRoleId = (await db.roleDef.findUnique({ where: { code: "TEACHER" }, select: { id: true } }))!.id;
    await assignUserOrgRole(SA, { userId: gv1.id, orgUnitId: await orgId("CS1"), roleId: teacherRoleId, reason: "seed" });
    await assignUserOrgRole(SA, { userId: gv2.id, orgUnitId: await orgId("CS2"), roleId: teacherRoleId, reason: "seed" });
    // Lớp phải tồn tại TRƯỚC resolveActor (assignedClassIds tính lúc resolve).
    cls1 = await makeClass(c1, gv1.id); // lớp GV1 @ CS1
    cls2 = await makeClass(c2, gv2.id); // lớp GV2 @ CS2
    actorGv1 = await resolveActorUncached(gv1.id);
  });

  test("[câu 50] GV nạp + sở hữu buổi lớp MÌNH → cho điểm danh", async () => {
    const s = await makeSession(cls1.id, c1);
    const loaded = await withMakeupException(actorGv1).classSession.findUnique({
      where: { id: s.id },
      select: { classId: true, substituteTeacherId: true, actualTeacherId: true },
    });
    expect(loaded).not.toBeNull();
    expect(isSessionOwnedByTeacher(ownerArgs(loaded!), { userId: gv1.id, assignedClassIds: actorGv1.assignedClassIds })).toBe(true);
  });

  test("[câu 50] GV KHÔNG sở hữu buổi lớp GV KHÁC → guard chặn (dù nạp được)", async () => {
    const s = await makeSession(cls2.id, c2);
    // withMakeupException bỏ lọc cơ sở nên nạp được — nhưng ownership sai ⇒ chặn.
    const loaded = await withMakeupException(actorGv1).classSession.findUnique({
      where: { id: s.id },
      select: { classId: true, substituteTeacherId: true, actualTeacherId: true },
    });
    expect(loaded).not.toBeNull();
    expect(isSessionOwnedByTeacher(ownerArgs(loaded!), { userId: gv1.id, assignedClassIds: actorGv1.assignedClassIds })).toBe(false);
  });

  test("[câu 47] GV dạy thay buổi CƠ SỞ KHÁC: scopedDb ẩn, withMakeupException hiện + sở hữu đúng", async () => {
    const s = await makeSession(cls2.id, c2, { substituteTeacherId: gv1.id });
    // scopedDb: GV1 chỉ thấy CS1 ⇒ buổi CS2 bị ẩn (chứng minh vì sao cần exception).
    expect(await scopedDb(actorGv1).classSession.findUnique({ where: { id: s.id } })).toBeNull();
    // withMakeupException: nạp được buổi cơ sở khác GV dạy thay.
    const loaded = await withMakeupException(actorGv1).classSession.findUnique({
      where: { id: s.id },
      select: { classId: true, substituteTeacherId: true, actualTeacherId: true },
    });
    expect(loaded).not.toBeNull();
    expect(isSessionOwnedByTeacher(ownerArgs(loaded!), { userId: gv1.id, assignedClassIds: actorGv1.assignedClassIds })).toBe(true);
  });

  test("[câu 46] roster điểm danh KHÔNG lộ SĐT/tên phụ huynh", async () => {
    const student = await db.student.create({
      data: { name: "HS Test", centerId: c1, parentName: "Phụ Huynh X", parentPhone: "0999888777" },
      select: { id: true },
    });
    await db.enrollment.create({
      data: { studentId: student.id, classId: cls1.id, courseId: cls1.courseId, status: "STUDYING" },
    });
    const s = await makeSession(cls1.id, c1);

    const { rows } = await buildSessionAttendanceRows(actorGv1, s.id);
    const row = rows.find((r) => r.studentId === student.id);
    expect(row).toBeTruthy();
    expect(row!.studentName).toBe("HS Test");
    // Không field nào của row chứa contact phụ huynh.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("0999888777");
    expect(serialized).not.toContain("Phụ Huynh X");
  });
});

// ── 28/09/2026 — GV neo vai tại MỘT cơ sở nhưng được PHÂN DẠY lớp ở cơ sở KHÁC ──────
// Sự cố prod: giáo viên Hội sở được "gán cơ sở" CS1, dạy một lớp ở CS2 ⇒ lưu điểm danh
// được (đường ghi dùng db trần) nhưng site GV đọc lớp/buổi/điểm danh qua scopedDb ⇒ trang
// chủ không hiện lớp, màn điểm danh mãi báo "chưa điểm danh" dù đã lưu. Luật: trên SITE GV,
// cơ sở của lớp mình được phân dạy là cơ sở mình (actorGiangDay). Màn admin KHÔNG đổi.
test.describe("[GD-CS] GV dạy lớp ở cơ sở khác cơ sở neo vai", () => {
  let c1 = "", c2 = "";
  let gv1 = { id: "" };
  let lopCs2: { id: string; courseId: string };

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-gd", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-gd", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    c1 = await centerIdOf("CS1");
    c2 = await centerIdOf("CS2");
    gv1 = await seedUser({ email: testEmail("gv1-gd"), role: "TEACHER", centerId: c1 });
    const teacherRoleId = (await db.roleDef.findUnique({ where: { code: "TEACHER" }, select: { id: true } }))!.id;
    await assignUserOrgRole(SA, { userId: gv1.id, orgUnitId: await orgId("CS1"), roleId: teacherRoleId, reason: "seed" });
    lopCs2 = await makeClass(c2, gv1.id); // GV neo CS1 nhưng ĐỨNG LỚP ở CS2
  });

  async function hocVienTrongLop(ctr: string, classId: string, courseId: string) {
    const st = await db.student.create({ data: { name: "HS CS2", centerId: ctr }, select: { id: true } });
    await db.enrollment.create({
      data: { studentId: st.id, classId, courseId, centerId: ctr, status: "STUDYING" },
    });
    return st.id;
  }

  test("[GD-CS-01] site GV thấy buổi, ghi danh, học viên, điểm danh của lớp mình ở cơ sở khác", async () => {
    const hs = await hocVienTrongLop(c2, lopCs2.id, lopCs2.courseId);
    const s = await makeSession(lopCs2.id, c2);
    await db.attendance.create({ data: { sessionId: s.id, studentId: hs, status: "PRESENT", centerId: c2 } });

    const actor = await resolveActorUncached(gv1.id);
    const gd = actorGiangDay(actor);
    for (const cli of [scopedDb(gd), withMakeupException(gd)]) {
      expect(await cli.class.findMany({ where: { id: lopCs2.id }, select: { id: true } })).toHaveLength(1);
      expect(await cli.classSession.findMany({ where: { classId: lopCs2.id }, select: { id: true } })).toHaveLength(1);
      expect(await cli.attendance.findMany({ where: { sessionId: s.id }, select: { id: true } })).toHaveLength(1);
      expect(await cli.enrollment.findMany({ where: { classId: lopCs2.id }, select: { id: true } })).toHaveLength(1);
      expect(await cli.student.findUnique({ where: { id: hs }, select: { id: true } })).not.toBeNull();
    }
  });

  test("[GD-CS-02] đối chứng: scopedDb thường (màn admin) VẪN ẩn cơ sở khác — không nới ngoài site GV", async () => {
    const hs = await hocVienTrongLop(c2, lopCs2.id, lopCs2.courseId);
    const s = await makeSession(lopCs2.id, c2);
    await db.attendance.create({ data: { sessionId: s.id, studentId: hs, status: "PRESENT", centerId: c2 } });
    const actor = await resolveActorUncached(gv1.id);
    const sdb = scopedDb(actor);
    expect(await sdb.classSession.findMany({ where: { classId: lopCs2.id } })).toHaveLength(0);
    expect(await sdb.attendance.findMany({ where: { sessionId: s.id } })).toHaveLength(0);
    expect(await sdb.student.findUnique({ where: { id: hs } })).toBeNull();
  });

  test("[GD-CS-03] GV KHÔNG dạy lớp nào ở CS2 ⇒ góc nhìn giảng dạy không mở CS2", async () => {
    await db.class.update({ where: { id: lopCs2.id }, data: { teacherId: null } });
    const hs = await hocVienTrongLop(c2, lopCs2.id, lopCs2.courseId);
    const actor = await resolveActorUncached(gv1.id);
    const gd = scopedDb(actorGiangDay(actor));
    expect(await gd.class.findMany({ where: { id: lopCs2.id } })).toHaveLength(0);
    expect(await gd.student.findUnique({ where: { id: hs } })).toBeNull();
  });

  test("[GD-CS-04] góc nhìn giảng dạy KHÔNG mở model ngoài đào tạo (Lead/Order của CS2)", async () => {
    await db.lead.create({ data: { parentName: "PH CS2", phone: "0900000002", centerId: c2 } });
    const actor = await resolveActorUncached(gv1.id);
    expect(await scopedDb(actorGiangDay(actor)).lead.findMany({ where: { centerId: c2 } })).toHaveLength(0);
  });
});
