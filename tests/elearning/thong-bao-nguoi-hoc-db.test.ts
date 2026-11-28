// @vitest-environment node
/**
 * [TBN-DB] Thông báo kết quả cho người học — Postgres THẬT: ghi đúng người, đúng đích, IDEMPOTENT (phát lại không đẻ bản thứ hai),
 * và nới hạn lần hai ra HẠN KHÁC thì là thông báo mới.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_TBN_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { thongBaoCapChungNhan, thongBaoDaCham, thongBaoGiaHan } from "../../lib/elearning/thong-bao-nguoi-hoc";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_TBN_";
const HAU_TO = "@tbn.test";

let a = "";
let b = "";
let enrId = "";

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.staffNotification.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

const cua = (userId: string) => db.staffNotification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

describe.skipIf(!RUN_DB_TESTS)("[TBN-DB] thông báo kết quả cho người học (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    delete process.env.ELEARNING_NOTIFY_ONLY_EMAIL_DOMAIN; // cổng UAT tắt: kiểm đường PROD
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    a = (await seedUser({ email: `a${HAU_TO}`, role: "TEACHER", name: `${P}A` })).id;
    b = (await seedUser({ email: `b${HAU_TO}`, role: "TEACHER", name: `${P}B` })).id;
    const k = await db.trnCourse.create({
      data: {
        code: `${P}K`,
        slug: `${P.toLowerCase()}k`,
        title: `${P}Khoá thử`,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });
    enrId = (
      await db.trnEnrollment.create({
        data: { courseId: k.id, userId: a, cycle: 1, status: "IN_PROGRESS", source: "ASSIGNMENT", centerId: cs1.centerId as string, orgUnitId: cs1.id, snapJobTitle: "NV" },
        select: { id: true },
      })
    ).id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[TBN-DB-01] chấm xong: đúng NGƯỜI NỘP, đúng đích, idempotent (gọi hai lần ⇒ một thông báo); người khác không nhận", async () => {
    const o = { submissionId: "sub-1", userId: a, enrollmentId: enrId, lessonId: "les-1", tenBai: "Bài thử", traVeSua: false, dat: true, tong: 10, toiDa: 12 };
    await thongBaoDaCham(o);
    await thongBaoDaCham(o); // phát lại
    const ds = (await cua(a)).filter((n) => n.dedupeKey === "el.cham:sub-1");
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ title: 'Bài tập "Bài thử" đã được chấm: đạt 10/12', href: `/elearning/hoc/${enrId}/les-1` });
    expect(await cua(b)).toHaveLength(0);
  }, CASE_TIMEOUT);

  it("[TBN-DB-02] cấp chứng nhận: một thông báo trỏ trang xem, không đẻ thêm khi chạy lại", async () => {
    const o = { certificateId: "cert-1", certCode: "SR.CN.2026.00099", userId: a, tenKhoa: "An toàn" };
    await thongBaoCapChungNhan(o);
    await thongBaoCapChungNhan(o);
    const ds = (await cua(a)).filter((n) => n.dedupeKey === "el.cap-cn:cert-1");
    expect(ds).toHaveLength(1);
    expect(ds[0]!.href).toBe("/elearning/chung-nhan-cua-toi/SR.CN.2026.00099");
  }, CASE_TIMEOUT);

  it("[TBN-DB-03] nới hạn: một thông báo cho mỗi HẠN MỚI; cùng hạn chạy lại không trùng; hạn khác là thông báo mới", async () => {
    const han1 = new Date("2026-12-01T10:00:00.000Z");
    const han2 = new Date("2026-12-10T10:00:00.000Z");
    await thongBaoGiaHan([{ id: enrId, dueAt: han1 }]);
    await thongBaoGiaHan([{ id: enrId, dueAt: han1 }]);
    expect((await cua(a)).filter((n) => n.dedupeKey.startsWith(`el.gia-han:${enrId}:`))).toHaveLength(1);
    await thongBaoGiaHan([{ id: enrId, dueAt: han2 }]);
    const ds = (await cua(a)).filter((n) => n.dedupeKey.startsWith(`el.gia-han:${enrId}:`));
    expect(ds).toHaveLength(2);
    expect(ds[0]!.title).toContain("01/12/2026");
    expect(await thongBaoGiaHan([])).toBe(0);
  }, CASE_TIMEOUT);

  it("[TBN-DB-04] thông báo rơi đúng NHÓM catalog (không rơi 'tự do')", async () => {
    const ds = await cua(a);
    for (const n of ds) expect(n.groupKey, n.dedupeKey).toBe("system");
  }, CASE_TIMEOUT);
});
