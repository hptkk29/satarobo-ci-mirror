/**
 * #03 — portalDb cách ly SỞ HỮU trên DB thật (Postgres local).
 *
 * Kịch bản chuẩn: phụ huynh A (2 con) vs phụ huynh B (1 con). Mọi đường đọc qua
 * portalDb(A) không được thấy dữ liệu con của B — kể cả khi query QUÊN neo studentId
 * (đó chính là lý do tồn tại của lớp này).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { portalDb, type PortalOwner } from "../../../lib/portal/db";

const CS1 = "CS1";

async function seedWorld() {
  await db.center.upsert({
    where: { id: CS1 },
    create: { id: CS1, name: CS1, code: CS1, slug: "cs1", address: "test" },
    update: {},
  });
  const pa = await seedUser({ email: testEmail("parent-a"), role: "PARENT" });
  const pb = await seedUser({ email: testEmail("parent-b"), role: "PARENT" });

  const mk = (name: string, parentUserId: string) =>
    db.student.create({ data: { name, parentUserId, centerId: CS1 }, select: { id: true } });
  const [a1, a2, b1] = await Promise.all([mk("Con A1", pa.id), mk("Con A2", pa.id), mk("Con B1", pb.id)]);

  const course = await db.course.create({ data: { name: "Khoá P", slug: "khoa-p" } });
  const cls = await db.class.create({
    data: { name: "Lớp P", courseId: course.id, centerId: CS1, status: "ACTIVE" },
    select: { id: true },
  });
  const enroll = (studentId: string) =>
    db.enrollment.create({
      data: { studentId, classId: cls.id, courseId: course.id, centerId: CS1, status: "STUDYING" },
      select: { id: true },
    });
  const [ea1, eb1] = await Promise.all([enroll(a1.id), enroll(b1.id)]);

  const ownerA: PortalOwner = { parentUserId: pa.id, childIds: [a1.id, a2.id] };
  const ownerB: PortalOwner = { parentUserId: pb.id, childIds: [b1.id] };
  return { pa, pb, a1, a2, b1, cls, ea1, eb1, ownerA, ownerB };
}

test.describe("[#03] portalDb — cách ly sở hữu phụ huynh", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[P-1] query QUÊN neo studentId vẫn chỉ thấy con mình (chính là belt)", async () => {
    const w = await seedWorld();
    const pdb = portalDb(w.ownerA);

    const students = await pdb.student.findMany({}); // không where
    expect(students.map((s) => s.id).sort()).toEqual([w.a1.id, w.a2.id].sort());

    const enrollments = await pdb.enrollment.findMany({}); // không where
    expect(enrollments.map((e) => e.id)).toEqual([w.ea1.id]);
  });

  test("[P-2] findUnique + select hẹp: con mình → trả về đúng shape; con người khác → null", async () => {
    const w = await seedWorld();
    const pdb = portalDb(w.ownerA);

    const mine = await pdb.enrollment.findUnique({
      where: { id: w.ea1.id },
      select: { classId: true }, // không xin studentId — hậu-kiểm phải tự merge + strip
    });
    expect(mine?.classId).toBe(w.cls.id);
    expect("studentId" in (mine as object)).toBe(false);

    const theirs = await pdb.enrollment.findUnique({
      where: { id: w.eb1.id },
      select: { classId: true },
    });
    expect(theirs).toBeNull();
  });

  test("[P-3] Student.findUnique chống IDOR theo parentUserId", async () => {
    const w = await seedWorld();
    const pdb = portalDb(w.ownerA);

    expect(await pdb.student.findUnique({ where: { id: w.a1.id }, select: { name: true } })).not.toBeNull();
    expect(await pdb.student.findUnique({ where: { id: w.b1.id }, select: { name: true } })).toBeNull();
  });

  test("[P-4] ConversationMessage scope qua enrollment — tin nhắn nhà B vô hình với A", async () => {
    const w = await seedWorld();
    await db.conversationMessage.createMany({
      data: [
        { enrollmentId: w.ea1.id, authorUserId: w.pa.id, authorSide: "PARENT", body: "nhà A", centerId: CS1 },
        { enrollmentId: w.eb1.id, authorUserId: w.pb.id, authorSide: "PARENT", body: "nhà B", centerId: CS1 },
      ],
    });

    const seenByA = await portalDb(w.ownerA).conversationMessage.findMany({});
    expect(seenByA.map((m) => m.body)).toEqual(["nhà A"]);
  });

  test("[P-5] model tham chiếu (Course/Class) pass-through — phụ huynh vẫn đọc được catalog", async () => {
    const w = await seedWorld();
    const pdb = portalDb(w.ownerA);
    expect(await pdb.class.findUnique({ where: { id: w.cls.id }, select: { name: true } })).not.toBeNull();
    expect((await pdb.course.findMany({})).length).toBeGreaterThan(0);
  });

  test("[P-6] count/aggregate cũng bị scope (badge không đếm lộn nhà khác)", async () => {
    const w = await seedWorld();
    expect(await portalDb(w.ownerA).enrollment.count()).toBe(1);
    expect(await portalDb(w.ownerB).enrollment.count()).toBe(1);
  });
});
