// @vitest-environment node
/**
 * [TQ-DB] Tổng quan học tập (`napTongQuanHocTap`) — Postgres THẬT: "n/m bài" đếm đúng (bài đã xoá mềm không tính vào m; chỉ bài
 * DONE của CHÍNH người này tính vào n), và khối chứng nhận chỉ chứa chứng nhận của chính họ.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_TQD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import type { ScopedDb } from "../../lib/actions/factory";
import { db } from "../../lib/db";
import { napDeCuongKhoa } from "../../lib/elearning/course-view";
import { napTongQuanHocTap } from "../../lib/elearning/dashboard-view";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_TQD_";
const HAU_TO = "@tqd.test";
// Ranh giới đo ở đây là `userId`; cách ly cơ sở do e2e đo bằng scopedDb thật.
const sdb = db as unknown as ScopedDb;
const NOW = new Date("2026-11-17T03:00:00.000Z");

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnCertificate.deleteMany({ where: { certCode: { startsWith: P } } });
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnCourseVersionLesson.deleteMany({ where: { version: { course: { code: { startsWith: P } } } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[TQ-DB] tổng quan học tập (Postgres thật)", () => {
  let a = "";
  let b = "";
  let enrA = "";

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    const C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    a = (await seedUser({ email: `a${HAU_TO}`, role: "TEACHER", name: `${P}A` })).id;
    b = (await seedUser({ email: `b${HAU_TO}`, role: "TEACHER", name: `${P}B` })).id;

    const k = await db.trnCourse.create({
      data: {
        code: `${P}K`,
        slug: `${P.toLowerCase()}k`,
        title: `${P}Khoá`,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương`, orderIndex: 0 }, select: { id: true } });
    const bai: string[] = [];
    for (const [i, t] of ["B1", "B2", "B3", "B4"].entries()) {
      bai.push((await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}${t}`, kind: "READ", orderIndex: i, contentMd: "x", minReadSeconds: 1 }, select: { id: true } })).id);
    }
    // B4 bị xoá mềm ⇒ KHÔNG tính vào m
    await db.trnLesson.update({ where: { id: bai[3]! }, data: { deletedAt: new Date() } });

    const luot = (userId: string) =>
      db.trnEnrollment.create({
        data: { courseId: k.id, userId, cycle: 1, status: "IN_PROGRESS", source: "ASSIGNMENT", centerId: C.centerId, orgUnitId: C.orgUnitId, snapJobTitle: "NV" },
        select: { id: true },
      });
    enrA = (await luot(a)).id;
    const enrB = (await luot(b)).id;
    // A xong B1, B2; B xong B1, B2, B3 (không được lẫn vào số của A)
    for (const l of [bai[0]!, bai[1]!]) {
      await db.trnLessonProgress.create({ data: { enrollmentId: enrA, userId: a, lessonId: l, status: "DONE" } });
    }
    for (const l of [bai[0]!, bai[1]!, bai[2]!]) {
      await db.trnLessonProgress.create({ data: { enrollmentId: enrB, userId: b, lessonId: l, status: "DONE" } });
    }
    // một bài A đang học dở (không phải DONE ⇒ không tính vào n)
    await db.trnLessonProgress.create({ data: { enrollmentId: enrA, userId: a, lessonId: bai[2]!, status: "IN_PROGRESS" } });

    // chứng nhận: A có 1, B có 1
    const pb = await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "PUBLISHED" }, select: { id: true } });
    // Bản chốt: B1, B2 bắt buộc; B3 KHÔNG bắt buộc (B4 đã xoá mềm, không có dòng).
    await db.trnCourseVersionLesson.createMany({
      data: [bai[0]!, bai[1]!, bai[2]!].map((lessonId, i) => ({
        versionId: pb.id,
        lessonId,
        required: i < 2,
        orderIndex: i,
        contentHash: `tqd-hash-${i}`,
      })),
    });
    const cn = (userId: string, enrollmentId: string, ma: string) =>
      db.trnCertificate.create({
        data: { certCode: `${P}${ma}`, verifyToken: `${P.toLowerCase()}${ma}`, userId, courseId: k.id, courseVersionId: pb.id, enrollmentId, status: "VALID", snapFullName: ma, snapEmployeeCode: "NV", centerId: C.centerId, orgUnitId: C.orgUnitId },
      });
    await cn(a, enrA, "A");
    await cn(b, enrB, "B");
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[TQ-DB-01] n/m BẮT BUỘC: m = 2 (bài xoá mềm và bài không bắt buộc không tính), n = 2 (chỉ DONE của CHÍNH A, không lẫn của B)", async () => {
    const r = await napTongQuanHocTap(sdb, a, NOW);
    expect(r.tienDoBai[enrA]).toEqual({ xong: 2, tong: 2 });
  }, CASE_TIMEOUT);

  it("[TQ-DB-03] 🔴 KHỚP ĐỀ CƯƠNG: cùng khoá, Tổng quan và Đề cương in CÙNG n/m (một định nghĩa, không hai mẫu số)", async () => {
    const tq = (await napTongQuanHocTap(sdb, a, NOW)).tienDoBai[enrA];
    const dc = await napDeCuongKhoa(sdb, { enrollmentId: enrA, userId: a });
    expect(dc).not.toBeNull();
    expect(tq).toEqual({ xong: dc!.soBaiXong, tong: dc!.soBaiBatBuoc });
  }, CASE_TIMEOUT);

  it("[TQ-DB-02] khối chứng nhận chỉ có chứng nhận của A; B không lọt vào (đối chứng dương: A có đúng 1)", async () => {
    const r = await napTongQuanHocTap(sdb, a, NOW);
    expect(r.chungNhanGanDay.map((c) => c.certCode)).toEqual([`${P}A`]);
  }, CASE_TIMEOUT);
});
