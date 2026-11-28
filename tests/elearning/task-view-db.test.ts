// @vitest-environment node
/**
 * [TV-DB] Màn nộp bài tập (`nenNopBai`) — Postgres THẬT: tên người chấm + điểm tối đa từng tiêu chí; nhận xét/điểm chỉ lộ KHI ĐÃ CHẤM;
 * và chỉ đọc lượt của CHÍNH người nộp (đối chứng dương: người kia thấy lượt của họ).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_TVD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import type { ScopedDb } from "../../lib/actions/factory";
import { db } from "../../lib/db";
import { nenNopBai } from "../../lib/elearning/task-view";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_TVD_";
const HAU_TO = "@tvd.test";
// Ranh giới đo là `userId`; cách ly cơ sở do e2e đo bằng scopedDb thật.
const sdb = db as unknown as ScopedDb;
const CHAM = new Date("2026-11-16T08:00:00.000Z");

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnRubricScore.deleteMany({ where: { submission: { userId: { in: ids } } } });
  await db.trnSubmission.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  await db.trnRubricCriterion.deleteMany({ where: { rubric: { code: { startsWith: P } } } });
  await db.trnRubric.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[TV-DB] màn nộp bài tập (Postgres thật)", () => {
  let a = "";
  let b = "";
  let lessonId = "";
  let rubricId = "";

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    const C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    a = (await seedUser({ email: `a${HAU_TO}`, role: "TEACHER", name: `${P}A` })).id;
    b = (await seedUser({ email: `b${HAU_TO}`, role: "TEACHER", name: `${P}B` })).id;
    const chamId = (await seedUser({ email: `cham${HAU_TO}`, role: "TRAINING", name: `${P}Ngô Thảo Vy` })).id;
    const k = await db.trnCourse.create({
      data: { code: `${P}K`, slug: `${P.toLowerCase()}k`, title: `${P}Khoá`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương`, orderIndex: 0 }, select: { id: true } });
    const rb = await db.trnRubric.create({
      data: { code: `${P}RB`, title: `${P}Khung`, totalPoints: 12, passPoints: 8, status: "ACTIVE", ownerUserId: chamId },
      select: { id: true },
    });
    rubricId = rb.id;
    const tc = await db.trnRubricCriterion.create({
      data: { rubricId: rb.id, label: "Đủ nội dung", weight: 100, orderIndex: 0, levelsJson: [{ points: 0, label: "Thiếu" }, { points: 2, label: "Tạm" }, { points: 4, label: "Đủ" }] },
      select: { id: true },
    });
    lessonId = (await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}Bài tập`, kind: "TASK", orderIndex: 0, rubricId: rb.id }, select: { id: true } })).id;

    // A: đã chấm xong, đạt 10 điểm, có nhận xét + điểm tiêu chí
    const sa = await db.trnSubmission.create({
      data: { lessonId, userId: a, attemptNo: 1, status: "GRADED", submittedAt: new Date("2026-11-14T03:22:00.000Z"), rubricId: rb.id, ...C, score: 10, passed: true, gradedByUserId: chamId, gradedAt: CHAM, feedback: "BÍ-MẬT-NHẬN-XÉT-A" },
      select: { id: true },
    });
    await db.trnRubricScore.create({ data: { submissionId: sa.id, criterionId: tc.id, levelIndex: 2, points: 4, note: "Rõ ràng" } });
    // B: đang chờ chấm. Dòng cố ý mang dữ liệu "thừa" (nhận xét + người chấm) để chứng minh điều kiện `daCham` THỰC SỰ chặn — dữ liệu sạch thì cổng nào cũng xanh.
    await db.trnSubmission.create({
      data: { lessonId, userId: b, attemptNo: 1, status: "SUBMITTED", submittedAt: new Date("2026-11-15T03:00:00.000Z"), rubricId: rb.id, ...C, dueGradeAt: new Date("2026-11-20T03:00:00.000Z"), feedback: "RÒ-RỈ-NHẬN-XÉT-CHƯA-CHẤM", gradedByUserId: chamId },
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  const nap = (userId: string) => nenNopBai({ db: sdb, userId, lessonId, rubricId });

  it("[TV-DB-01] đối chứng dương: A thấy kết quả + TÊN người chấm + điểm tối đa tiêu chí (4/4) + nhận xét", async () => {
    const r = await nap(a);
    expect(r?.ganNhat).toMatchObject({ status: "GRADED", score: 10, passed: true, nguoiCham: `${P}Ngô Thảo Vy`, feedback: "BÍ-MẬT-NHẬN-XÉT-A" });
    expect(r?.ganNhat?.gradedAt?.toISOString()).toBe(CHAM.toISOString());
    expect(r?.ganNhat?.diemTieuChi).toEqual([{ label: "Đủ nội dung", muc: "Đủ", points: 4, toiDa: 4, note: "Rõ ràng" }]);
  }, CASE_TIMEOUT);

  it("[TV-DB-02] 🔴 B (đang chờ chấm) chỉ thấy lượt CỦA B: không nhận xét, không điểm tiêu chí, không tên người chấm; và không thấy nhận xét của A", async () => {
    const r = await nap(b);
    expect(r?.ganNhat).toMatchObject({ status: "SUBMITTED", feedback: null, nguoiCham: null, gradedAt: null, diemTieuChi: [] });
    expect(JSON.stringify(r)).not.toContain("BÍ-MẬT-NHẬN-XÉT-A");
    expect(r?.ganNhat?.dueGradeAt?.toISOString()).toBe("2026-11-20T03:00:00.000Z");
  }, CASE_TIMEOUT);

  it("[TV-DB-03] người CHƯA nộp lần nào: không có lượt nào, nộp được", async () => {
    const lanKhac = await seedUser({ email: `c${HAU_TO}`, role: "TEACHER", name: `${P}C` });
    const r = await nap(lanKhac.id);
    expect(r?.ganNhat).toBeNull();
    expect(r?.nopDuoc).toBe(true);
  }, CASE_TIMEOUT);
});
