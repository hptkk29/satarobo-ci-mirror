// @vitest-environment node
/**
 * [BTT-DB] Màn buổi trực tiếp của người học (`docBuoiTrucTiep`) — Postgres THẬT.
 *  · ĐỌC KHÔNG GHI: mở màn không tạo dòng tiến độ, không đổi `startedAt`/`lastActivityAt`/`status` của lượt;
 *  · "đã điểm danh" chỉ khi có DẤU của giảng viên (`attendanceMarkedAt`) — bài DONE theo đường khác KHÔNG được nói là "đã ghi có mặt";
 *  · chỉ đọc dòng của CHÍNH người học (người khác điểm danh rồi không làm người này "đã điểm danh").
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_BTD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import type { ScopedDb } from "../../lib/actions/factory";
import { db } from "../../lib/db";
import { docBuoiTrucTiep } from "../../lib/elearning/buoi-truc-tiep";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_BTD_";
const HAU_TO = "@btd.test";
// Ranh giới đo là `userId`; cách ly cơ sở do e2e đo bằng scopedDb thật.
const sdb = db as unknown as ScopedDb;
const LUC = new Date("2026-11-16T10:05:00.000Z");

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[BTT-DB] buổi trực tiếp (Postgres thật)", () => {
  let a = "";
  let b = "";
  let gv = "";
  let enrA = "";
  let enrB = "";
  let baiCoTick = "";
  let baiChuaTick = "";
  let baiDoneKhongTick = "";
  let baiSach = "";

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    a = (await seedUser({ email: `a${HAU_TO}`, role: "TEACHER", name: `${P}A` })).id;
    b = (await seedUser({ email: `b${HAU_TO}`, role: "TEACHER", name: `${P}B` })).id;
    gv = (await seedUser({ email: `gv${HAU_TO}`, role: "TRAINING", name: `${P}Thầy Điểm Danh` })).id;
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
    const live = async (ten: string, i: number) =>
      (await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}${ten}`, kind: "LIVE_SESSION", orderIndex: i, sessionDate: new Date("2026-11-16T08:00:00.000Z") }, select: { id: true } })).id;
    baiCoTick = await live("Có tick", 0);
    baiChuaTick = await live("Chưa tick", 1);
    baiDoneKhongTick = await live("DONE nhưng không tick", 2);
    baiSach = await live("Chưa ai động tới", 3); // dùng RIÊNG cho ca ĐỌC-KHÔNG-GHI: ca khác không được đụng trước
    const luot = (userId: string) =>
      db.trnEnrollment.create({
        data: { courseId: k.id, userId, cycle: 1, status: "IN_PROGRESS", source: "ASSIGNMENT", centerId: cs1.centerId as string, orgUnitId: cs1.id, snapJobTitle: "NV" },
        select: { id: true },
      });
    enrA = (await luot(a)).id;
    enrB = (await luot(b)).id;
    // A: bài 'Có tick' đã được giảng viên tick; bài 'DONE nhưng không tick' xong theo đường khác (vd. công nhận tương đương)
    await db.trnLessonProgress.create({
      data: { enrollmentId: enrA, userId: a, lessonId: baiCoTick, status: "DONE", attendanceMarkedByUserId: gv, attendanceMarkedAt: LUC },
    });
    await db.trnLessonProgress.create({ data: { enrollmentId: enrA, userId: a, lessonId: baiDoneKhongTick, status: "DONE" } });
    // B: được tick ở bài 'Chưa tick' (của A thì chưa)
    await db.trnLessonProgress.create({
      data: { enrollmentId: enrB, userId: b, lessonId: baiChuaTick, status: "DONE", attendanceMarkedByUserId: gv, attendanceMarkedAt: LUC },
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  const doc = (userId: string, enrollmentId: string, lessonId: string) =>
    docBuoiTrucTiep(sdb, { enrollmentId, lessonId, userId, ngayBuoi: null });

  it("[BTT-DB-01] đối chứng dương: đã được tick ⇒ 'đã điểm danh' kèm TÊN người tick và lúc tick", async () => {
    const r = await doc(a, enrA, baiCoTick);
    expect(r).toMatchObject({ daDiemDanh: true, nguoiGhi: `${P}Thầy Điểm Danh` });
    expect(r.luc?.toISOString()).toBe(LUC.toISOString());
  }, CASE_TIMEOUT);

  it("[BTT-DB-02] 🔴 chưa có dấu tick ⇒ KHÔNG điểm danh: kể cả khi bài DONE theo đường khác, và kể cả khi NGƯỜI KHÁC được tick cùng bài", async () => {
    expect((await doc(a, enrA, baiChuaTick)).daDiemDanh).toBe(false); // không có dòng tiến độ nào
    expect((await doc(a, enrA, baiDoneKhongTick)).daDiemDanh).toBe(false); // DONE nhưng không có người tick
    // B được tick ở 'Chưa tick', không làm A "đã điểm danh" ở đó; đối chứng dương: chính B thì có
    expect((await doc(b, enrB, baiChuaTick)).daDiemDanh).toBe(true);
    // A hỏi bằng lượt của B ⇒ không thấy dòng của B (khoá theo userId + enrollmentId)
    expect((await doc(a, enrB, baiChuaTick)).daDiemDanh).toBe(false);
  }, CASE_TIMEOUT);

  it("[BTT-DB-03] 🔴 ĐỌC KHÔNG GHI: gọi nhiều lần không tạo dòng tiến độ nào và không đổi lượt ghi danh", async () => {
    const dem = () => db.trnLessonProgress.count({ where: { userId: { in: [a, b] } } });
    const luotTruoc = await db.trnEnrollment.findUniqueOrThrow({
      where: { id: enrA },
      select: { status: true, startedAt: true, lastActivityAt: true, progressPercent: true, updatedAt: true },
    });
    const truoc = await dem();
    expect(await db.trnLessonProgress.count({ where: { lessonId: baiSach } })).toBe(0); // điều kiện đầu: chưa có dòng nào
    for (let i = 0; i < 3; i += 1) await doc(a, enrA, baiSach);
    expect(await db.trnLessonProgress.count({ where: { lessonId: baiSach } })).toBe(0);
    expect(await dem()).toBe(truoc);
    const luotSau = await db.trnEnrollment.findUniqueOrThrow({
      where: { id: enrA },
      select: { status: true, startedAt: true, lastActivityAt: true, progressPercent: true, updatedAt: true },
    });
    expect(luotSau).toEqual(luotTruoc);
  }, CASE_TIMEOUT);
});
