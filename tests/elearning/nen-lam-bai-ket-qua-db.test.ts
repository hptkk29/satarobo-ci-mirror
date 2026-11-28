// @vitest-environment node
/**
 * [NK-DB] Màn bài kiểm tra (`nenLamBai`) — hai thông tin mới của NvKT, Postgres THẬT, đồng hồ ĐÓNG BĂNG:
 *  · `moLaiLuc`: chỉ có khi còn trong giãn cách giữa hai lượt, đếm từ lúc NỘP (không phải lúc bắt đầu) của lượt nộp gần nhất;
 *  · `chungNhanCode`: chỉ chứng nhận CHƯA THU HỒI của CHÍNH lượt học của người này.
 * Mỗi ca ÂM có đối chứng DƯƠNG cùng bộ.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_NKD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import type { ScopedDb } from "../../lib/actions/factory";
import { db } from "../../lib/db";
import { nenLamBai } from "../../lib/elearning/exam-view";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_NKD_";
const HAU_TO = "@nkd.test";
const sdb = db as unknown as ScopedDb;
const NOP = new Date("2026-11-10T03:00:00.000Z");
const gio = (h: number) => new Date(NOP.getTime() + h * 3_600_000);
const PURGE = new Date("2027-12-01T00:00:00.000Z");

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnCertificate.deleteMany({ where: { userId: { in: ids } } });
  await db.trnExamAnswer.deleteMany({ where: { attempt: { userId: { in: ids } } } });
  await db.trnExamAttempt.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: { startsWith: P } } } });
  await db.trnExam.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: P } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

describe.skipIf(!RUN_DB_TESTS)("[NK-DB] màn bài kiểm tra: giờ mở lượt sau + chứng nhận (Postgres thật)", () => {
  let a = "";
  let b = "";
  let C = { centerId: "", orgUnitId: "" };
  let n = 0;

  /** Một đề + một lượt học của A, có `luotNop` lượt đã nộp lúc NOP (lượt 1 nộp sớm hơn để thử "gần nhất"). */
  async function dung(o: { cooldownHours: number; moiNop?: Date; versionAndCert?: "valid" | "revoked" | "cuaNguoiKhac" }) {
    n += 1;
    const k = await db.trnCourse.create({
      data: { code: `${P}K${n}`, slug: `${P.toLowerCase()}k${n}`, title: `${P}Khoá ${n}`, status: "PUBLISHED", visibility: "ASSIGNED_ONLY", selfEnrollEnabled: false, sequential: false, securityLevel: "INTERNAL" },
      select: { id: true },
    });
    const m = await db.trnModule.create({ data: { courseId: k.id, title: `${P}Chương ${n}`, orderIndex: 0 }, select: { id: true } });
    const q = await db.trnQuestion.create({
      data: { bankPath: P, type: "SINGLE", stem: `${P}Câu ${n}`, contentJson: { id: "q", type: "single", question: "?", options: ["A", "B"], correctIndex: 0 }, defaultPoints: 1 },
      select: { id: true },
    });
    const de = await db.trnExam.create({
      data: { title: `${P}Đề ${n}`, durationMin: 30, passScore: 1, maxScore: 1, maxAttempts: 5, isActive: true, cooldownHours: o.cooldownHours },
      select: { id: true },
    });
    await db.trnExamQuestion.create({ data: { examId: de.id, questionId: q.id, orderIndex: 0, points: 1 } });
    await db.trnLesson.create({ data: { moduleId: m.id, title: `${P}Bài thi ${n}`, kind: "QUIZ", orderIndex: 0, examId: de.id } });
    const luot = await db.trnEnrollment.create({
      data: { courseId: k.id, userId: a, cycle: 1, status: "IN_PROGRESS", source: "ASSIGNMENT", ...C, snapJobTitle: "NV" },
      select: { id: true },
    });
    if (o.moiNop) {
      await db.trnExamAttempt.create({
        data: { examId: de.id, userId: a, enrollmentId: luot.id, attemptNo: 1, status: "GRADED", startedAt: new Date(o.moiNop.getTime() - 3_600_000 * 20), submittedAt: o.moiNop, totalScore: 1, passed: true, ...C, purgeAfter: PURGE },
      });
    }
    if (o.versionAndCert) {
      const pb = await db.trnCourseVersion.create({ data: { courseId: k.id, major: 1, minor: 0, status: "PUBLISHED" }, select: { id: true } });
      await db.trnCertificate.create({
        data: {
          certCode: `${P}CN${n}`,
          verifyToken: `${P.toLowerCase()}cn${n}`,
          userId: o.versionAndCert === "cuaNguoiKhac" ? b : a,
          courseId: k.id,
          courseVersionId: pb.id,
          enrollmentId: luot.id,
          status: o.versionAndCert === "revoked" ? "REVOKED" : "VALID",
          snapFullName: `${P}A`,
          snapEmployeeCode: "NV",
          ...C,
        },
      });
    }
    return { examId: de.id, enrollmentId: luot.id };
  }

  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    a = (await seedUser({ email: `a${HAU_TO}`, role: "TEACHER", name: `${P}A` })).id;
    b = (await seedUser({ email: `b${HAU_TO}`, role: "TEACHER", name: `${P}B` })).id;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  const nap = (x: { examId: string; enrollmentId: string }, now: Date) => nenLamBai({ db: sdb, userId: a, enrollmentId: x.enrollmentId, examId: x.examId, now });

  it("[NK-DB-01] 🔴 giãn cách 24h: sau 10h ⇒ moLaiLuc = nộp + 24h; ĐÚNG biên 24h ⇒ null; đối chứng: đề không giãn cách ⇒ null", async () => {
    const x = await dung({ cooldownHours: 24, moiNop: NOP });
    expect((await nap(x, gio(10)))?.moLaiLuc).toBe(gio(24).toISOString());
    expect((await nap(x, gio(24)))?.moLaiLuc).toBeNull(); // đúng biên là ĐƯỢC (cùng `>=` của cổng server)
    expect((await nap(x, gio(30)))?.moLaiLuc).toBeNull();
    const khong = await dung({ cooldownHours: 0, moiNop: NOP });
    expect((await nap(khong, gio(1)))?.moLaiLuc).toBeNull();
  }, CASE_TIMEOUT);

  it("[NK-DB-02] chưa nộp lượt nào ⇒ không có giờ chờ", async () => {
    const x = await dung({ cooldownHours: 24 });
    expect((await nap(x, gio(1)))?.moLaiLuc).toBeNull();
  }, CASE_TIMEOUT);

  it("[NK-DB-03] 🔴 chứng nhận: của chính lượt học & còn hiệu lực ⇒ có mã; đã THU HỒI ⇒ null; của người KHÁC ⇒ null", async () => {
    const co = await dung({ cooldownHours: 0, moiNop: NOP, versionAndCert: "valid" });
    expect((await nap(co, gio(1)))?.chungNhanCode).toBe(`${P}CN${n}`);
    const thuHoi = await dung({ cooldownHours: 0, moiNop: NOP, versionAndCert: "revoked" });
    expect((await nap(thuHoi, gio(1)))?.chungNhanCode).toBeNull();
    const khac = await dung({ cooldownHours: 0, moiNop: NOP, versionAndCert: "cuaNguoiKhac" });
    expect((await nap(khac, gio(1)))?.chungNhanCode).toBeNull();
    const chua = await dung({ cooldownHours: 0, moiNop: NOP });
    expect((await nap(chua, gio(1)))?.chungNhanCode).toBeNull();
  }, CASE_TIMEOUT);
});
