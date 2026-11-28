// @vitest-environment node
/**
 * [NBT-DB] Nộp bài tập bằng TỆP — lượt NHÁP (đính tệp trước) rồi chốt thành bài nộp. Postgres thật, đi qua `runAction` với actor thật.
 *  · nháp KHÔNG phải bài nộp: không `submittedAt`/`dueGradeAt`, không vào hàng chờ chấm, mở lặp không đẻ thêm lượt;
 *  · chốt: có chữ HOẶC có tệp; chữ rỗng + không tệp ⇒ TỪ CHỐI và nháp còn nguyên; chốt dùng lại CHÍNH dòng nháp (không đẻ lượt mới);
 *  · cổng đi chung với nộp bài: người khác không mở được nháp trên lượt học của A; đang chờ chấm thì không mở nháp.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_NBT_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { runAction } from "../../lib/actions/factory";
import { resolveActorUncached } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import { nenNopBai } from "../../lib/elearning/task-view";
import { cauHinhNhapBaiTap, cauHinhNopBaiTap } from "../../lib/elearning/task-submit";
import { currentPolicyVersion, ELEARNING_POLICY_KEY } from "../../lib/elearning/policy-acceptance";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_NBT_";
const HAU_TO = "@nbt.test";
const TEP = { key: "k/1", name: "day-thu.mp4", mime: "video/mp4", size: 1024 * 1024 };

type Ng = { id: string; enrollmentId: string; lessonId: string; rubricId: string };

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnSubmission.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  await db.trnRubricCriterion.deleteMany({ where: { rubric: { code: { startsWith: P } } } });
  await db.trnRubric.deleteMany({ where: { code: { startsWith: P } } });
}

describe.skipIf(!RUN_DB_TESTS)("[NBT-DB] nộp bài tập bằng tệp (Postgres thật)", () => {
  let n = 0;
  let C = { centerId: "", orgUnitId: "" };
  let nguoiKhac = "";

  async function taoNguoi(ten: string): Promise<Ng> {
    n += 1;
    const u = await seedUser({ email: `${P.toLowerCase()}${ten}${HAU_TO}`, role: "TEACHER", name: `${P}${ten}` });
    await db.userOrgRole.deleteMany({ where: { userId: u.id } });
    const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TEACHER" }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: C.orgUnitId, roleId: r.id, grantedById: u.id } });
    await db.trnPolicyAcceptance.upsert({
      where: { userId_policyKey_policyVersion: { userId: u.id, policyKey: ELEARNING_POLICY_KEY, policyVersion: currentPolicyVersion() } },
      update: { revokedAt: null },
      create: { userId: u.id, policyKey: ELEARNING_POLICY_KEY, policyVersion: currentPolicyVersion() },
    });
    const k = await db.trnCourse.create({
      data: { code: `${P}K${n}`, slug: `${P.toLowerCase()}k${n}`, title: `${P}Khoá ${n}`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
      select: { id: true },
    });
    await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "PUBLISHED" } });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương ${n}`, orderIndex: 0 }, select: { id: true } });
    const rb = await db.trnRubric.create({ data: { code: `${P}RB${n}`, title: `${P}Khung ${n}`, totalPoints: 12, passPoints: 8, status: "ACTIVE", ownerUserId: u.id }, select: { id: true } });
    await db.trnRubricCriterion.create({ data: { rubricId: rb.id, label: "Đủ", weight: 100, orderIndex: 0, levelsJson: [{ points: 0, label: "Thiếu" }, { points: 4, label: "Đủ" }] } });
    const bai = await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}Bài tập ${n}`, kind: "TASK", orderIndex: 0, rubricId: rb.id }, select: { id: true } });
    const gd = await db.trnEnrollment.create({
      data: { courseId: k.id, userId: u.id, cycle: 1, status: "NOT_STARTED", source: "ASSIGNMENT", ...C, snapJobTitle: "NV" },
      select: { id: true },
    });
    return { id: u.id, enrollmentId: gd.id, lessonId: bai.id, rubricId: rb.id };
  }

  const nhap = async (id: string, enrollmentId: string, lessonId: string) =>
    runAction(cauHinhNhapBaiTap, await resolveActorUncached(id), { enrollmentId, lessonId }, { actorName: "nbt" });
  const nop = async (id: string, enrollmentId: string, lessonId: string, contentText: string) =>
    runAction(cauHinhNopBaiTap, await resolveActorUncached(id), { enrollmentId, lessonId, contentText }, { actorName: "nbt" });
  const dong = (userId: string, lessonId: string) => db.trnSubmission.findMany({ where: { userId, lessonId }, orderBy: { attemptNo: "asc" } });

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    nguoiKhac = (await seedUser({ email: `khac${HAU_TO}`, role: "TEACHER", name: `${P}Khac` })).id;
    const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TEACHER" }, select: { id: true } });
    await db.userOrgRole.deleteMany({ where: { userId: nguoiKhac } });
    await db.userOrgRole.create({ data: { userId: nguoiKhac, orgUnitId: C.orgUnitId, roleId: r.id, grantedById: nguoiKhac } });
    await db.trnPolicyAcceptance.upsert({
      where: { userId_policyKey_policyVersion: { userId: nguoiKhac, policyKey: ELEARNING_POLICY_KEY, policyVersion: currentPolicyVersion() } },
      update: { revokedAt: null },
      create: { userId: nguoiKhac, policyKey: ELEARNING_POLICY_KEY, policyVersion: currentPolicyVersion() },
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
      await db.user.deleteMany({ where: { email: { endsWith: HAU_TO } } });
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[NBT-DB-01] 🔴 mở nháp: DRAFT không submittedAt/dueGradeAt; mở LẶP không đẻ thêm lượt; nháp KHÔNG vào hàng chờ chấm; màn thấy nháp chứ không thấy 'đã nộp'", async () => {
    const a = await taoNguoi("a1");
    const r1 = await nhap(a.id, a.enrollmentId, a.lessonId);
    expect(r1.res.ok).toBe(true);
    const r2 = await nhap(a.id, a.enrollmentId, a.lessonId);
    expect(r2.res.ok && r1.res.ok && r2.res.data.submissionId === r1.res.data.submissionId).toBe(true);
    const ds = await dong(a.id, a.lessonId);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ status: "DRAFT", attemptNo: 1, submittedAt: null, dueGradeAt: null, rubricId: a.rubricId });
    expect(await db.trnSubmission.count({ where: { lessonId: a.lessonId, status: "SUBMITTED" } })).toBe(0);
    const actor = await resolveActorUncached(a.id);
    const nen = await nenNopBai({ db: scopedDb(actor), userId: a.id, lessonId: a.lessonId, rubricId: a.rubricId });
    expect(nen?.ganNhat).toBeNull();
    expect(nen?.nhap?.submissionId).toBe(ds[0]!.id);
    expect(nen?.nopDuoc).toBe(true);
  }, CASE_TIMEOUT);

  it("[NBT-DB-02] 🔴 chữ rỗng + nháp KHÔNG có tệp ⇒ từ chối TRONG, nháp còn nguyên; đối chứng dương: có chữ ⇒ nộp được (chốt đúng dòng nháp)", async () => {
    const a = await taoNguoi("a2");
    await nhap(a.id, a.enrollmentId, a.lessonId);
    const tu = await nop(a.id, a.enrollmentId, a.lessonId, "");
    expect(tu.res.ok).toBe(false);
    expect(!tu.res.ok && tu.res.error.code).toBe("TRONG");
    expect((await dong(a.id, a.lessonId)).map((d) => d.status)).toEqual(["DRAFT"]);
    const ok = await nop(a.id, a.enrollmentId, a.lessonId, "Bài làm bằng chữ");
    expect(ok.res.ok).toBe(true);
    const ds = await dong(a.id, a.lessonId);
    expect(ds).toHaveLength(1); // chốt CHÍNH dòng nháp
    expect(ds[0]).toMatchObject({ status: "SUBMITTED", attemptNo: 1, contentText: "Bài làm bằng chữ" });
  }, CASE_TIMEOUT);

  it("[NBT-DB-03] 🔴 nháp CÓ tệp + chữ rỗng ⇒ nộp được: SUBMITTED, có hạn chấm, contentText null (ghi chú không bắt buộc), không đẻ lượt mới, vào hàng chờ chấm", async () => {
    const a = await taoNguoi("a3");
    const m = await nhap(a.id, a.enrollmentId, a.lessonId);
    expect(m.res.ok).toBe(true);
    await db.trnSubmission.update({ where: { id: m.res.ok ? m.res.data.submissionId : "" }, data: { attachmentsJson: [TEP] } });
    const r = await nop(a.id, a.enrollmentId, a.lessonId, "");
    expect(r.res.ok).toBe(true);
    const ds = await dong(a.id, a.lessonId);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ status: "SUBMITTED", attemptNo: 1, contentText: null });
    expect(ds[0]!.submittedAt).not.toBeNull();
    expect(ds[0]!.dueGradeAt).not.toBeNull();
    expect(ds[0]!.attachmentsJson).toEqual([TEP]);
    expect(await db.trnSubmission.count({ where: { lessonId: a.lessonId, status: "SUBMITTED" } })).toBe(1);
    // Nộp lại ngay khi đang chờ chấm: bị chặn như cũ, và không mở được nháp mới.
    const lai = await nhap(a.id, a.enrollmentId, a.lessonId);
    expect(!lai.res.ok && lai.res.error.code).toBe("DANG_CHO_CHAM");
  }, CASE_TIMEOUT);

  it("[NBT-DB-04] 🔴 người KHÁC không mở được nháp trên lượt học của A (và không đẻ dòng nào); đối chứng dương: A mở được", async () => {
    const a = await taoNguoi("a4");
    const khac = await nhap(nguoiKhac, a.enrollmentId, a.lessonId);
    expect(!khac.res.ok && khac.res.error.code).toBe("FORBIDDEN");
    expect(await db.trnSubmission.count({ where: { lessonId: a.lessonId } })).toBe(0);
    expect((await nhap(a.id, a.enrollmentId, a.lessonId)).res.ok).toBe(true);
  }, CASE_TIMEOUT);

  it("[NBT-DB-05] 🔴 nộp lại sau 'chưa đạt': nháp mới là lượt N+1 và CHÉP tệp lượt cũ; lượt cũ không đổi; đã ĐẠT thì không mở nháp", async () => {
    const a = await taoNguoi("a5");
    const nop1 = await nop(a.id, a.enrollmentId, a.lessonId, "Lần một");
    expect(nop1.res.ok).toBe(true);
    await db.trnSubmission.updateMany({ where: { userId: a.id, lessonId: a.lessonId }, data: { status: "GRADED", passed: false, score: 2, attachmentsJson: [TEP] } });
    const m = await nhap(a.id, a.enrollmentId, a.lessonId);
    expect(m.res.ok && m.res.data.attemptNo).toBe(2);
    const ds = await dong(a.id, a.lessonId);
    expect(ds.map((d) => [d.attemptNo, d.status])).toEqual([[1, "GRADED"], [2, "DRAFT"]]);
    expect(ds[1]!.attachmentsJson).toEqual([TEP]);
    expect(ds[0]).toMatchObject({ status: "GRADED", score: 2, passed: false });
    // Có tệp chép sang ⇒ nộp lại KHÔNG cần gõ chữ.
    expect((await nop(a.id, a.enrollmentId, a.lessonId, "")).res.ok).toBe(true);

    const b = await taoNguoi("a5b");
    await nop(b.id, b.enrollmentId, b.lessonId, "Đạt");
    await db.trnSubmission.updateMany({ where: { userId: b.id, lessonId: b.lessonId }, data: { status: "GRADED", passed: true, score: 12 } });
    const datRoi = await nhap(b.id, b.enrollmentId, b.lessonId);
    expect(!datRoi.res.ok && datRoi.res.error.code).toBe("DA_DAT_ROI");
  }, CASE_TIMEOUT);

  it("[NBT-DB-06] chưa nộp lần nào + chữ rỗng + không nháp ⇒ TRONG, không ghi dòng nào", async () => {
    const a = await taoNguoi("a6");
    const r = await nop(a.id, a.enrollmentId, a.lessonId, "");
    expect(!r.res.ok && r.res.error.code).toBe("TRONG");
    expect(await db.trnSubmission.count({ where: { lessonId: a.lessonId } })).toBe(0);
  }, CASE_TIMEOUT);
});
