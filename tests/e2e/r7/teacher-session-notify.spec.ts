// #06 L6 (câu 47/48) — cron notify GV: dạy thay trước 1 ngày + nhắc chốt buổi.
// Hàm thuần-DB (nhận `now`/opts) — test trực tiếp, không cần dev server.
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import {
  runSubstituteTeacherNotify,
  runSessionCloseReminder,
} from "../../../lib/lms/session-teacher-notify";

const DAY = 24 * 60 * 60 * 1000;

async function centerIdOf(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
}
async function makeClass(ctr: string, teacherId: string | null) {
  const rand = Math.random().toString(36).slice(2, 8);
  const course = await db.course.create({
    data: { name: `KhoáN ${rand}`, slug: `cn-${rand}` },
    select: { id: true },
  });
  const cls = await db.class.create({
    data: { name: `LớpN ${rand}`, courseId: course.id, centerId: ctr, teacherId, status: "ACTIVE" },
    select: { id: true },
  });
  return cls.id;
}

test.describe("[#06-L6] session-teacher-notify (câu 47 dạy thay + câu 48 chốt buổi)", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[câu 47] buổi NGÀY MAI có GV dạy thay → StaffNotification cho GV đó (dedupe)", async () => {
    const now = new Date("2026-08-01T03:00:00Z"); // 10:00 VN 01/08
    const ctr = await centerIdOf("CS1");
    const gv = await seedUser({ email: testEmail("gv-sub"), role: "TEACHER" });
    const clsId = await makeClass(ctr, null);
    await db.classSession.create({
      data: {
        classId: clsId,
        date: new Date("2026-08-02T02:00:00Z"), // 09:00 VN 02/08 = NGÀY MAI
        centerId: ctr,
        status: "SCHEDULED",
        substituteTeacherId: gv.id,
      },
    });

    const r1 = await runSubstituteTeacherNotify(now);
    expect(r1.notified).toBe(1);
    const notifs = await db.staffNotification.findMany({ where: { userId: gv.id } });
    expect(notifs.length).toBe(1);
    expect(notifs[0].dedupeKey).toMatch(/^session\.substitute:/);
    expect(notifs[0].category).toBe("CLASS");

    // chạy lại cron → dedupe, KHÔNG nhân đôi.
    await runSubstituteTeacherNotify(now);
    expect(await db.staffNotification.count({ where: { userId: gv.id } })).toBe(1);
  });

  test("[câu 47] buổi HÔM NAY (không phải ngày mai) → KHÔNG báo", async () => {
    const now = new Date("2026-08-01T03:00:00Z");
    const ctr = await centerIdOf("CS1");
    const gv = await seedUser({ email: testEmail("gv-sub2"), role: "TEACHER" });
    const clsId = await makeClass(ctr, null);
    await db.classSession.create({
      data: { classId: clsId, date: new Date("2026-08-01T06:00:00Z"), centerId: ctr, status: "SCHEDULED", substituteTeacherId: gv.id },
    });
    expect((await runSubstituteTeacherNotify(now)).notified).toBe(0);
  });

  test("[câu 48] buổi đã qua chưa chốt + flag ON → nhắc GV; flag OFF → no-op; dedupe", async () => {
    const now = new Date("2026-08-10T12:00:00Z");
    const ctr = await centerIdOf("CS1");
    const gv = await seedUser({ email: testEmail("gv-close"), role: "TEACHER" });
    const clsId = await makeClass(ctr, gv.id); // GV đứng lớp
    await db.classSession.create({
      data: { classId: clsId, date: new Date(now.getTime() - 2 * DAY), centerId: ctr, status: "SCHEDULED" },
    });

    // flag OFF → no-op (chốt buổi là luồng lifecycle v2).
    expect(await runSessionCloseReminder(now, { lifecycleV2: false })).toEqual({ scanned: 0, notified: 0 });
    expect(await db.staffNotification.count({ where: { userId: gv.id } })).toBe(0);

    // flag ON → nhắc GV đứng lớp.
    const on = await runSessionCloseReminder(now, { lifecycleV2: true });
    expect(on.notified).toBe(1);
    const notifs = await db.staffNotification.findMany({ where: { userId: gv.id } });
    expect(notifs.length).toBe(1);
    expect(notifs[0].dedupeKey).toMatch(/^session\.close-reminder:/);

    // dedupe.
    await runSessionCloseReminder(now, { lifecycleV2: true });
    expect(await db.staffNotification.count({ where: { userId: gv.id } })).toBe(1);
  });
});
