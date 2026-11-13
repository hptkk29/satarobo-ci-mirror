// @vitest-environment node
/**
 * F-05 — ĐÓNG LƯỢT THI BỎ DỞ QUÁ HẠN trên Postgres THẬT ([EAC-DB-*]).
 *
 * Mọi test đơn vị của khu truyền `db` giả nên không chứng minh được hai điều quan trọng nhất của việc đóng lượt: (1) MỘT lượt
 * chỉ được chấm/ghi bài học MỘT lần dù cron chạy chồng nhau hay chạy đua với người học bấm Nộp; (2) việc đóng KHÔNG đụng vào
 * câu trả lời đã lưu. Cả hai là tính chất của giao dịch + claim có điều kiện — chỉ DB thật mới đo được.
 *
 * Ca âm tính luôn có đối chứng dương (luật 11): "lượt chưa tới hạn không bị đóng" chỉ có nghĩa khi cùng lần chạy đó ĐÃ đóng
 * lượt đã quá hạn.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE; dọn theo tiền tố `CI_ELAC_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { RUN_DB_TESTS as RUN } from "../_helpers/db-gate";
import { scopedDb } from "../../lib/db-scope";
import { SYSTEM_ACTOR } from "../../lib/auth/system-actor";
import { dongLuotThiHetHan } from "../../lib/elearning/cron-dong-luot-thi";
import { kiemKeLuotTonDong } from "../../lib/elearning/kiem-ke-ton-dong";
import { cauHinhLuuCauTraLoi, cauHinhNopBai } from "../../lib/elearning/exam-taking";
import { ActionError } from "../../lib/actions/factory";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_ELAC_";
const PHUT = 60_000;
const MARGIN = 15;
const DURATION = 20;

type Luot = { attemptId: string; userId: string; enrollmentId: string };
let C: { courseId: string; lessonId: string; examId: string; examEssayId: string; centerId: string; orgUnitId: string };
let seq = 0;

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const attempts = await db.trnExamAttempt.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const aIds = attempts.map((a) => a.id);
  // `ghiXongBai` → `cuonKhoaSauKhiXongBai` phát `elearning.enrollment.completed` (dedupeKey `el.done:<enrollmentId>`): dọn để không
  // để sự kiện PENDING trỏ vào hàng đã xoá (dispatcher của DB dùng chung sẽ thử lại vô ích).
  const ens = await db.trnEnrollment.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { in: ens.map((e) => `el.done:${e.id}`) } } });
  await db.staffNotification.deleteMany({ where: { userId: { in: ids } } });
  try {
    await db.auditLog.deleteMany({ where: { entityType: "TrnExamAttempt", entityId: { in: aIds } } });
  } catch {
    /* AuditLog có thể append-only — dòng test còn lại vô hại (id mới mỗi lần) */
  }
  await db.trnExamAnswer.deleteMany({ where: { attemptId: { in: aIds } } });
  await db.trnExamAttempt.deleteMany({ where: { id: { in: aIds } } });
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: { startsWith: P } } } });
  await db.trnExam.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

const CAU = (correctIndex: number) => ({
  id: `q-${correctIndex}`,
  type: "single",
  question: "Chọn B",
  options: ["A", "B"],
  correctIndex,
});

/** Dựng MỘT lượt IN_PROGRESS cho một người học mới. `phutTruoc` = đã bắt đầu cách đây bao nhiêu phút. */
async function dungLuot(o: {
  phutTruoc: number;
  examId?: string;
  traLoiDung?: boolean | null; // null = không lưu câu nào
  enrollStatus?: "NOT_STARTED" | "REVOKED";
}): Promise<Luot> {
  const n = ++seq;
  const u = await seedUser({ email: `${P}u${n}@ci.test`, name: `${P}U${n}`, role: "TEACHER" });
  const en = await db.trnEnrollment.create({
    data: {
      courseId: C.courseId,
      userId: u.id,
      cycle: 1,
      status: o.enrollStatus ?? "NOT_STARTED",
      source: "SELF_ENROLL",
      centerId: C.centerId,
      orgUnitId: C.orgUnitId,
      snapJobTitle: "Nhân viên",
    },
    select: { id: true },
  });
  const examId = o.examId ?? C.examId;
  const at = await db.trnExamAttempt.create({
    data: {
      examId,
      userId: u.id,
      enrollmentId: en.id,
      attemptNo: 1,
      status: "IN_PROGRESS",
      startedAt: new Date(Date.now() - o.phutTruoc * PHUT),
      centerId: C.centerId,
      orgUnitId: C.orgUnitId,
      purgeAfter: new Date(Date.now() + 90 * 86_400_000),
    },
    select: { id: true },
  });
  if (o.traLoiDung !== null && o.traLoiDung !== undefined) {
    const eqs = await db.trnExamQuestion.findMany({
      where: { examId },
      orderBy: { orderIndex: "asc" },
      select: { id: true, question: { select: { type: true } } },
    });
    for (const eq of eqs) {
      if (eq.question.type !== "SINGLE") continue;
      await db.trnExamAnswer.create({
        data: { attemptId: at.id, examQuestionId: eq.id, selectedChoiceIds: [o.traLoiDung ? "1" : "0"] },
      });
    }
  }
  return { attemptId: at.id, userId: u.id, enrollmentId: en.id };
}

const hanChotCua = async (attemptId: string) => {
  const a = await db.trnExamAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: { startedAt: true },
  });
  return new Date(a.startedAt.getTime() + DURATION * PHUT);
};

const trangThai = (attemptId: string) =>
  db.trnExamAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: { status: true, totalScore: true, passed: true, submittedAt: true, gradedAt: true },
  });
const soBaiXong = (enrollmentId: string) =>
  db.trnLessonProgress.count({ where: { enrollmentId, status: "DONE" } });
const soThongBao = (attemptId: string) =>
  db.staffNotification.count({ where: { dedupeKey: `el.thi-tu-dong:${attemptId}` } });
const soAudit = (attemptId: string) =>
  db.auditLog.count({ where: { entityType: "TrnExamAttempt", entityId: attemptId } });

const chay = (now = new Date()) => dongLuotThiHetHan(now, { marginPhut: MARGIN });

describe.skipIf(!RUN)("F-05 · đóng lượt thi bỏ dở quá hạn (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    const cs1 = await db.orgUnit.findUniqueOrThrow({
      where: { code: "CS1" },
      select: { id: true, centerId: true },
    });
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
    const mod = await db.trnModule.create({
      data: { courseId: khoa.id, title: `${P}Mô-đun`, orderIndex: 1 },
      select: { id: true },
    });
    const qMay = await db.trnQuestion.create({
      data: { bankPath: `${P}may`, type: "SINGLE", stem: "Chọn B", contentJson: CAU(1), defaultPoints: 2 },
      select: { id: true },
    });
    const qTuLuan = await db.trnQuestion.create({
      data: { bankPath: `${P}tuluan`, type: "ESSAY", stem: "Viết", contentJson: {}, defaultPoints: 5 },
      select: { id: true },
    });
    const de = await db.trnExam.create({
      data: { title: `${P}Đề`, durationMin: DURATION, passScore: 2, maxScore: 2, isActive: true },
      select: { id: true },
    });
    await db.trnExamQuestion.create({ data: { examId: de.id, questionId: qMay.id, orderIndex: 1, points: 2 } });
    const deTuLuan = await db.trnExam.create({
      data: { title: `${P}Đề tự luận`, durationMin: DURATION, passScore: 2, maxScore: 7, isActive: true },
      select: { id: true },
    });
    await db.trnExamQuestion.create({ data: { examId: deTuLuan.id, questionId: qMay.id, orderIndex: 1, points: 2 } });
    await db.trnExamQuestion.create({ data: { examId: deTuLuan.id, questionId: qTuLuan.id, orderIndex: 2, points: 5 } });
    const bai = await db.trnLesson.create({
      data: { moduleId: mod.id, title: `${P}Bài kiểm tra`, orderIndex: 1, kind: "QUIZ", examId: de.id },
      select: { id: true },
    });
    C = {
      courseId: khoa.id,
      lessonId: bai.id,
      examId: de.id,
      examEssayId: deTuLuan.id,
      centerId: cs1.centerId as string,
      orgUnitId: cs1.id,
    };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  it(
    "[EAC-DB-01] chỉ đóng lượt QUÁ HẠN + biên chờ; lượt đang làm / trong biên chờ / đề đã xoá thì GIỮ NGUYÊN",
    async () => {
      const qua = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      const dangLam = await dungLuot({ phutTruoc: 5, traLoiDung: true });
      const trongBien = await dungLuot({ phutTruoc: DURATION + 5, traLoiDung: true }); // quá hạn chót nhưng chưa hết biên
      const deXoa = await db.trnExam.create({
        data: { title: `${P}Đề đã xoá`, durationMin: DURATION, passScore: 1, maxScore: 1, isActive: true, deletedAt: new Date() },
        select: { id: true },
      });
      const daXoa = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, examId: deXoa.id });

      const r = await chay();
      expect(r.loi).toEqual([]);

      // ĐỐI CHỨNG DƯƠNG: lượt quá hạn ĐÃ bị đóng — nếu không thì các ca "giữ nguyên" dưới đây xanh vì cron không chạy.
      expect((await trangThai(qua.attemptId)).status).toBe("GRADED");
      for (const l of [dangLam, trongBien, daXoa]) {
        expect((await trangThai(l.attemptId)).status, l.attemptId).toBe("IN_PROGRESS");
      }
      await db.trnExam.update({ where: { id: deXoa.id }, data: { title: `${P}Đề đã xoá (dọn)` } });
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-02] chấm đúng phần đã lưu; submittedAt = HẠN CHÓT làm bài (không phải giờ cron); đạt ⇒ ghi xong bài học",
    async () => {
      const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      await chay();
      const t = await trangThai(l.attemptId);
      expect(t.status).toBe("GRADED");
      expect(t.totalScore).toBe(2);
      expect(t.passed).toBe(true);
      expect(t.submittedAt?.getTime()).toBe((await hanChotCua(l.attemptId)).getTime());
      expect(await soBaiXong(l.enrollmentId)).toBe(1);
      const gd = await db.trnEnrollment.findUniqueOrThrow({ where: { id: l.enrollmentId }, select: { status: true } });
      expect(["COMPLETED", "COMPLETED_LATE"]).toContain(gd.status);
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-03] KHÔNG sửa câu trả lời đã lưu (selectedChoiceIds/textAnswer nguyên văn), chỉ thêm điểm",
    async () => {
      const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: false });
      const truoc = await db.trnExamAnswer.findMany({
        where: { attemptId: l.attemptId },
        select: { id: true, selectedChoiceIds: true, textAnswer: true },
        orderBy: { id: "asc" },
      });
      expect(truoc.length).toBeGreaterThan(0);
      await chay();
      const sau = await db.trnExamAnswer.findMany({
        where: { attemptId: l.attemptId },
        select: { id: true, selectedChoiceIds: true, textAnswer: true, isCorrect: true, score: true },
        orderBy: { id: "asc" },
      });
      expect(sau.map((a) => [a.id, a.selectedChoiceIds, a.textAnswer])).toEqual(
        truoc.map((a) => [a.id, a.selectedChoiceIds, a.textAnswer]),
      );
      expect(sau.every((a) => a.isCorrect === false && a.score === 0)).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-04] trượt (hoặc không lưu câu nào) ⇒ GRADED, passed=false, KHÔNG ghi xong bài học",
    async () => {
      const sai = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: false });
      const trong = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: null });
      await chay();
      for (const l of [sai, trong]) {
        const t = await trangThai(l.attemptId);
        expect(t.status).toBe("GRADED");
        expect(t.passed).toBe(false);
        expect(await soBaiXong(l.enrollmentId)).toBe(0);
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-05] có câu tự luận ⇒ PENDING_GRADE, điểm/kết quả null, KHÔNG ghi xong bài học",
    async () => {
      const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, examId: C.examEssayId, traLoiDung: true });
      await chay();
      const t = await trangThai(l.attemptId);
      expect(t.status).toBe("PENDING_GRADE");
      expect(t.totalScore).toBeNull();
      expect(t.passed).toBeNull();
      expect(t.gradedAt).toBeNull();
      expect(await soBaiXong(l.enrollmentId)).toBe(0);
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-06] lượt ghi danh đã THU HỒI: lượt vẫn được đóng nhưng KHÔNG ghi xong bài và KHÔNG lật REVOKED",
    async () => {
      const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true, enrollStatus: "REVOKED" });
      await chay();
      expect((await trangThai(l.attemptId)).status).toBe("GRADED");
      expect(await soBaiXong(l.enrollmentId)).toBe(0);
      const gd = await db.trnEnrollment.findUniqueOrThrow({ where: { id: l.enrollmentId }, select: { status: true } });
      expect(gd.status).toBe("REVOKED");
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-07] audit: đúng MỘT dòng cho mỗi lượt, hệ thống làm (actorId null), ghi closedBy AUTO_EXPIRY",
    async () => {
      const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      await chay();
      const rows = await db.auditLog.findMany({
        where: { entityType: "TrnExamAttempt", entityId: l.attemptId },
        select: { actorId: true, actorName: true, module: true, newValues: true, orgUnitId: true },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorId).toBeNull();
      expect(rows[0]!.actorName).toBe("System");
      expect(rows[0]!.module).toBe("elearning");
      expect(rows[0]!.orgUnitId).toBe(C.orgUnitId);
      expect((rows[0]!.newValues as { closedBy?: string }).closedBy).toBe("AUTO_EXPIRY");
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-08] CHẠY LẠI an toàn: lần hai không đóng thêm gì, không audit thêm, không ghi bài học thêm",
    async () => {
      const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      const r1 = await chay();
      expect(r1.daDong).toBeGreaterThanOrEqual(1);
      const t1 = await trangThai(l.attemptId);
      const r2 = await chay();
      expect(r2.daDong).toBe(0);
      expect(await soAudit(l.attemptId)).toBe(1);
      expect(await soBaiXong(l.enrollmentId)).toBe(1);
      expect((await trangThai(l.attemptId)).submittedAt?.getTime()).toBe(t1.submittedAt?.getTime());
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-09] BA lượt cron CHỒNG NHAU trên 6 lượt quá hạn ⇒ mỗi lượt đóng ĐÚNG MỘT lần (1 audit, 1 bài xong)",
    async () => {
      const ls: Luot[] = [];
      for (let i = 0; i < 6; i++) ls.push(await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true }));
      const kq = await Promise.all([chay(), chay(), chay()]);
      expect(kq.flatMap((k) => k.loi)).toEqual([]);
      for (const l of ls) {
        expect((await trangThai(l.attemptId)).status, l.attemptId).toBe("GRADED");
        expect(await soAudit(l.attemptId), `audit ${l.attemptId}`).toBe(1);
        expect(await soBaiXong(l.enrollmentId), `bài xong ${l.attemptId}`).toBe(1);
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-10] ĐUA giữa người học bấm Nộp và cron (8 lượt): mỗi lượt được đóng ĐÚNG MỘT lần, một bài xong, người thua nhận LUOT_DA_DONG/daBoQua",
    async () => {
      const ls: Luot[] = [];
      for (let i = 0; i < 8; i++) ls.push(await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true }));

      const nop = (l: Luot) => {
        const actor = { ...SYSTEM_ACTOR, userId: l.userId };
        return cauHinhNopBai
          .handler({ db: scopedDb(actor), actor, input: { attemptId: l.attemptId } } as never)
          .then(
            () => "NOP_THANG" as const,
            (e: unknown) => {
              if (e instanceof ActionError && e.code === "LUOT_DA_DONG") return "NOP_THUA" as const;
              throw e;
            },
          );
      };
      const [cron, ...nops] = await Promise.all([chay(), ...ls.map(nop)]);
      expect(cron.loi).toEqual([]);

      let nopThang = 0;
      let cronThang = 0;
      for (let i = 0; i < ls.length; i++) {
        const l = ls[i]!;
        const t = await trangThai(l.attemptId);
        expect(t.status, l.attemptId).toBe("GRADED");
        expect(t.totalScore).toBe(2);
        expect(await soBaiXong(l.enrollmentId), `bài xong ${l.attemptId}`).toBe(1);
        // audit của cron có ⇔ cron thắng claim; người học thắng ⇒ 0 dòng audit ở đây (audit đường người học thuộc factory).
        const a = await soAudit(l.attemptId);
        expect(a === 0 || a === 1).toBe(true);
        if (nops[i] === "NOP_THANG") {
          nopThang += 1;
          expect(a, "người học thắng thì cron không được ghi audit đóng").toBe(0);
        } else {
          cronThang += 1;
          expect(a, "người học thua thì cron đã đóng — đúng một audit").toBe(1);
        }
      }
      // Tổng đóng = 8 TÍNH TRÊN FIXTURE (không dựa `cron.daDong` — cron còn đóng cả lượt quá hạn của dữ liệu khác trong DB):
      // không lượt nào bị đóng đôi hay bị bỏ sót. Nhánh "thua claim" được ép xác định ở [EAC-DB-12/13].
      expect(cronThang + nopThang).toBe(8);
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-11] lượt đã đóng: nộp lần hai bị từ chối (LUOT_DA_DONG), không chấm lại, không ghi bài học thêm",
    async () => {
      const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      await chay();
      const actor = { ...SYSTEM_ACTOR, userId: l.userId };
      const e = await cauHinhNopBai
        .handler({ db: scopedDb(actor), actor, input: { attemptId: l.attemptId } } as never)
        .then(
          () => null,
          (x: unknown) => x,
        );
      expect(e).toBeInstanceOf(ActionError);
      expect((e as ActionError).code).toBe("LUOT_DA_DONG");
      expect((await trangThai(l.attemptId)).status).toBe("GRADED");
      expect(await soBaiXong(l.enrollmentId)).toBe(1);
    },
    CASE_TIMEOUT,
  );
  it(
    "[EAC-DB-12] ÉP đua: bên khác đang giữ claim, người học lưu câu ⇒ khoá hàng chặn ⇒ LUOT_DA_DONG và câu trả lời cũ NGUYÊN VẸN",
    async () => {
      // Lượt còn trong giờ làm bài (qua được `hetGio`), đã có một câu trả lời đúng.
      const l = await dungLuot({ phutTruoc: 3, traLoiDung: true });
      const eq = await db.trnExamQuestion.findFirstOrThrow({ where: { examId: C.examId }, select: { id: true } });
      const truoc = await db.trnExamAnswer.findFirstOrThrow({ where: { attemptId: l.attemptId }, select: { id: true, selectedChoiceIds: true } });
      const actor = { ...SYSTEM_ACTOR, userId: l.userId };

      let nhaClaim!: () => void;
      const daClaim = new Promise<void>((r) => (nhaClaim = r));
      const giu = db.$transaction(async (t) => {
        await t.trnExamAttempt.updateMany({
          where: { id: l.attemptId, status: "IN_PROGRESS" },
          data: { status: "PENDING_GRADE", submittedAt: new Date() },
        });
        nhaClaim();
        await new Promise((x) => setTimeout(x, 1500)); // giữ khoá hàng; chưa commit
      });
      await daClaim;
      const luu = cauHinhLuuCauTraLoi
        .handler({ db: scopedDb(actor), actor, input: { attemptId: l.attemptId, examQuestionId: eq.id, chon: [0] } } as never)
        .then(
          () => "GHI_DUOC",
          (e: unknown) => (e instanceof ActionError ? e.code : `LOI_KHAC:${String(e)}`),
        );
      const [kq] = await Promise.all([luu, giu]);
      expect(kq).toBe("LUOT_DA_DONG");
      const sau = await db.trnExamAnswer.findFirstOrThrow({ where: { attemptId: l.attemptId }, select: { id: true, selectedChoiceIds: true } });
      expect(sau).toEqual(truoc);
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-13] ÉP thua claim: bên khác đang giữ claim lượt quá hạn ⇒ cron thua (daBoQua ≥ 1), KHÔNG audit, KHÔNG chấm, KHÔNG ghi bài học",
    async () => {
      const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      let nhaClaim!: () => void;
      const daClaim = new Promise<void>((r) => (nhaClaim = r));
      const giu = db.$transaction(async (t) => {
        await t.trnExamAttempt.updateMany({
          where: { id: l.attemptId, status: "IN_PROGRESS" },
          data: { status: "PENDING_GRADE", submittedAt: new Date() },
        });
        nhaClaim();
        await new Promise((x) => setTimeout(x, 2000));
      });
      await daClaim;
      const [r] = await Promise.all([chay(), giu]); // cron thấy lượt ở IN_PROGRESS (claim chưa commit) rồi chặn ở claim của chính nó
      expect(r.daBoQua).toBeGreaterThanOrEqual(1);
      expect((await trangThai(l.attemptId)).status).toBe("PENDING_GRADE"); // đúng thứ bên giữ claim để lại — cron không chấm đè
      expect((await trangThai(l.attemptId)).totalScore).toBeNull();
      expect(await soAudit(l.attemptId)).toBe(0);
      expect(await soBaiXong(l.enrollmentId)).toBe(0);
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-14] ĐỐI SOÁT: lượt ĐẠT đã GRADED mà bài chưa DONE được vá; bài đã DONE không bị đụng (lastActivityAt nguyên); ghi danh THU HỒI bỏ qua",
    async () => {
      const now = new Date();
      const taoDat = async (o: { revoked?: boolean; daXong?: boolean }) => {
        const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true, enrollStatus: o.revoked ? "REVOKED" : "NOT_STARTED" });
        // Giả lập "lượt đã đóng + đạt nhưng bước ghi bài hỏng": đóng thẳng bằng DB, KHÔNG gọi ghiXongBai.
        await db.trnExamAttempt.update({
          where: { id: l.attemptId },
          data: { status: "GRADED", passed: true, totalScore: 2, submittedAt: now, gradedAt: now },
        });
        if (o.daXong) {
          await db.trnLessonProgress.create({
            data: {
              enrollmentId: l.enrollmentId,
              userId: l.userId,
              lessonId: C.lessonId,
              status: "DONE",
              lastActivityAt: new Date(now.getTime() - 3_600_000),
              verifiedAt: now,
              completedAt: now,
            },
          });
        }
        return l;
      };
      const can = await taoDat({});
      const daXong = await taoDat({ daXong: true });
      const thuHoi = await taoDat({ revoked: true });
      const hoatDongTruoc = (
        await db.trnLessonProgress.findFirstOrThrow({ where: { enrollmentId: daXong.enrollmentId }, select: { lastActivityAt: true } })
      ).lastActivityAt.getTime();

      const r = await chay();
      expect(r.loi).toEqual([]);
      expect(r.daVa).toBeGreaterThanOrEqual(1);
      expect(await soBaiXong(can.enrollmentId)).toBe(1); // đã vá
      const sau = (
        await db.trnLessonProgress.findFirstOrThrow({ where: { enrollmentId: daXong.enrollmentId }, select: { lastActivityAt: true } })
      ).lastActivityAt.getTime();
      expect(sau).toBe(hoatDongTruoc); // bài đã DONE không bị đụng
      expect(await soBaiXong(thuHoi.enrollmentId)).toBe(0); // thu hồi ⇒ bỏ qua
      const gd = await db.trnEnrollment.findUniqueOrThrow({ where: { id: thuHoi.enrollmentId }, select: { status: true } });
      expect(gd.status).toBe("REVOKED");

      const r2 = await chay();
      expect(r2.daVa).toBe(0); // chạy lại: không vá thêm
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-15] không bị lượt của đề DÀI (chưa tới hạn) chặn đầu hàng đợi: trang quét nhỏ vẫn tới được lượt quá hạn của đề ngắn",
    async () => {
      const deDai = await db.trnExam.create({
        data: { title: `${P}Đề dài`, durationMin: 600, passScore: 1, maxScore: 1, isActive: true },
        select: { id: true },
      });
      // 3 lượt đề dài bắt đầu SỚM HƠN lượt đề ngắn quá hạn ⇒ nằm trước theo startedAt, nhưng chưa tới hạn.
      const dai = [];
      for (let i = 0; i < 3; i++) dai.push(await dungLuot({ phutTruoc: DURATION + MARGIN + 60, examId: deDai.id }));
      const ngan = await dungLuot({ phutTruoc: DURATION + MARGIN + 20, traLoiDung: true });
      const r = await dongLuotThiHetHan(new Date(), { marginPhut: MARGIN, trang: 2 }); // trang 2 < 3 lượt đề dài đứng trước
      expect(r.loi).toEqual([]);
      expect((await trangThai(ngan.attemptId)).status).toBe("GRADED"); // tới được dù 3 hàng đầu là lượt chưa tới hạn
      for (const l of dai) expect((await trangThai(l.attemptId)).status, "lượt đề dài chưa tới hạn không bị đóng").toBe("IN_PROGRESS");
    },
    CASE_TIMEOUT,
  );
  it(
    "[EAC-DB-16] THÔNG BÁO trong ứng dụng: bên THẮNG claim báo người học đúng MỘT lần (chạy lại không báo thêm); người học tự nộp thì cron KHÔNG báo",
    async () => {
      const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      const tuNop = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      const actor = { ...SYSTEM_ACTOR, userId: tuNop.userId };
      await cauHinhNopBai.handler({ db: scopedDb(actor), actor, input: { attemptId: tuNop.attemptId } } as never);

      const r1 = await chay();
      expect(r1.loi).toEqual([]);
      expect(r1.daBaoNguoiHoc).toBeGreaterThanOrEqual(1);
      expect(await soThongBao(l.attemptId)).toBe(1);
      const tb = await db.staffNotification.findFirstOrThrow({
        where: { dedupeKey: `el.thi-tu-dong:${l.attemptId}` },
        select: { userId: true, href: true, title: true },
      });
      expect(tb.userId).toBe(l.userId); // đúng người học, không ai khác
      expect(tb.href).toBe(`/elearning/hoc/${l.enrollmentId}`);
      expect(tb.title).toContain("hết giờ");
      expect(await soThongBao(tuNop.attemptId)).toBe(0); // người học thắng claim ⇒ không có gì để báo

      await chay();
      expect(await soThongBao(l.attemptId)).toBe(1); // idempotent
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-17] lượt tồn đọng CŨ hơn 24 giờ đóng IM LẶNG (không báo người học); lượt vừa hết hạn thì có báo (đối chứng)",
    async () => {
      const cu = await dungLuot({ phutTruoc: 48 * 60, traLoiDung: true });
      const moi = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      await chay();
      expect((await trangThai(cu.attemptId)).status).toBe("GRADED"); // vẫn được đóng…
      expect(await soThongBao(cu.attemptId)).toBe(0); // …nhưng không báo
      expect(await soThongBao(moi.attemptId)).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-18] cổng người nhận: đặt ELEARNING_NOTIFY_ONLY_EMAIL_DOMAIN thì người học NGOÀI miền không nhận chuông, nhưng lượt vẫn được đóng",
    async () => {
      const truoc = process.env.ELEARNING_NOTIFY_ONLY_EMAIL_DOMAIN;
      process.env.ELEARNING_NOTIFY_ONLY_EMAIL_DOMAIN = "uat.satarobo.invalid";
      try {
        const l = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true }); // email @ci.test — không thuộc miền UAT
        const r = await chay();
        expect(r.loi).toEqual([]);
        expect((await trangThai(l.attemptId)).status).toBe("GRADED");
        expect(await soThongBao(l.attemptId)).toBe(0);
      } finally {
        if (truoc === undefined) delete process.env.ELEARNING_NOTIFY_ONLY_EMAIL_DOMAIN;
        else process.env.ELEARNING_NOTIFY_ONLY_EMAIL_DOMAIN = truoc;
      }
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-19] giới hạn tuổi (câu owner #7): lượt cũ hơn mốc GIỮ NGUYÊN trạng thái đang làm, lượt trong mốc được đóng (đối chứng)",
    async () => {
      const cu = await dungLuot({ phutTruoc: 5 * 24 * 60, traLoiDung: true });
      const moi = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      const r = await dongLuotThiHetHan(new Date(), { marginPhut: MARGIN, tuoiToiDaNgay: 2 });
      expect(r.boQuaQuaCu).toBeGreaterThanOrEqual(1);
      expect((await trangThai(moi.attemptId)).status).toBe("GRADED");
      expect((await trangThai(cu.attemptId)).status).toBe("IN_PROGRESS");
      expect(await soAudit(cu.attemptId)).toBe(0);
    },
    CASE_TIMEOUT,
  );

  it(
    "[EAC-DB-20] KIỂM KÊ trước lần bật đầu: đếm đúng lượt sẽ đóng, lượt không có câu trả lời, lượt đóng im lặng, lượt bị giới hạn tuổi — và KHÔNG ghi/gửi gì",
    async () => {
      // Số tuyệt đối phụ thuộc DB dùng chung ⇒ đo CHÊNH LỆCH trước/sau khi dựng đúng 4 lượt fixture.
      const goc = await kiemKeLuotTonDong(new Date(), { marginPhut: MARGIN });
      const gocGioiHan = await kiemKeLuotTonDong(new Date(), { marginPhut: MARGIN, tuoiToiDaNgay: 2 });
      const coCau = await dungLuot({ phutTruoc: DURATION + MARGIN + 10, traLoiDung: true });
      const khongCau = await dungLuot({ phutTruoc: DURATION + MARGIN + 11, traLoiDung: null });
      const cu = await dungLuot({ phutTruoc: 3 * 24 * 60, traLoiDung: true });
      const dangLam = await dungLuot({ phutTruoc: 5, traLoiDung: true });

      const dem = async () => ({
        attempts: await db.trnExamAttempt.count({ where: { status: "IN_PROGRESS" } }),
        audit: await db.auditLog.count({ where: { entityType: "TrnExamAttempt" } }),
        tb: await db.staffNotification.count({ where: { dedupeKey: { startsWith: "el.thi-tu-dong:" } } }),
      });
      const truoc = await dem();
      const tatCa = await kiemKeLuotTonDong(new Date(), { marginPhut: MARGIN });
      const gioiHan = await kiemKeLuotTonDong(new Date(), { marginPhut: MARGIN, tuoiToiDaNgay: 2 });
      expect(await dem()).toEqual(truoc); // chỉ-đọc

      expect(tatCa.dangLam - goc.dangLam).toBe(4); // cả bốn lượt fixture đang làm
      expect(tatCa.seDong - goc.seDong).toBe(3); // coCau + khongCau + cu — lượt còn trong giờ KHÔNG tính
      expect(tatCa.seDongKhongCoCauTraLoi - goc.seDongKhongCoCauTraLoi).toBe(1); // chỉ khongCau
      expect(tatCa.seDongImLang - goc.seDongImLang).toBe(1); // chỉ cu (3 ngày)
      expect(gioiHan.seBoQuaQuaCu - gocGioiHan.seBoQuaQuaCu).toBe(1); // cu bị giới hạn tuổi 2 ngày bỏ qua
      expect(gioiHan.seDong - gocGioiHan.seDong).toBe(2); // còn coCau + khongCau
      expect(tatCa.theoDe.some((d) => d.tieuDe === `${P}Đề`)).toBe(true);
      expect(JSON.stringify(tatCa)).not.toMatch(/ci\.test|@/); // không lộ định danh người học
      // lượt fixture chưa bị đụng
      for (const l of [coCau, khongCau, cu, dangLam]) expect((await trangThai(l.attemptId)).status).toBe("IN_PROGRESS");
    },
    CASE_TIMEOUT,
  );
});
