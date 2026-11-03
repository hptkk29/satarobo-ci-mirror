// @vitest-environment node
/**
 * MỞ BÀI THI — action `batDauThi` trả luôn màn làm bài (Postgres thật).
 *
 * Bối cảnh (TEST 26/10/2026): action ~95 ms nhưng màn thi chỉ hiện sau ~3,9 s vì giao diện chờ bản cập nhật RSC của
 * `router.refresh()`. Nay action trả `luot` (dựng bởi `dungLuotDangLam`, cùng hàm với trang học) để giao diện mở NGAY.
 * Việc trả thêm dữ liệu KHÔNG được làm đổi một điều kiện thi nào, nên bộ này khoá cả hai vế:
 *   (A) cái mới đúng: `luot` giống hệt bản trang, không lộ đáp án, giữ lựa chọn đã lưu, thứ tự trộn tất định;
 *   (B) cái cũ KHÔNG đổi: không tạo trùng lượt (lặp lại / đồng thời), trần lượt + mở khoá, quyền, IDOR, chính sách, đề nháp.
 *
 * Quy ước: ca ÂM đếm dòng TRƯỚC/SAU (luật rollback: `return` không rollback) và có ĐỐI CHỨNG DƯƠNG cùng bộ.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE (CI chạy các bộ DB tuần tự trên CÙNG một database). Dọn theo tiền tố `CI_MBT_`
 * ở beforeAll VÀ afterAll. Người dùng giữ lại (`seedUser` upsert theo email; bảng chấp thuận chính sách là bằng chứng bất biến).
 *
 * Chạy: `pnpm test:elearning-db`. Không có DB ⇒ SKIP, không phải xanh.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import { resolveActorUncached, type Actor } from "../../lib/auth/actor";
import { runAction } from "../../lib/actions/factory";
import { cauHinhBatDauThi } from "../../lib/elearning/exam-taking";
import { nenLamBai } from "../../lib/elearning/exam-view";
import { currentPolicyVersion, ELEARNING_POLICY_KEY } from "../../lib/elearning/policy-acceptance";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_MBT_";
const HAU_TO = "@mbt.test";

type Nguoi = { id: string; enrollmentId: string };
const NG: Record<string, Nguoi> = {};
let C: { courseId: string; lessonId: string; examId: string; centerId: string; orgUnitId: string; lessonKhacId: string };
let seq = 0;

const CAU = (correctIndex: number, options: string[]) => ({
  id: `q-${correctIndex}`,
  type: "single",
  question: "Chọn đáp án đúng",
  options,
  correctIndex,
});

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const attempts = await db.trnExamAttempt.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const aIds = attempts.map((a) => a.id);
  try {
    await db.auditLog.deleteMany({ where: { entityType: "TrnExamAttempt", entityId: { in: aIds } } });
  } catch {
    /* AuditLog có thể append-only — dòng test còn lại vô hại (id mới mỗi lần) */
  }
  await db.trnExamAnswer.deleteMany({ where: { attemptId: { in: aIds } } });
  await db.trnExamAttempt.deleteMany({ where: { id: { in: aIds } } });
  await db.trnExamUnlock.deleteMany({ where: { exam: { title: { startsWith: P } } } });
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: { startsWith: P } } } });
  await db.trnExam.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: { startsWith: P } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
}

async function taoNguoi(ten: string, o: { vai?: boolean; chinhSach?: boolean; ghiDanh?: boolean } = {}): Promise<Nguoi> {
  const vai = o.vai ?? true;
  const u = await seedUser({ email: `${P.toLowerCase()}${ten}${HAU_TO}`, role: "TEACHER", name: `${P}${ten}` });
  await db.userOrgRole.deleteMany({ where: { userId: u.id } });
  if (vai) {
    const donVi = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TEACHER" }, select: { id: true } });
    await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: donVi.id, roleId: r.id, grantedById: u.id } });
  }
  if (o.chinhSach ?? true) {
    await db.trnPolicyAcceptance.upsert({
      where: {
        userId_policyKey_policyVersion: { userId: u.id, policyKey: ELEARNING_POLICY_KEY, policyVersion: currentPolicyVersion() },
      },
      update: { revokedAt: null },
      create: { userId: u.id, policyKey: ELEARNING_POLICY_KEY, policyVersion: currentPolicyVersion() },
    });
  } else {
    await db.trnPolicyAcceptance.deleteMany({ where: { userId: u.id, policyKey: ELEARNING_POLICY_KEY } }).catch(() => undefined);
  }
  const en =
    o.ghiDanh === false
      ? null
      : await db.trnEnrollment.create({
          data: {
            courseId: C.courseId,
            userId: u.id,
            cycle: 1,
            status: "NOT_STARTED",
            source: "SELF_ENROLL",
            centerId: C.centerId,
            orgUnitId: C.orgUnitId,
            snapJobTitle: "Nhân viên",
          },
          select: { id: true },
        });
  const ng = { id: u.id, enrollmentId: en?.id ?? "" };
  NG[ten] = ng;
  return ng;
}

const actorCua = (id: string): Promise<Actor> => resolveActorUncached(id);
const bat = async (id: string, input: { enrollmentId: string; lessonId: string }) =>
  (await runAction(cauHinhBatDauThi, await actorCua(id), input, { actorName: "mbt" })).res;
const demLuot = (userId: string) => db.trnExamAttempt.count({ where: { userId } });
const demDang = (userId: string) => db.trnExamAttempt.count({ where: { userId, status: "IN_PROGRESS" } });
const dauVao = (n: Nguoi, lessonId = C.lessonId) => ({ enrollmentId: n.enrollmentId, lessonId });

describe.skipIf(!RUN_DB_TESTS)("[MBT] batDauThi trả màn làm bài — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    const khoa = await db.trnCourse.create({
      data: {
        code: `${P}KHOA`,
        slug: `${P.toLowerCase()}khoa`,
        title: `${P}Khoá`,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });
    await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date() } });
    const khoaKhac = await db.trnCourse.create({
      data: {
        code: `${P}KHAC`,
        slug: `${P.toLowerCase()}khac`,
        title: `${P}Khoá khác`,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });
    const mod = await db.trnModule.create({ data: { courseId: khoa.id, title: `${P}Mô-đun`, orderIndex: 1 }, select: { id: true } });
    const modKhac = await db.trnModule.create({ data: { courseId: khoaKhac.id, title: `${P}Mô-đun khác`, orderIndex: 1 }, select: { id: true } });
    const q1 = await db.trnQuestion.create({
      data: { bankPath: `${P}q1`, type: "SINGLE", stem: "Câu một", contentJson: CAU(2, ["Một A", "Một B", "Một C", "Một D"]), defaultPoints: 2 },
      select: { id: true },
    });
    const q2 = await db.trnQuestion.create({
      data: { bankPath: `${P}q2`, type: "SINGLE", stem: "Câu hai", contentJson: CAU(0, ["Hai A", "Hai B", "Hai C"]), defaultPoints: 2 },
      select: { id: true },
    });
    const q3 = await db.trnQuestion.create({
      data: { bankPath: `${P}q3`, type: "ESSAY", stem: "Câu ba tự luận", contentJson: {}, defaultPoints: 5 },
      select: { id: true },
    });
    const de = await db.trnExam.create({
      data: {
        title: `${P}Đề`,
        durationMin: 20,
        passScore: 2,
        maxScore: 9,
        maxAttempts: 2,
        cooldownHours: 0,
        shuffleQuestions: true,
        shuffleChoices: true,
        isActive: true,
      },
      select: { id: true },
    });
    for (const [i, q] of [q1, q2, q3].entries()) {
      await db.trnExamQuestion.create({ data: { examId: de.id, questionId: q.id, orderIndex: i + 1, points: i === 2 ? 5 : 2 } });
    }
    const bai = await db.trnLesson.create({
      data: { moduleId: mod.id, title: `${P}Bài kiểm tra`, orderIndex: 1, kind: "QUIZ", examId: de.id },
      select: { id: true },
    });
    const baiKhac = await db.trnLesson.create({
      data: { moduleId: modKhac.id, title: `${P}Bài khác`, orderIndex: 1, kind: "QUIZ", examId: de.id },
      select: { id: true },
    });
    C = { courseId: khoa.id, lessonId: bai.id, examId: de.id, centerId: cs1.centerId as string, orgUnitId: cs1.id, lessonKhacId: baiKhac.id };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  it(
    "[MBT-01] ĐỐI CHỨNG DƯƠNG: người học hợp lệ bắt đầu ⇒ ok, lượt #1, trả luot đủ 3 câu, còn ≈ 20 phút + ân hạn, ĐÚNG MỘT lượt đang mở",
    async () => {
      const n = await taoNguoi(`n${++seq}`);
      const r = await bat(n.id, dauVao(n));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.attemptNo).toBe(1);
      expect(r.data.luot.attemptId).toBe(r.data.attemptId);
      expect(r.data.luot.cacCau).toHaveLength(3);
      expect(r.data.luot.conLaiGiay).toBeGreaterThan(20 * 60 - 5);
      expect(r.data.luot.conLaiGiay).toBeLessThanOrEqual(20 * 60 + 600);
      expect(await demLuot(n.id)).toBe(1);
      expect(await demDang(n.id)).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MBT-02] KHÔNG lộ đáp án: thân trả về không có correctIndex/isCorrect/explanation, mỗi lựa chọn chỉ có {ma, nhan}",
    async () => {
      const n = await taoNguoi(`n${++seq}`);
      const r = await bat(n.id, dauVao(n));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const chuoi = JSON.stringify(r.data);
      for (const khoa of ["correctIndex", "isCorrect", "explanation", "correctAnswer"]) {
        expect(chuoi, `lộ khoá "${khoa}"`).not.toContain(khoa);
      }
      for (const c of r.data.luot.cacCau) {
        for (const lc of c.luaChon) expect(Object.keys(lc).sort()).toEqual(["ma", "nhan"]);
      }
      // đối chứng dương: câu trắc nghiệm CÓ lựa chọn (không phải lọc sạch tất cả)
      const traction = r.data.luot.cacCau.filter((c) => c.type === "SINGLE");
      expect(traction).toHaveLength(2);
      expect(traction.every((c) => c.luaChon.length >= 3)).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MBT-03] `luot` của action GIỐNG HỆT bản trang học dựng cho cùng lượt (cùng thứ tự câu, cùng thứ tự lựa chọn) — hai đường không thể trả hai đề khác nhau",
    async () => {
      const n = await taoNguoi(`n${++seq}`);
      const r = await bat(n.id, dauVao(n));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const actor = await actorCua(n.id);
      const nen = await nenLamBai({ db: scopedDb(actor), userId: n.id, enrollmentId: n.enrollmentId, examId: C.examId });
      expect(nen?.luotDangLam).not.toBeNull();
      const bangTrang = { ...nen!.luotDangLam!, conLaiGiay: 0 };
      const bangAction = { ...r.data.luot, conLaiGiay: 0 };
      expect(bangAction).toEqual(bangTrang);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MBT-04] bắt đầu LẶP LẠI (RSC chậm, người học bấm lại) ⇒ trả đúng lượt đang mở, số lượt KHÔNG tăng, `luot` không đổi",
    async () => {
      const n = await taoNguoi(`n${++seq}`);
      const a = await bat(n.id, dauVao(n));
      const b = await bat(n.id, dauVao(n));
      const c = await bat(n.id, dauVao(n));
      expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
      if (!a.ok || !b.ok || !c.ok) return;
      expect(new Set([a.data.attemptId, b.data.attemptId, c.data.attemptId]).size).toBe(1);
      expect(b.data.attemptNo).toBe(1);
      expect(await demLuot(n.id)).toBe(1);
      expect({ ...b.data.luot, conLaiGiay: 0 }).toEqual({ ...a.data.luot, conLaiGiay: 0 }); // thứ tự trộn tất định theo lượt
    },
    CASE_TIMEOUT,
  );

  it(
    "[MBT-05] ĐỒNG THỜI (hai tab, mạng chập chờn): bốn lệnh cùng lúc ⇒ vẫn ĐÚNG MỘT lượt; mọi lệnh thành công cùng một attemptId, lệnh thua nhận DANG_MO_LUOT_KHAC",
    async () => {
      const n = await taoNguoi(`n${++seq}`);
      const kq = await Promise.all([1, 2, 3, 4].map(() => bat(n.id, dauVao(n))));
      const ok = kq.filter((x) => x.ok);
      expect(ok.length).toBeGreaterThanOrEqual(1); // đối chứng dương: ít nhất một lệnh THẮNG
      expect(new Set(ok.map((x) => (x.ok ? x.data.attemptId : ""))).size).toBe(1);
      for (const x of kq) if (!x.ok) expect(x.error.code).toBe("DANG_MO_LUOT_KHAC");
      expect(await demLuot(n.id)).toBe(1);
      expect(await demDang(n.id)).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MBT-06] lượt đang làm dở có câu ĐÃ LƯU ⇒ `luot` mang lại đúng lựa chọn/chữ đã lưu (rời trang, vào lại vẫn còn)",
    async () => {
      const n = await taoNguoi(`n${++seq}`);
      const a = await bat(n.id, dauVao(n));
      expect(a.ok).toBe(true);
      if (!a.ok) return;
      const caTn = a.data.luot.cacCau.find((c) => c.type === "SINGLE")!;
      const caTl = a.data.luot.cacCau.find((c) => c.type === "ESSAY")!;
      await db.trnExamAnswer.create({ data: { attemptId: a.data.attemptId, examQuestionId: caTn.examQuestionId, selectedChoiceIds: ["1"] } });
      await db.trnExamAnswer.create({
        data: { attemptId: a.data.attemptId, examQuestionId: caTl.examQuestionId, selectedChoiceIds: [], textAnswer: "Bài làm dở" },
      });
      const b = await bat(n.id, dauVao(n));
      expect(b.ok).toBe(true);
      if (!b.ok) return;
      expect(b.data.attemptId).toBe(a.data.attemptId);
      expect(b.data.luot.cacCau.find((c) => c.examQuestionId === caTn.examQuestionId)!.daChon).toEqual(["1"]);
      expect(b.data.luot.cacCau.find((c) => c.examQuestionId === caTl.examQuestionId)!.textAnswer).toBe("Bài làm dở");
      expect(await demLuot(n.id)).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MBT-07] TRẦN LƯỢT KHÔNG ĐỔI: dùng hết 2 lượt ⇒ HET_LUOT_THI và không thêm dòng; mở khoá 1 lượt ⇒ bắt đầu được (đối chứng dương)",
    async () => {
      const n = await taoNguoi(`n${++seq}`);
      for (const no of [1, 2]) {
        await db.trnExamAttempt.create({
          data: {
            examId: C.examId,
            userId: n.id,
            enrollmentId: n.enrollmentId,
            attemptNo: no,
            status: "GRADED",
            startedAt: new Date(Date.now() - 3 * 3600_000),
            submittedAt: new Date(Date.now() - 2 * 3600_000),
            centerId: C.centerId,
            orgUnitId: C.orgUnitId,
            purgeAfter: new Date(Date.now() + 90 * 86_400_000),
          },
        });
      }
      const truoc = await demLuot(n.id);
      const r = await bat(n.id, dauVao(n));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("HET_LUOT_THI");
      expect(await demLuot(n.id)).toBe(truoc);

      await db.trnExamUnlock.create({ data: { examId: C.examId, userId: n.id, unlockedByUserId: n.id, reason: "kiểm thử MBT-07", previousAttemptCount: 2 } });
      const r2 = await bat(n.id, dauVao(n));
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.data.attemptNo).toBe(3);
      expect(await demLuot(n.id)).toBe(truoc + 1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MBT-08] QUYỀN + SỞ HỮU KHÔNG ĐỔI: không có vai ⇒ PERMISSION_DENIED; lượt ghi danh CỦA NGƯỜI KHÁC ⇒ NOT_FOUND; bài của khoá khác ⇒ NOT_FOUND — không ghi gì",
    async () => {
      const chuDe = await taoNguoi(`n${++seq}`);
      const khongVai = await taoNguoi(`n${++seq}`, { vai: false });
      const ke = await taoNguoi(`n${++seq}`);

      const a = await bat(khongVai.id, dauVao(khongVai));
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.error.code).toBe("PERMISSION_DENIED");

      const b = await bat(ke.id, dauVao(chuDe)); // dùng enrollmentId của người khác
      expect(b.ok).toBe(false);
      if (!b.ok) expect(b.error.code).toBe("NOT_FOUND");

      const c = await bat(ke.id, dauVao(ke, C.lessonKhacId)); // bài thuộc khoá khác
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.error.code).toBe("NOT_FOUND");

      for (const id of [chuDe.id, khongVai.id, ke.id]) expect(await demLuot(id)).toBe(0);
      // đối chứng dương: chính `ke` bắt đầu bình thường bằng lượt ghi danh của mình
      const ok = await bat(ke.id, dauVao(ke));
      expect(ok.ok).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MBT-09] CHÍNH SÁCH + ĐỀ NHÁP KHÔNG ĐỔI: chưa xác nhận chính sách ⇒ POLICY_NOT_ACCEPTED; đề chưa kích hoạt ⇒ DE_CHUA_KICH_HOAT — không ghi gì",
    async () => {
      const chuaXacNhan = await taoNguoi(`n${++seq}`, { chinhSach: false });
      const a = await bat(chuaXacNhan.id, dauVao(chuaXacNhan));
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.error.code).toBe("POLICY_NOT_ACCEPTED");
      expect(await demLuot(chuaXacNhan.id)).toBe(0);

      const n = await taoNguoi(`n${++seq}`);
      await db.trnExam.update({ where: { id: C.examId }, data: { isActive: false } });
      try {
        const b = await bat(n.id, dauVao(n));
        expect(b.ok).toBe(false);
        if (!b.ok) expect(b.error.code).toBe("DE_CHUA_KICH_HOAT");
        expect(await demLuot(n.id)).toBe(0);
      } finally {
        await db.trnExam.update({ where: { id: C.examId }, data: { isActive: true } });
      }
      const ok = await bat(n.id, dauVao(n)); // đối chứng dương sau khi kích hoạt lại
      expect(ok.ok).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MBT-10] thứ tự câu/lựa chọn TẤT ĐỊNH THEO LƯỢT và đủ mã gốc: hai người khác nhau có thể khác thứ tự, nhưng mỗi người luôn cùng một thứ tự; tập mã lựa chọn không đổi",
    async () => {
      const a = await taoNguoi(`n${++seq}`);
      const b = await taoNguoi(`n${++seq}`);
      const ra1 = await bat(a.id, dauVao(a));
      const ra2 = await bat(a.id, dauVao(a));
      const rb = await bat(b.id, dauVao(b));
      expect(ra1.ok && ra2.ok && rb.ok).toBe(true);
      if (!ra1.ok || !ra2.ok || !rb.ok) return;
      const thuTu = (r: typeof ra1) => r.data.luot.cacCau.map((c) => `${c.examQuestionId}:${c.luaChon.map((l) => l.ma).join("")}`);
      expect(thuTu(ra2)).toEqual(thuTu(ra1)); // cùng người ⇒ cùng thứ tự
      const tapMa = (r: typeof ra1) =>
        r.data.luot.cacCau
          .filter((c) => c.type === "SINGLE")
          .map((c) => c.luaChon.map((l) => l.ma).sort().join(""))
          .sort();
      expect(tapMa(rb)).toEqual(tapMa(ra1)); // mã gốc giữ nguyên chỉ số, chỉ đổi chỗ
      expect(tapMa(ra1)).toEqual(["012", "0123"]);
    },
    CASE_TIMEOUT,
  );
});
