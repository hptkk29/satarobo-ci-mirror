// @vitest-environment node
/**
 * [DC-DB] Đề cương khoá (`napDeCuongKhoa`) — Postgres THẬT: thời lượng/số câu từng bài, người giao, gia hạn, ngày hoàn thành,
 * và RANH GIỚI CHÍNH CHỦ (đối chứng dương: chủ lượt thấy; người khác nhận null như "không tồn tại").
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_DCD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import type { ScopedDb } from "../../lib/actions/factory";
import { db } from "../../lib/db";
import { napDeCuongKhoa } from "../../lib/elearning/course-view";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_DCD_";
const HAU_TO = "@dcd.test";
// Test đọc chính chủ bằng `db` trần: ranh giới cần đo ở đây là `userId`, không phải cách ly cơ sở (e2e đo cái đó).
const sdb = db as unknown as ScopedDb;

let C: { centerId: string; orgUnitId: string };

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: { startsWith: P } } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnExam.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: P } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[DC-DB] đề cương khoá (Postgres thật)", () => {
  let enrollmentId = "";
  let chuId = "";
  let nguoiLaId = "";
  const dueAtOriginal = new Date("2026-11-01T10:00:00.000Z");
  const dueAt = new Date("2026-11-04T10:00:00.000Z");
  const completedAt = new Date("2026-10-30T03:00:00.000Z");

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };

    const chu = await seedUser({ email: `chu${HAU_TO}`, role: "TEACHER", name: `${P}Học viên` });
    const la = await seedUser({ email: `la${HAU_TO}`, role: "TEACHER", name: `${P}Người lạ` });
    const giao = await seedUser({ email: `giao${HAU_TO}`, role: "TRAINING", name: `${P}Chị Giao Khoá` });
    chuId = chu.id;
    nguoiLaId = la.id;

    const khoa = await db.trnCourse.create({
      data: {
        code: `${P}K1`,
        slug: `${P.toLowerCase()}k1`,
        title: `${P}Khoá thử`,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });
    const chuong = await db.trnModule.create({ data: { courseId: khoa.id, title: `${P}Chương`, orderIndex: 0 }, select: { id: true } });
    const q1 = await db.trnQuestion.create({
      data: { bankPath: P, type: "SINGLE", stem: `${P}Câu 1`, contentJson: { id: "q", type: "single", question: "?", options: ["A", "B"], correctIndex: 0 }, defaultPoints: 1 },
      select: { id: true },
    });
    const q2 = await db.trnQuestion.create({
      data: { bankPath: P, type: "SINGLE", stem: `${P}Câu 2`, contentJson: { id: "q", type: "single", question: "?", options: ["A", "B"], correctIndex: 0 }, defaultPoints: 1 },
      select: { id: true },
    });
    const de = await db.trnExam.create({
      data: { title: `${P}Đề`, durationMin: 10, passScore: 1, maxScore: 2, maxAttempts: 1, isActive: true },
      select: { id: true },
    });
    await db.trnExamQuestion.create({ data: { examId: de.id, questionId: q1.id, orderIndex: 0, points: 1 } });
    await db.trnExamQuestion.create({ data: { examId: de.id, questionId: q2.id, orderIndex: 1, points: 1 } });
    await db.trnLesson.create({
      data: { moduleId: chuong.id, title: `${P}Video`, kind: "VIDEO", orderIndex: 0, durationSec: 720, videoKey: "elearning/master/dcd/v.mp4" },
    });
    await db.trnLesson.create({ data: { moduleId: chuong.id, title: `${P}Đọc`, kind: "READ", orderIndex: 1, contentMd: "x", minReadSeconds: 180 } });
    await db.trnLesson.create({ data: { moduleId: chuong.id, title: `${P}Thi`, kind: "QUIZ", orderIndex: 2, examId: de.id } });

    const luot = await db.trnAssignment.create({
      data: {
        contentType: "COURSE",
        contentId: khoa.id,
        title: `${P}Lượt giao`,
        isMandatory: true,
        completionRuleJson: {},
        notifyChannels: [],
        reminderSchedule: [],
        centerId: C.centerId,
        orgUnitId: C.orgUnitId,
        createdByUserId: giao.id,
      },
      select: { id: true },
    });
    const gd = await db.trnEnrollment.create({
      data: {
        courseId: khoa.id,
        userId: chu.id,
        assignmentId: luot.id,
        cycle: 1,
        status: "COMPLETED",
        source: "ASSIGNMENT",
        centerId: C.centerId,
        orgUnitId: C.orgUnitId,
        snapJobTitle: "Nhân viên",
        progressPercent: 100,
        dueAtOriginal,
        dueAt,
        extensionReason: "Sự cố hệ thống ngày 01/11",
        completedAt,
      },
      select: { id: true },
    });
    enrollmentId = gd.id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[DC-DB-01] đối chứng dương: chủ lượt thấy thời lượng video, số câu bài kiểm tra, người giao, gia hạn, ngày xong", async () => {
    const r = await napDeCuongKhoa(sdb, { enrollmentId, userId: chuId });
    expect(r).not.toBeNull();
    const bai = r!.chuong[0]!.lessons;
    expect(bai.find((b) => b.title.endsWith("Video"))?.moTaThoiLuong).toBe("Video · 12 phút");
    expect(bai.find((b) => b.title.endsWith("Đọc"))?.moTaThoiLuong).toBe("Bài đọc · đọc tối thiểu 3 phút");
    expect(bai.find((b) => b.title.endsWith("Thi"))?.moTaThoiLuong).toBe("Bài kiểm tra · 2 câu");
    expect(r!.nguoiGiao).toBe(`${P}Chị Giao Khoá`);
    expect(r!.tenChuongTrinh).toBeNull(); // khoá không thuộc chương trình nào ⇒ không bịa tên
    expect(r!.dueAtOriginal?.toISOString()).toBe(dueAtOriginal.toISOString());
    expect(r!.dueAt?.toISOString()).toBe(dueAt.toISOString());
    expect(r!.extensionReason).toBe("Sự cố hệ thống ngày 01/11");
    expect(r!.completedAt?.toISOString()).toBe(completedAt.toISOString());
  }, CASE_TIMEOUT);

  it("[DC-DB-02] 🔴 người KHÁC mở lượt của mình ⇒ null (giống 'không tồn tại'); id không có ⇒ cũng null", async () => {
    expect(await napDeCuongKhoa(sdb, { enrollmentId, userId: nguoiLaId })).toBeNull();
    expect(await napDeCuongKhoa(sdb, { enrollmentId: "khong-co-id-nay", userId: chuId })).toBeNull();
  }, CASE_TIMEOUT);
});
