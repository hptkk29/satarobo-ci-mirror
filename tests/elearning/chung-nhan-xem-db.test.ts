// @vitest-environment node
/**
 * [CX-DB] Xem chứng nhận (`napChungNhanXem`) + danh sách (`napDanhSachChungNhanCuaToi`) — Postgres THẬT.
 * Ranh giới cần đo: A KHÔNG xem được chứng nhận của B dù cùng khoá, cùng cơ sở (đối chứng dương: B xem được), số hiệu không tồn
 * tại trả cùng kết quả với số hiệu của người khác, và liên kết "học lại" chỉ hiện khi có lượt MỚI KHÁC lượt sinh chứng nhận.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_CXD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import type { ScopedDb } from "../../lib/actions/factory";
import { db } from "../../lib/db";
import { napChungNhanXem, napDanhSachChungNhanCuaToi } from "../../lib/elearning/certificate-view";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_CXD_";
const HAU_TO = "@cxd.test";
// Ranh giới đo ở đây là `userId` (cùng cơ sở); cách ly cơ sở do e2e đo bằng scopedDb thật.
const sdb = db as unknown as ScopedDb;
const NOW = new Date("2026-11-17T03:00:00.000Z");

let C: { centerId: string; orgUnitId: string };

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnCertificate.deleteMany({ where: { certCode: { startsWith: P } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[CX-DB] xem chứng nhận (Postgres thật)", () => {
  let a = "";
  let b = "";
  let enrA1 = "";
  let enrA2 = "";

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    a = (await seedUser({ email: `a${HAU_TO}`, role: "TEACHER", name: `${P}A` })).id;
    b = (await seedUser({ email: `b${HAU_TO}`, role: "TEACHER", name: `${P}B` })).id;

    const khoa = await db.trnCourse.create({
      data: {
        code: `${P}K1`,
        slug: `${P.toLowerCase()}k1`,
        title: `${P}Khoá`,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });
    const pb = await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED" }, select: { id: true } });
    const luot = (userId: string, cycle: number, status: "COMPLETED" | "NOT_STARTED") =>
      db.trnEnrollment.create({
        data: {
          courseId: khoa.id,
          userId,
          cycle,
          status,
          source: "ASSIGNMENT",
          centerId: C.centerId,
          orgUnitId: C.orgUnitId,
          snapJobTitle: "Nhân viên",
        },
        select: { id: true },
      });
    const lA1 = await luot(a, 1, "COMPLETED");
    const lB1 = await luot(b, 1, "COMPLETED");
    enrA1 = lA1.id;
    enrA2 = (await luot(a, 2, "NOT_STARTED")).id;
    const cert = (userId: string, enrollmentId: string, ma: string) =>
      db.trnCertificate.create({
        data: {
          certCode: `${P}${ma}`,
          verifyToken: `${P.toLowerCase()}${ma}`,
          userId,
          courseId: khoa.id,
          courseVersionId: pb.id,
          enrollmentId,
          status: "VALID",
          snapFullName: `${P}${ma}`,
          snapEmployeeCode: "NV",
          centerId: C.centerId,
          orgUnitId: C.orgUnitId,
        },
      });
    await cert(a, lA1.id, "A");
    await cert(b, lB1.id, "B");
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[CX-DB-01] đối chứng dương: chủ xem được chứng nhận của mình theo số hiệu", async () => {
    const r = await napChungNhanXem(sdb, { certCode: `${P}A`, userId: a });
    expect(r?.cn.certCode).toBe(`${P}A`);
    expect(r?.tenKhoa).toBe(`${P}Khoá`);
  }, CASE_TIMEOUT);

  it("[CX-DB-02] 🔴 A gõ số hiệu của B ⇒ null — GIỐNG HỆT số hiệu không tồn tại (không tiết lộ nó có thật)", async () => {
    const cua_B = await napChungNhanXem(sdb, { certCode: `${P}B`, userId: a });
    const khongCo = await napChungNhanXem(sdb, { certCode: `${P}KHONG-CO`, userId: a });
    expect(cua_B).toBeNull();
    expect(khongCo).toBeNull();
    // và chiều ngược: B xem được của B
    expect((await napChungNhanXem(sdb, { certCode: `${P}B`, userId: b }))?.cn.userId).toBe(b);
  }, CASE_TIMEOUT);

  it("[CX-DB-03] danh sách: chỉ chứng nhận của mình; có lượt HỌC LẠI (chu kỳ 2 đang mở) ⇒ trả đúng id; B không có", async () => {
    const dsA = await napDanhSachChungNhanCuaToi(sdb, a, NOW);
    expect(dsA.map((c) => c.certCode)).toEqual([`${P}A`]);
    expect(dsA[0]!.luotHocLaiId).toBe(enrA2);
    expect(dsA[0]!.luotHocLaiId).not.toBe(enrA1);
    const dsB = await napDanhSachChungNhanCuaToi(sdb, b, NOW);
    expect(dsB.map((c) => c.certCode)).toEqual([`${P}B`]);
    expect(dsB[0]!.luotHocLaiId).toBeNull(); // B không có lượt mở nào của khoá này
  }, CASE_TIMEOUT);
});
