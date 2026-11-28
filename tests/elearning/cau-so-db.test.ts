// @vitest-environment node
/**
 * [NUM-DB] Câu NHẬP SỐ — đường dây thật trên Postgres: lưu → chuẩn hoá (answerJson) → nộp/chấm → xem lại.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_NUM_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("server-only", () => ({}));

import { resolveActorUncached } from "../../lib/auth/actor";
import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import { dongLuotThi } from "../../lib/elearning/exam-close";
import { cauHinhLuuCauTraLoi } from "../../lib/elearning/exam-taking";
import { napKetQuaThi } from "../../lib/elearning/exam-result-view";
import { dungNoiDungCauHoi } from "../../lib/elearning/question-content-map";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_NUM_";
const HAU_TO = "@num.test";
const GOI_Y = "GOI-Y-BI-MAT-NUM";

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
  await db.trnExamAnswer.deleteMany({ where: { attempt: { userId: { in: ids } } } });
  await db.trnExamAttempt.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: { startsWith: P } } } });
  await db.trnExam.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: P } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[NUM-DB] câu nhập số (Postgres thật)", () => {
  let a = "";
  let b = "";
  let C = { centerId: "", orgUnitId: "" };
  let n = 0;

  /** Một đề MỘT câu NUMERIC (đáp án 60,5 cm ± 1) + một lượt thi đang làm của `a`. */
  async function dung(policy: "NEVER" | "AFTER_EACH_ATTEMPT") {
    n += 1;
    const ten = `t${n}`;
    const k = await db.trnCourse.create({
      data: { code: `${P}${ten}`, slug: `${P.toLowerCase()}${ten}`, title: `${P}Khoá ${ten}`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương ${ten}`, orderIndex: 0 }, select: { id: true } });
    const q = await db.trnQuestion.create({ data: { bankPath: P, type: "NUMERIC", stem: `${P}Chiều dài?`, contentJson: {}, defaultPoints: 2 }, select: { id: true } });
    await db.trnQuestion.update({
      where: { id: q.id },
      data: { contentJson: dungNoiDungCauHoi({ questionId: q.id, type: "NUMERIC", stem: `${P}Chiều dài?`, so: { answer: 60.5, tolerance: 1, unit: "cm", hint: GOI_Y } }) as object },
    });
    const de = await db.trnExam.create({ data: { title: `${P}Đề ${ten}`, durationMin: 30, passScore: 2, maxScore: 2, maxAttempts: 3, isActive: true, showAnswerPolicy: policy }, select: { id: true } });
    const eq = await db.trnExamQuestion.create({ data: { examId: de.id, questionId: q.id, orderIndex: 0, points: 2 }, select: { id: true } });
    const bai = await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}Bài thi ${ten}`, kind: "QUIZ", orderIndex: 0, examId: de.id }, select: { id: true } });
    const luot = await db.trnEnrollment.create({ data: { courseId: k.id, userId: a, cycle: 1, status: "IN_PROGRESS", source: "ASSIGNMENT", ...C, snapJobTitle: "NV" }, select: { id: true } });
    const lan = await db.trnExamAttempt.create({
      data: { examId: de.id, userId: a, enrollmentId: luot.id, attemptNo: 1, status: "IN_PROGRESS", startedAt: new Date(), ...C, purgeAfter: new Date("2027-12-01T00:00:00.000Z") },
      select: { id: true },
    });
    return { attemptId: lan.id, examId: de.id, eqId: eq.id, enrollmentId: luot.id, lessonId: bai.id };
  }

  const luu = async (userId: string, x: { attemptId: string; eqId: string }, textAnswer: string | null) => {
    const actor = await resolveActorUncached(userId);
    return cauHinhLuuCauTraLoi.handler({ db: scopedDb(actor), actor, input: { attemptId: x.attemptId, examQuestionId: x.eqId, chon: [], textAnswer } } as never);
  };
  const dong = async (x: { attemptId: string; examId: string }) => {
    const actor = await resolveActorUncached(a);
    return dongLuotThi(scopedDb(actor), { luot: { id: x.attemptId, examId: x.examId, attemptNo: 1, passScore: 2, ...C }, via: "LEARNER", submittedAt: new Date() });
  };
  const dong1 = (attemptId: string) => db.trnExamAnswer.findFirst({ where: { attemptId }, select: { textAnswer: true, answerJson: true, isCorrect: true, score: true, selectedChoiceIds: true } });

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    a = (await seedUser({ email: `a${HAU_TO}`, role: "TEACHER", name: `${P}A` })).id;
    b = (await seedUser({ email: `b${HAU_TO}`, role: "TEACHER", name: `${P}B` })).id;
    // Tầm nhìn cơ sở của `scopedDb` đến từ `UserOrgRole` — hai người cùng ở CS1 để ca "người khác" chỉ bị chặn bởi `userId`, không bởi cơ sở.
    const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TRAINING" }, select: { id: true } });
    for (const u of [a, b]) {
      await db.userOrgRole.deleteMany({ where: { userId: u } });
      await db.userOrgRole.create({ data: { userId: u, orgUnitId: cs1.id, roleId: r.id, grantedById: u } });
    }
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
      await db.userOrgRole.deleteMany({ where: { userId: { in: [a, b].filter(Boolean) } } });
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[NUM-DB-01] lưu: chuỗi gõ giữ nguyên + số đã đọc vào answerJson; lưu lại (replay) vẫn MỘT dòng; rỗng xoá câu trả lời", async () => {
    const x = await dung("AFTER_EACH_ATTEMPT");
    await luu(a, x, "60,5");
    await luu(a, x, "60,5");
    expect(await db.trnExamAnswer.count({ where: { attemptId: x.attemptId } })).toBe(1);
    expect(await dong1(x.attemptId)).toMatchObject({ textAnswer: "60,5", answerJson: { so: 60.5, goc: "60,5" }, selectedChoiceIds: [] });
    await luu(a, x, "  ");
    expect(await dong1(x.attemptId)).toMatchObject({ textAnswer: null, answerJson: null });
  }, CASE_TIMEOUT);

  it("[NUM-DB-02] 🔴 không đọc được ⇒ từ chối và GIỮ bản hợp lệ đã lưu; 'abc', '6 0', '1.000,5' đều bị từ chối", async () => {
    const x = await dung("AFTER_EACH_ATTEMPT");
    await luu(a, x, "61");
    for (const xau of ["abc", "6 0", "1.000,5"]) await expect(luu(a, x, xau), xau).rejects.toMatchObject({ code: "SO_KHONG_HOP_LE" });
    expect(await dong1(x.attemptId)).toMatchObject({ textAnswer: "61", answerJson: { so: 61, goc: "61" } });
  }, CASE_TIMEOUT);

  it("[NUM-DB-03] 🔴 người KHÁC không ghi được vào lượt thi của mình (NOT_FOUND) — và không để lại dòng nào", async () => {
    const x = await dung("AFTER_EACH_ATTEMPT");
    await expect(luu(b, x, "60")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.trnExamAnswer.count({ where: { attemptId: x.attemptId } })).toBe(0);
  }, CASE_TIMEOUT);

  it("[NUM-DB-04] nộp: trong sai số ⇒ ĐÚNG trọn điểm, đạt; ghi isCorrect/score; GRADED (không chờ người)", async () => {
    const x = await dung("AFTER_EACH_ATTEMPT");
    await luu(a, x, "61,4");
    expect(await dong(x)).toMatchObject({ status: "GRADED", totalScore: 2, passed: true, choChamTay: false });
    expect(await dong1(x.attemptId)).toMatchObject({ isCorrect: true, score: 2 });
  }, CASE_TIMEOUT);

  it("[NUM-DB-05] nộp: ngoài sai số ⇒ SAI 0 điểm; bỏ trống ⇒ 0 điểm do MÁY chấm (GRADED, không PENDING_GRADE)", async () => {
    const sai = await dung("AFTER_EACH_ATTEMPT");
    await luu(a, sai, "62");
    expect(await dong(sai)).toMatchObject({ status: "GRADED", totalScore: 0, passed: false });
    expect(await dong1(sai.attemptId)).toMatchObject({ isCorrect: false, score: 0 });
    const trong = await dung("AFTER_EACH_ATTEMPT");
    expect(await dong(trong)).toMatchObject({ status: "GRADED", totalScore: 0, choChamTay: false });
  }, CASE_TIMEOUT);

  it("[NUM-DB-06] 🔴 nội dung câu hỏng khuôn ⇒ chờ người chấm (không biến thành 0 điểm)", async () => {
    const x = await dung("AFTER_EACH_ATTEMPT");
    await db.trnQuestion.updateMany({ where: { examQuestions: { some: { id: x.eqId } } }, data: { contentJson: { type: "numeric" } } });
    await luu(a, x, "60");
    expect(await dong(x)).toMatchObject({ status: "PENDING_GRADE", totalScore: null, choChamTay: true });
  }, CASE_TIMEOUT);

  it("[NUM-DB-07] xem lại: đáp án đúng + chuỗi người học gõ; gợi ý CHỈ khi sai (và đã được xem đáp án)", async () => {
    const sai = await dung("AFTER_EACH_ATTEMPT");
    await luu(a, sai, "99");
    await dong(sai);
    const r = await napKetQuaThi(scopedDb(await resolveActorUncached(a)), { enrollmentId: sai.enrollmentId, lessonId: sai.lessonId, userId: a });
    expect(r?.cacCau[0]).toMatchObject({ textAnswer: "99", dung: false, dapAnDung: ["60,5 cm (± 1)"], goiY: GOI_Y });
    const dung_ = await dung("AFTER_EACH_ATTEMPT");
    await luu(a, dung_, "60,5");
    await dong(dung_);
    const r2 = await napKetQuaThi(scopedDb(await resolveActorUncached(a)), { enrollmentId: dung_.enrollmentId, lessonId: dung_.lessonId, userId: a });
    expect(r2?.cacCau[0]).toMatchObject({ dung: true, goiY: null });
  }, CASE_TIMEOUT);

  it("[NUM-DB-08] 🔴 chính sách NEVER ⇒ JSON xem lại KHÔNG chứa đáp án đúng, gợi ý", async () => {
    const x = await dung("NEVER");
    await luu(a, x, "99");
    await dong(x);
    const r = await napKetQuaThi(scopedDb(await resolveActorUncached(a)), { enrollmentId: x.enrollmentId, lessonId: x.lessonId, userId: a });
    const json = JSON.stringify(r);
    for (const bi of [GOI_Y, "60,5", "± 1"]) expect(json, bi).not.toContain(bi);
    expect(r?.cacCau[0]).toMatchObject({ textAnswer: "99", dung: null, dapAnDung: null, goiY: null });
  }, CASE_TIMEOUT);
});
