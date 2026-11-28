// @vitest-environment node
/**
 * [TK-DB] Nguồn tìm kiếm (`napNguonTimKiem`) — Postgres THẬT: A chỉ tìm ra thứ của MÌNH. Khoá/bài/chứng nhận của B (cùng cơ sở)
 * không lọt vào kết quả của A (đối chứng dương: B tìm ra của B); bài đã xoá mềm và lượt đã thu hồi không lọt.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_TKD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import type { ScopedDb } from "../../lib/actions/factory";
import { db } from "../../lib/db";
import { locKetQua } from "../../lib/elearning/tim-kiem-pure";
import { napNguonTimKiem } from "../../lib/elearning/tim-kiem-view";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_TKD_";
const HAU_TO = "@tkd.test";
// Ranh giới đo ở đây là `userId`; cách ly cơ sở do e2e đo bằng scopedDb thật.
const sdb = db as unknown as ScopedDb;
const NOW = new Date("2026-11-17T03:00:00.000Z");

let C: { centerId: string; orgUnitId: string };

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

describe.skipIf(!RUN_DB_TESTS)("[TK-DB] nguồn tìm kiếm (Postgres thật)", () => {
  let a = "";
  let b = "";

  async function khoa(ma: string, tenBai: string[]) {
    const k = await db.trnCourse.create({
      data: {
        code: `${P}${ma}`,
        slug: `${P.toLowerCase()}${ma.toLowerCase()}`,
        title: `${P}Khoá ${ma}`,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương ${ma}`, orderIndex: 0 }, select: { id: true } });
    for (const [i, t] of tenBai.entries()) {
      await db.trnLesson.create({
        data: { moduleId: m.id, title: `${P}${t}`, kind: "READ", orderIndex: i, contentMd: "NỘI DUNG-BÍ-MẬT", minReadSeconds: 1 },
      });
    }
    return k.id;
  }
  const luot = (userId: string, courseId: string, status: "IN_PROGRESS" | "REVOKED" = "IN_PROGRESS") =>
    db.trnEnrollment.create({
      data: { courseId, userId, cycle: 1, status, source: "ASSIGNMENT", centerId: C.centerId, orgUnitId: C.orgUnitId, snapJobTitle: "NV" },
    });

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    a = (await seedUser({ email: `a${HAU_TO}`, role: "TEACHER", name: `${P}A` })).id;
    b = (await seedUser({ email: `b${HAU_TO}`, role: "TEACHER", name: `${P}B` })).id;
    const kA = await khoa("A", ["Bài điện A1", "Bài điện A2"]);
    const kB = await khoa("B", ["Bài điện B1"]);
    const kX = await khoa("X", ["Bài điện X1"]); // khoá mà lượt của A đã bị THU HỒI
    await luot(a, kA);
    await luot(b, kB);
    await luot(a, kX, "REVOKED");
    // một bài của A đã xoá mềm
    await db.trnLesson.updateMany({ where: { title: `${P}Bài điện A2` }, data: { deletedAt: new Date() } });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[TK-DB-01] đối chứng dương: A tìm 'bai dien' ra bài của khoá mình", async () => {
    const r = locKetQua(await napNguonTimKiem(sdb, a, NOW), "bai dien").filter((k) => k.loai === "bai");
    expect(r.map((k) => k.tieuDe)).toEqual([`${P}Bài điện A1`]);
  }, CASE_TIMEOUT);

  it("[TK-DB-02] 🔴 A KHÔNG tìm ra bài/khoá của B; không ra bài đã xoá mềm; không ra khoá đã THU HỒI", async () => {
    const tieuDe = (await napNguonTimKiem(sdb, a, NOW)).map((k) => k.tieuDe);
    expect(tieuDe).not.toContain(`${P}Bài điện B1`);
    expect(tieuDe).not.toContain(`${P}Khoá B`);
    expect(tieuDe).not.toContain(`${P}Bài điện A2`); // đã xoá mềm
    expect(tieuDe).not.toContain(`${P}Bài điện X1`); // lượt đã thu hồi
    expect(tieuDe).not.toContain(`${P}Khoá X`);
  }, CASE_TIMEOUT);

  it("[TK-DB-03] đối chứng dương của B: B tìm ra của B và không ra của A", async () => {
    const tieuDe = (await napNguonTimKiem(sdb, b, NOW)).map((k) => k.tieuDe);
    expect(tieuDe).toContain(`${P}Bài điện B1`);
    expect(tieuDe).not.toContain(`${P}Bài điện A1`);
  }, CASE_TIMEOUT);

  it("[TK-DB-04] chỉ tiêu đề: không trường nào của kết quả chứa NỘI DUNG bài", async () => {
    const tatCa = await napNguonTimKiem(sdb, a, NOW);
    expect(JSON.stringify(tatCa)).not.toContain("NỘI DUNG-BÍ-MẬT");
  }, CASE_TIMEOUT);
});
