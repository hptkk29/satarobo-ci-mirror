// @vitest-environment node
/**
 * [KQ-DB] Kết quả lượt thi cho người thi (`napKetQuaThi`) — Postgres THẬT, kiểm trên JSON ĐÃ SERIALIZE (thứ thật sự đi qua dây).
 *  · chính sách NEVER / AFTER_LAST_ATTEMPT chưa tới lượt ⇒ KHÔNG có đáp án đúng, lời giải, cờ đúng/sai, điểm từng câu trong phần trả về;
 *  · AFTER_EACH_ATTEMPT / đã dùng hết lượt ⇒ CÓ (đối chứng dương — không thì mọi ca "không lộ" vô nghĩa);
 *  · chỉ lượt ĐÃ NỘP của CHÍNH người thi: IN_PROGRESS ≡ không có; người khác ≡ không có.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_KQD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import type { ScopedDb } from "../../lib/actions/factory";
import { db } from "../../lib/db";
import { napKetQuaThi } from "../../lib/elearning/exam-result-view";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_KQD_";
const HAU_TO = "@kqd.test";
// Ranh giới đo ở đây là `userId`; cách ly cơ sở do e2e đo bằng scopedDb thật.
const sdb = db as unknown as ScopedDb;

// Đáp án đúng (Charlie) và lời giải là những chuỗi DUY NHẤT — người thi chọn Alpha. Tìm chúng trong JSON là bằng chứng lộ.
const DAP_AN_DUNG = "Lựa chọn Charlie-ĐÚNG";
const GIAI_THICH = "GIẢI-THÍCH-BÍ-MẬT-KQD";

type Ca = { lessonId: string; enrollmentId: string };

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
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

describe.skipIf(!RUN_DB_TESTS)("[KQ-DB] kết quả lượt thi (Postgres thật)", () => {
  let a = "";
  let b = "";
  const ca: Record<"moiLuot" | "khong" | "luotCuoiChua" | "luotCuoiDa" | "dangLam", Ca> = {} as never;

  async function dung(
    ten: string,
    o: { policy: "NEVER" | "AFTER_EACH_ATTEMPT" | "AFTER_LAST_ATTEMPT"; maxAttempts: number; luotNop: number; dangLam?: boolean },
  ): Promise<Ca> {
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    const C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    const k = await db.trnCourse.create({
      data: { code: `${P}${ten}`, slug: `${P.toLowerCase()}${ten.toLowerCase()}`, title: `${P}Khoá ${ten}`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương ${ten}`, orderIndex: 0 }, select: { id: true } });
    const q = await db.trnQuestion.create({
      data: {
        bankPath: P,
        type: "SINGLE",
        stem: `${P}Câu hỏi ${ten}`,
        explanation: GIAI_THICH,
        contentJson: { id: "q", type: "single", question: "?", options: ["Lựa chọn Alpha", "Lựa chọn Bravo", DAP_AN_DUNG], correctIndex: 2 },
        defaultPoints: 1,
      },
      select: { id: true },
    });
    const de = await db.trnExam.create({
      data: { title: `${P}Đề ${ten}`, durationMin: 30, passScore: 1, maxScore: 1, maxAttempts: o.maxAttempts, isActive: true, showAnswerPolicy: o.policy },
      select: { id: true },
    });
    const eq = await db.trnExamQuestion.create({ data: { examId: de.id, questionId: q.id, orderIndex: 0, points: 1 }, select: { id: true } });
    const bai = await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}Bài thi ${ten}`, kind: "QUIZ", orderIndex: 0, examId: de.id }, select: { id: true } });
    const luot = await db.trnEnrollment.create({
      data: { courseId: k.id, userId: a, cycle: 1, status: "IN_PROGRESS", source: "ASSIGNMENT", ...C, snapJobTitle: "NV" },
      select: { id: true },
    });
    for (let i = 1; i <= o.luotNop; i += 1) {
      const lan = await db.trnExamAttempt.create({
        data: { examId: de.id, userId: a, enrollmentId: luot.id, attemptNo: i, status: "GRADED", submittedAt: new Date(`2026-11-1${i}T03:00:00.000Z`), totalScore: 0, passed: false, ...C, purgeAfter: new Date("2027-12-01T00:00:00.000Z") },
        select: { id: true },
      });
      // Người thi chọn Alpha (chỉ số 0) — SAI; đáp án đúng là Charlie.
      await db.trnExamAnswer.create({ data: { attemptId: lan.id, examQuestionId: eq.id, selectedChoiceIds: ["0"], isCorrect: false, score: 0 } });
    }
    if (o.dangLam) {
      await db.trnExamAttempt.create({
        data: { examId: de.id, userId: a, enrollmentId: luot.id, attemptNo: o.luotNop + 1, status: "IN_PROGRESS", ...C, purgeAfter: new Date("2027-12-01T00:00:00.000Z") },
      });
    }
    return { lessonId: bai.id, enrollmentId: luot.id };
  }

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    a = (await seedUser({ email: `a${HAU_TO}`, role: "TEACHER", name: `${P}A` })).id;
    b = (await seedUser({ email: `b${HAU_TO}`, role: "TEACHER", name: `${P}B` })).id;
    ca.moiLuot = await dung("moi", { policy: "AFTER_EACH_ATTEMPT", maxAttempts: 3, luotNop: 1 });
    ca.khong = await dung("khong", { policy: "NEVER", maxAttempts: 1, luotNop: 1 });
    ca.luotCuoiChua = await dung("cuoichua", { policy: "AFTER_LAST_ATTEMPT", maxAttempts: 2, luotNop: 1 });
    ca.luotCuoiDa = await dung("cuoida", { policy: "AFTER_LAST_ATTEMPT", maxAttempts: 2, luotNop: 2 });
    ca.dangLam = await dung("danglam", { policy: "AFTER_EACH_ATTEMPT", maxAttempts: 3, luotNop: 0, dangLam: true });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  const nap = (c: Ca, userId = a) => napKetQuaThi(sdb, { enrollmentId: c.enrollmentId, lessonId: c.lessonId, userId });

  it("[KQ-DB-01] đối chứng dương: AFTER_EACH_ATTEMPT ⇒ CÓ đáp án đúng, lời giải, cờ đúng/sai và điểm từng câu", async () => {
    const r = await nap(ca.moiLuot);
    expect(r?.choPhepXemDapAn).toBe(true);
    expect(r?.cacCau[0]).toMatchObject({ daChon: ["Lựa chọn Alpha"], dung: false, diem: 0, dapAnDung: [DAP_AN_DUNG], giaiThich: GIAI_THICH });
  }, CASE_TIMEOUT);

  it("[KQ-DB-02] 🔴 NEVER ⇒ JSON đã serialize KHÔNG chứa đáp án đúng, lời giải; cờ đúng/sai và điểm từng câu là null; vẫn có điều người thi đã chọn", async () => {
    const r = await nap(ca.khong);
    expect(r?.choPhepXemDapAn).toBe(false);
    const json = JSON.stringify(r);
    expect(json).not.toContain(DAP_AN_DUNG);
    expect(json).not.toContain(GIAI_THICH);
    expect(r?.cacCau[0]).toMatchObject({ daChon: ["Lựa chọn Alpha"], dung: null, diem: null, dapAnDung: null, giaiThich: null });
    expect(r?.luot.status).toBe("GRADED"); // tổng/đạt vẫn có
  }, CASE_TIMEOUT);

  it("[KQ-DB-03] 🔴 AFTER_LAST_ATTEMPT: còn lượt (1/2) ⇒ KHÔNG lộ; đã dùng hết (2/2) ⇒ lộ", async () => {
    const chua = await nap(ca.luotCuoiChua);
    expect(chua?.choPhepXemDapAn).toBe(false);
    expect(JSON.stringify(chua)).not.toContain(DAP_AN_DUNG);
    const da = await nap(ca.luotCuoiDa);
    expect(da?.choPhepXemDapAn).toBe(true);
    expect(da?.cacCau[0]?.dapAnDung).toEqual([DAP_AN_DUNG]);
  }, CASE_TIMEOUT);

  it("[KQ-DB-04] 🔴 lượt ĐANG LÀM không có kết quả (null); người KHÁC không xem được lượt của A (đối chứng dương: A xem được)", async () => {
    expect(await nap(ca.dangLam)).toBeNull();
    expect(await nap(ca.moiLuot, b)).toBeNull();
    expect(await nap(ca.moiLuot, a)).not.toBeNull();
  }, CASE_TIMEOUT);
});
