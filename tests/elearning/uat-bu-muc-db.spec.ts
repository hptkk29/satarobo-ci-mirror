// @vitest-environment node
/**
 * UAT bù — bốn ca của ma trận UAT mà TEST không dựng được bằng giao diện với tài khoản hiện có, chạy trên Postgres THẬT
 * với đúng handler của sản phẩm: B07 (kho câu hỏi) · C06 / C07 (thu hồi lượt giao) · I04 (dọn dữ liệu thô giữ kết luận).
 *
 * Vì sao không chạy qua giao diện TEST: C06 cần một lượt giao do Hội sở tạo có người ở CẢ HAI cơ sở, mà không tài khoản UAT nào
 * neo ở Hội sở có quyền giao bài; I04 cần dữ liệu thô quá 90 ngày. Bằng chứng ở đây là mức DB thật, KHÔNG phải màn hình TEST —
 * `ket-qua-test-24-10.md` ghi rõ mức đó.
 *
 * Mỗi ca âm tính có đối chứng dương (luật 11). ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_ELUB_`.
 * ⚠️ I04 chạy `runElearningDem` (cron đêm) trên DB test cục bộ: nó quét toàn bảng, nên chỉ khẳng định về dòng của fixture.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { RUN_DB_TESTS as RUN } from "../_helpers/db-gate";
import { resolveActorUncached, type Actor } from "../../lib/auth/actor";
import { scopedDb } from "../../lib/db-scope";
import { cauHinhThuHoi } from "../../lib/elearning/assignment-lifecycle";
import { cauHinhTaoCauHoi, cauHinhSuaCauHoi, cauHinhXoaCauHoi } from "../../lib/elearning/question-bank";
import { runElearningDem } from "../../lib/elearning/cron-dem";
import { ActionError } from "../../lib/actions/factory";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_ELUB_";
const NGAY = 86_400_000;

let F: {
  qlCs1: string;
  dtCs1: string;
  traHo: string;
  hv1: string;
  hv2: string;
  hv3: string;
  courseId: string;
  lessonId: string;
  centerHo: string;
  ho: { id: string };
  cs1: { id: string; centerId: string | null };
  cs2: { id: string; centerId: string | null };
};

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const attempts = await db.trnExamAttempt.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  await db.trnExamAnswer.deleteMany({ where: { attemptId: { in: attempts.map((a) => a.id) } } });
  await db.trnExamAttempt.deleteMany({ where: { userId: { in: ids } } });
  await db.trnVideoSession.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { OR: [{ userId: { in: ids } }, { assignment: { title: { startsWith: P } } }] } });
  await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnExamQuestion.deleteMany({ where: { exam: { title: { startsWith: P } } } });
  await db.trnExam.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnChoice.deleteMany({ where: { question: { bankPath: { startsWith: "/ci-elub/" } } } });
  await db.trnQuestion.deleteMany({ where: { bankPath: { startsWith: "/ci-elub/" } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  await db.center.deleteMany({ where: { slug: "ho-test-elub", address: "CI_ELUB" } });
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function gan(userId: string, orgUnitId: string, vai: string) {
  const rd = await db.roleDef.findUniqueOrThrow({ where: { code: vai }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId, orgUnitId, roleId: rd.id, status: "ACTIVE", grantedById: userId } });
}

const handler = <I, O>(
  cfg: { handler: (a: never) => Promise<O> },
  actor: Actor,
  input: I,
  reason?: string,
) => cfg.handler({ db: scopedDb(actor), actor, input, reason } as never);

let seq = 0;
async function dungLuotGiao(o: { ten: string; trongCs: { userId: string; cs: "cs1" | "cs2"; status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" }[] }) {
  const a = await db.trnAssignment.create({
    data: {
      title: `${P}${o.ten}`,
      contentType: "COURSE",
      contentId: F.courseId,
      audienceMode: "STATIC",
      status: "ACTIVE",
      allowLate: true,
      completionRuleJson: { kieu: "MOI_BAI_BAT_BUOC" },
      centerId: F.centerHo, // lượt giao do Hội sở tạo neo về Center "HO" — khác cơ sở của người học
      orgUnitId: F.ho.id,
      createdByUserId: F.traHo,
    },
    select: { id: true },
  });
  const ens: Record<string, string> = {};
  for (const x of o.trongCs) {
    const cs = F[x.cs];
    const e = await db.trnEnrollment.create({
      data: {
        courseId: F.courseId,
        userId: x.userId,
        assignmentId: a.id,
        cycle: ++seq,
        status: x.status,
        source: "ASSIGNMENT",
        centerId: cs.centerId as string,
        orgUnitId: cs.id,
        snapJobTitle: "Nhân viên",
      },
      select: { id: true },
    });
    ens[x.userId] = e.id;
  }
  return { assignmentId: a.id, ens };
}

const stEnroll = async (id: string) =>
  (await db.trnEnrollment.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const stAssign = async (id: string) =>
  (await db.trnAssignment.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

describe.skipIf(!RUN)("UAT bù · B07 C06 C07 I04 (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const [ho, cs1, cs2] = await Promise.all(
      ["HO", "CS1", "CS2"].map((code) => db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true, centerId: true } })),
    );
    const coSoHoCo = await db.center.findFirst({ where: { code: "HO" }, select: { id: true } });
    const coSoHo =
      coSoHoCo ??
      (await db.center.create({
        data: { code: "HO", name: "Hội sở (test)", slug: "ho-test-elub", address: "CI_ELUB" },
        select: { id: true },
      }));

    const qlCs1 = await seedUser({ email: `${P}ql1@ci.test`, name: `${P}QL1`, role: "CENTER_MANAGER" });
    const dtCs1 = await seedUser({ email: `${P}dt1@ci.test`, name: `${P}DT1`, role: "TRAINING" });
    const traHo = await seedUser({ email: `${P}ho@ci.test`, name: `${P}HO`, role: "TRAINING" });
    const hv1 = await seedUser({ email: `${P}hv1@ci.test`, name: `${P}HV1`, role: "TEACHER" });
    const hv2 = await seedUser({ email: `${P}hv2@ci.test`, name: `${P}HV2`, role: "TEACHER" });
    const hv3 = await seedUser({ email: `${P}hv3@ci.test`, name: `${P}HV3`, role: "TEACHER" });
    await gan(qlCs1.id, cs1.id, "CENTER_MANAGER");
    await gan(dtCs1.id, cs1.id, "TRAINING");
    await gan(traHo.id, ho.id, "TRAINING");

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
    const mod = await db.trnModule.create({ data: { courseId: khoa.id, title: `${P}Mô-đun`, orderIndex: 1 }, select: { id: true } });
    const bai = await db.trnLesson.create({
      data: { moduleId: mod.id, title: `${P}Bài video`, orderIndex: 1, kind: "VIDEO", videoKey: "x", durationSec: 60 },
      select: { id: true },
    });
    F = {
      qlCs1: qlCs1.id,
      dtCs1: dtCs1.id,
      traHo: traHo.id,
      hv1: hv1.id,
      hv2: hv2.id,
      hv3: hv3.id,
      courseId: khoa.id,
      lessonId: bai.id,
      centerHo: coSoHo.id,
      ho,
      cs1,
      cs2,
    };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  // ── C06 ────────────────────────────────────────────────────────────────────
  it(
    "[C06] QLCS CS1 thu hồi lượt giao Hội sở: CHỈ phần CS1 bị thu hồi, phần CS2 GIỮ NGUYÊN, lượt giao KHÔNG bị đóng; ĐỐI CHỨNG: Hội sở thu hồi ⇒ đóng cả lượt giao",
    async () => {
      const g = await dungLuotGiao({
        ten: "C06 Hội sở nhiều cơ sở",
        trongCs: [
          { userId: F.hv1, cs: "cs1", status: "NOT_STARTED" },
          { userId: F.hv3, cs: "cs2", status: "NOT_STARTED" },
        ],
      });
      const ql = await resolveActorUncached(F.qlCs1);
      const r = await handler<unknown, { data: { soThuHoi: number } }>(
        cauHinhThuHoi as never,
        ql,
        { pham: { kieu: "LUOT_GIAO", assignmentId: g.assignmentId } },
        "UAT C06",
      );
      expect(r.data.soThuHoi).toBe(1);
      expect(await stEnroll(g.ens[F.hv1]!)).toBe("REVOKED");
      expect(await stEnroll(g.ens[F.hv3]!)).toBe("NOT_STARTED"); // ngoài tầm nhìn ⇒ giữ nguyên
      expect(await stAssign(g.assignmentId)).toBe("ACTIVE"); // không được đóng lượt giao của cả công ty

      // ĐỐI CHỨNG DƯƠNG: người cấp Hội sở nhìn thấy cả hai phần ⇒ thu hồi nốt và ĐÓNG lượt giao.
      const ho = await resolveActorUncached(F.traHo);
      await handler(cauHinhThuHoi as never, ho, { pham: { kieu: "LUOT_GIAO", assignmentId: g.assignmentId } }, "UAT C06 đối chứng");
      expect(await stEnroll(g.ens[F.hv3]!)).toBe("REVOKED");
      expect(await stAssign(g.assignmentId)).toBe("REVOKED");
    },
    CASE_TIMEOUT,
  );

  // ── C07 ────────────────────────────────────────────────────────────────────
  it(
    "[C07] thu hồi cả lượt giao: người ĐÃ HOÀN THÀNH (kể cả trễ) GIỮ NGUYÊN trạng thái; người đang học bị thu hồi",
    async () => {
      const g = await dungLuotGiao({
        ten: "C07 có người đã xong",
        trongCs: [
          { userId: F.hv1, cs: "cs1", status: "COMPLETED" },
          { userId: F.hv2, cs: "cs1", status: "IN_PROGRESS" },
        ],
      });
      const ho = await resolveActorUncached(F.traHo);
      const r = await handler<unknown, { data: { soThuHoi: number; boQua: { lyDo: string }[] } }>(
        cauHinhThuHoi as never,
        ho,
        { pham: { kieu: "LUOT_GIAO", assignmentId: g.assignmentId } },
        "UAT C07",
      );
      expect(r.data.soThuHoi).toBe(1);
      expect(r.data.boQua.map((x) => x.lyDo)).toEqual(["DA_HOAN_THANH"]);
      expect(await stEnroll(g.ens[F.hv1]!)).toBe("COMPLETED");
      expect(await stEnroll(g.ens[F.hv2]!)).toBe("REVOKED"); // đối chứng dương: thu hồi CÓ chạy
    },
    CASE_TIMEOUT,
  );

  // ── B07 ────────────────────────────────────────────────────────────────────
  it(
    "[B07] kho câu hỏi: tạo / sửa / xoá được câu CHƯA vào đề; câu ĐÃ vào đề không sửa, không xoá (CAU_DA_VAO_DE) và vẫn nguyên",
    async () => {
      const dt = await resolveActorUncached(F.dtCs1);
      const tao = await handler<unknown, { data: { questionId: string } }>(cauHinhTaoCauHoi as never, dt, {
        bankPath: "/ci-elub/an-toan/",
        type: "SINGLE",
        stem: "UAT: chọn đáp án B",
        choices: [
          { text: "A", isCorrect: false },
          { text: "B", isCorrect: true },
        ],
      });
      const qid = tao.data.questionId;
      expect(await db.trnQuestion.count({ where: { id: qid, deletedAt: null } })).toBe(1);

      await handler(cauHinhSuaCauHoi as never, dt, {
        questionId: qid,
        bankPath: "/ci-elub/an-toan/",
        type: "SINGLE",
        stem: "UAT: chọn đáp án A (đã sửa)",
        choices: [
          { text: "A", isCorrect: true },
          { text: "B", isCorrect: false },
        ],
      });
      expect((await db.trnQuestion.findUniqueOrThrow({ where: { id: qid }, select: { stem: true } })).stem).toContain("đã sửa");

      // Đưa vào đề ⇒ không sửa, không xoá nữa.
      const de = await db.trnExam.create({
        data: { title: `${P}Đề B07`, durationMin: 10, passScore: 1, maxScore: 1, isActive: false },
        select: { id: true },
      });
      await db.trnExamQuestion.create({ data: { examId: de.id, questionId: qid, orderIndex: 1, points: 1 } });

      const loi = async (p: Promise<unknown>) =>
        p.then(
          () => null,
          (e: unknown) => (e instanceof ActionError ? e.code : "KHAC"),
        );
      const stemTruoc = (await db.trnQuestion.findUniqueOrThrow({ where: { id: qid }, select: { stem: true } })).stem;
      expect(
        await loi(
          handler(cauHinhSuaCauHoi as never, dt, {
            questionId: qid,
            bankPath: "/ci-elub/an-toan/",
            type: "SINGLE",
            stem: "UAT: cố sửa câu đã vào đề",
            choices: [
              { text: "A", isCorrect: false },
              { text: "B", isCorrect: true },
            ],
          }),
        ),
      ).toBe("CAU_DA_VAO_DE");
      expect(await loi(handler(cauHinhXoaCauHoi as never, dt, { questionId: qid }))).toBe("CAU_DA_VAO_DE");
      const sau = await db.trnQuestion.findUniqueOrThrow({ where: { id: qid }, select: { stem: true, deletedAt: true } });
      expect(sau.stem).toBe(stemTruoc);
      expect(sau.deletedAt).toBeNull();

      // ĐỐI CHỨNG DƯƠNG: câu chưa vào đề thì xoá được (xoá mềm).
      const tao2 = await handler<unknown, { data: { questionId: string } }>(cauHinhTaoCauHoi as never, dt, {
        bankPath: "/ci-elub/an-toan/",
        type: "ESSAY",
        stem: "UAT: câu tự luận chưa vào đề",
      });
      await handler(cauHinhXoaCauHoi as never, dt, { questionId: tao2.data.questionId });
      expect((await db.trnQuestion.findUniqueOrThrow({ where: { id: tao2.data.questionId }, select: { deletedAt: true } })).deletedAt).not.toBeNull();
    },
    CASE_TIMEOUT,
  );

  // ── I04 ────────────────────────────────────────────────────────────────────
  it(
    "[I04] cron đêm dọn dữ liệu THÔ > 90 ngày nhưng GIỮ coveredSec / verifiedAt / completedAt / trạng thái / điểm; ĐỐI CHỨNG: dữ liệu mới giữ nguyên",
    async () => {
      const cu = new Date(Date.now() - 120 * NGAY);
      const moi = new Date(Date.now() - 5 * NGAY);
      const en = (userId: string, cycle: number) =>
        db.trnEnrollment.create({
          data: {
            courseId: F.courseId,
            userId,
            cycle,
            status: "COMPLETED",
            source: "SELF_ENROLL",
            centerId: F.cs1.centerId as string,
            orgUnitId: F.cs1.id,
            snapJobTitle: "Nhân viên",
          },
          select: { id: true },
        });
      const enCu = await en(F.hv1, 900);
      const enMoi = await en(F.hv2, 901);
      const tienDo = (enrollmentId: string, userId: string, lastActivityAt: Date) =>
        db.trnLessonProgress.create({
          data: {
            enrollmentId,
            userId,
            lessonId: F.lessonId,
            status: "DONE",
            coveredSec: 60,
            contentSec: 60,
            segmentBitmap: Buffer.from([255, 255, 255]),
            lastActivityAt,
            verifiedAt: cu,
            completedAt: cu,
          },
          select: { id: true },
        });
      const tdCu = await tienDo(enCu.id, F.hv1, cu);
      const tdMoi = await tienDo(enMoi.id, F.hv2, moi);

      const de = await db.trnExam.create({
        data: { title: `${P}Đề I04`, durationMin: 10, passScore: 1, maxScore: 1, isActive: true },
        select: { id: true },
      });
      const luot = (userId: string, purgeAfter: Date) =>
        db.trnExamAttempt.create({
          data: {
            examId: de.id,
            userId,
            attemptNo: 1,
            status: "GRADED",
            totalScore: 1,
            passed: true,
            submittedAt: cu,
            gradedAt: cu,
            ipHash: "abc",
            ipPrefix: "10.0.0",
            deviceClass: "desktop",
            browserFamily: "Chrome",
            centerId: F.cs1.centerId as string,
            orgUnitId: F.cs1.id,
            purgeAfter,
          },
          select: { id: true },
        });
      const luotCu = await luot(F.hv1, new Date(Date.now() - NGAY));
      const luotMoi = await luot(F.hv2, new Date(Date.now() + 30 * NGAY));

      const phien = (userId: string, purgeAfter: Date) =>
        db.trnVideoSession.create({
          data: { lessonId: F.lessonId, userId, totalWatchSec: 50, purgeAfter },
          select: { id: true },
        });
      const phienCu = await phien(F.hv1, new Date(Date.now() - NGAY));
      const phienMoi = await phien(F.hv2, new Date(Date.now() + 30 * NGAY));

      const ket = await runElearningDem(new Date());
      // Không dựa vào hình dạng của `loi` (đổi hình ⇒ bộ lọc khớp rỗng ⇒ xanh giả): chuỗi hoá cả mảng.
      expect(JSON.stringify(ket.loi)).not.toContain("don-tang-2");

      // Dữ liệu thô QUÁ HẠN bị dọn…
      const a = await db.trnLessonProgress.findUniqueOrThrow({ where: { id: tdCu.id } });
      expect(a.segmentBitmap).toBeNull();
      expect(a.bitmapPurgedAt).not.toBeNull();
      expect((await db.trnExamAttempt.findUniqueOrThrow({ where: { id: luotCu.id } })).ipHash).toBeNull();
      expect(await db.trnVideoSession.count({ where: { id: phienCu.id } })).toBe(0);

      // …nhưng KẾT LUẬN nghiệp vụ giữ nguyên.
      expect(a.status).toBe("DONE");
      expect(a.coveredSec).toBe(60);
      expect(a.verifiedAt?.getTime()).toBe(cu.getTime());
      expect(a.completedAt?.getTime()).toBe(cu.getTime());
      const lc = await db.trnExamAttempt.findUniqueOrThrow({ where: { id: luotCu.id } });
      expect([lc.status, lc.totalScore, lc.passed]).toEqual(["GRADED", 1, true]);
      expect((await db.trnEnrollment.findUniqueOrThrow({ where: { id: enCu.id }, select: { status: true } })).status).toBe("COMPLETED");

      // ĐỐI CHỨNG DƯƠNG: dữ liệu CÒN hạn không bị đụng — nếu không, "dọn" xanh vì cron xoá tất cả.
      const m = await db.trnLessonProgress.findUniqueOrThrow({ where: { id: tdMoi.id } });
      expect(m.segmentBitmap).not.toBeNull();
      expect(m.bitmapPurgedAt).toBeNull();
      expect((await db.trnExamAttempt.findUniqueOrThrow({ where: { id: luotMoi.id } })).ipHash).toBe("abc");
      expect(await db.trnVideoSession.count({ where: { id: phienMoi.id } })).toBe(1);
    },
    CASE_TIMEOUT,
  );
});
