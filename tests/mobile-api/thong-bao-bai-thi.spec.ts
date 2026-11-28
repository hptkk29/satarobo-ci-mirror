import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { onExamAttemptGradedNotif } from "@/lib/_handlers/exam-notif";
import { db } from "@/lib/db";
import { layTinHocSinh } from "@/lib/mobile-api/dich-vu/thong-bao-hoc-sinh";
import type { MaHocVienDaKiem } from "@/lib/mobile-api/so-huu";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [TBBTH] V8.24 — thông báo khi CHẤM BÀI THI (ExamAttempt, LMS lớp offline).
 *   [TBBTH-W1] (lưới mã nguồn) `gradeAttempt` phát `exam.attempt.graded` TRONG transaction chấm; handler đã đăng ký; tin học sinh theo danh sách cho phép; nội dung không có điểm/coin/push
 *   [TBBTH-DB-01] lượt GRADED ⇒ «Bài thi đã được chấm» đúng học viên; nội dung KHÔNG có điểm; phát lại cùng mốc ⇒ không trùng; mốc mới (chấm lại) ⇒ thông báo mới
 *   [TBBTH-DB-02] KHÔNG tin payload: lượt chưa chấm (SUBMITTED) · lượt của học viên khác · lượt không tồn tại ⇒ không tạo thông báo
 *   [TBBTH-DB-03] học sinh (Student Mode) thấy tin của CHÍNH mình, KHÔNG thấy tin của anh/chị/em
 *   [TBBTH-DB-04] cờ PORTAL_BAI_TAP_BAI_THI_ENABLED TẮT ⇒ KHÔNG tạo thông báo (tính năng đang ẩn)
 */
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const doc = (p: string) => bo(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[TBBTH-W1] dây nối thông báo chấm bài thi", () => {
  it("gradeAttempt phát sự kiện trong tx; handler + danh sách cho phép; không điểm/coin/push", () => {
    const a = doc("app/(admin)/admin/exams/_actions.ts");
    expect((a.match(/publishEvent\(\s*"exam\.attempt\.graded"/g) ?? []).length).toBe(1);
    const i = a.search(/publishEvent\(\s*"exam\.attempt\.graded"/);
    expect(a.slice(i, i + 420)).toMatch(/\{ tx: tx as unknown as Prisma\.TransactionClient, dedupeKey: `exam\.attempt\.graded:/);
    expect(a.indexOf("tx.examAttempt.update(")).toBeGreaterThan(-1);
    expect(a.indexOf("tx.examAttempt.update(")).toBeLessThan(i); // phát SAU khi ghi trạng thái GRADED, cùng tx
    expect(a.slice(i - 420, i)).toMatch(/attempt\.status !== "GRADED" \|\| attempt\.totalScore !== totalScore/); // bấm «Chấm» lặp lại không sinh tin lặp
    expect(doc("lib/events/register.ts")).toContain("registerExamNotifHandlers();");
    const h = doc("lib/_handlers/exam-notif.ts");
    expect(h).toContain('on("exam.attempt.graded"');
    expect(h).toContain('l.status !== "GRADED"'); // không tin payload
    expect(h).toContain("mucBaiTapBaiThiDangHien()"); // cờ ẩn tính năng
    expect(h).not.toMatch(/totalScore|passed|feedback|sataCoin|satacoin|webPush|fcm|apns|sendPush/i);
    expect(doc("lib/mobile-api/dich-vu/thong-bao-hoc-sinh.ts")).toContain('"exam.attempt.graded:"');
  });
});

const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));
const NS = "tbbth-";
const A = (k: string) => `${NS}${k}`;
const ev = (payload: Record<string, unknown>) => ({ id: A("ev"), type: "x", payload });

async function don() {
  await db.notification.deleteMany({ where: { OR: [{ dedupeKey: { startsWith: `exam.attempt.graded:${NS}` } }, { studentId: { startsWith: NS } }] } });
  await db.examAttempt.deleteMany({ where: { id: { startsWith: NS } } });
  await db.exam.deleteMany({ where: { id: { startsWith: NS } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
}

describe.skipIf(!RUN)("[TBBTH-DB] thông báo chấm bài thi — Postgres thật", () => {
  const S1 = A("s1");
  const S2 = A("s2");
  beforeAll(async () => {
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true";
    await don();
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở TBBTH", slug: A("cs"), address: "Địa chỉ" } });
    await db.course.create({ data: { id: A("kh"), name: "Khoá TBBTH", slug: A("kh"), totalSessions: 12 } });
    await db.class.create({ data: { id: A("l1"), name: "Lớp l1", classCode: A("l1"), courseId: A("kh"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
    await db.student.create({ data: { id: S1, name: "An", centerId: A("cs") } as never });
    await db.student.create({ data: { id: S2, name: "Bình", centerId: A("cs") } as never });
    for (const [id, sv] of [["dk1", S1], ["dk2", S2]] as const) await db.enrollment.create({ data: { id: A(id), studentId: sv, classId: A("l1"), courseId: A("kh"), status: "ACTIVE", centerId: A("cs") } as never });
    await db.exam.create({ data: { id: A("de"), title: "Bài thi TBBTH", classId: A("l1"), status: "PUBLISHED", maxAttempts: 3, durationMinutes: 15, totalPoints: 10, passingScore: 5 } as never });
    const lan = (id: string, sv: string, status: "GRADED" | "SUBMITTED") => db.examAttempt.create({ data: { id: A(id), examId: A("de"), studentId: sv, attemptNo: 1, status, totalScore: 7, passed: true, submittedAt: new Date() } as never });
    await lan("l-s1", S1, "GRADED");
    await lan("l-s2-cho", S2, "SUBMITTED");
  }, 60_000);
  afterAll(async () => {
    await don();
    delete process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED;
  });

  it("[TBBTH-DB-01] GRADED ⇒ báo đúng học viên, không điểm; phát lại cùng mốc không trùng; mốc mới ⇒ tin mới", async () => {
    const p = { attemptId: A("l-s1"), examId: A("de"), studentId: S1, gradedAtMs: 1_700_000_000_000 };
    await onExamAttemptGradedNotif(ev(p));
    await onExamAttemptGradedNotif(ev(p));
    let ds = await db.notification.findMany({ where: { dedupeKey: { startsWith: `exam.attempt.graded:${A("l-s1")}:` } }, select: { studentId: true, audience: true, title: true, body: true, classId: true, isPublished: true } });
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ studentId: S1, audience: "STUDENT", title: "Bài thi đã được chấm", classId: A("l1"), isPublished: true });
    expect(ds[0]!.body).toContain("Bài thi TBBTH");
    expect(ds[0]!.body).not.toMatch(/\d+\s*\/\s*\d+|điểm|đạt/i); // không lộ điểm / đạt
    await onExamAttemptGradedNotif(ev({ ...p, gradedAtMs: 1_700_000_100_000 }));
    ds = await db.notification.findMany({ where: { dedupeKey: { startsWith: `exam.attempt.graded:${A("l-s1")}:` } }, select: { studentId: true, audience: true, title: true, body: true, classId: true, isPublished: true } });
    expect(ds).toHaveLength(2);
  });

  it("[TBBTH-DB-02] không tin payload: chưa chấm · học viên khác · lượt không có ⇒ không thông báo", async () => {
    await onExamAttemptGradedNotif(ev({ attemptId: A("l-s2-cho"), examId: A("de"), studentId: S2, gradedAtMs: 1_700_000_000_000 }));
    await onExamAttemptGradedNotif(ev({ attemptId: A("l-s1"), examId: A("de"), studentId: S2, gradedAtMs: 1_700_000_200_000 })); // lượt của S1 nhưng payload nêu S2
    await onExamAttemptGradedNotif(ev({ attemptId: A("khong-co"), examId: A("de"), studentId: S1, gradedAtMs: 1_700_000_000_000 }));
    await onExamAttemptGradedNotif(ev({ attemptId: A("l-s1"), studentId: S1, gradedAtMs: "x" }));
    expect(await db.notification.count({ where: { studentId: S2, dedupeKey: { startsWith: "exam.attempt.graded:" } } })).toBe(0);
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `exam.attempt.graded:${A("khong-co")}` } } })).toBe(0);
  });

  it("[TBBTH-DB-03] Student Mode: học sinh thấy tin của chính mình, không thấy tin của anh/chị/em", async () => {
    const t1 = await layTinHocSinh(S1 as MaHocVienDaKiem, { soLuong: 30 });
    const t2 = await layTinHocSinh(S2 as MaHocVienDaKiem, { soLuong: 30 });
    expect(t1.items.filter((x) => x.title === "Bài thi đã được chấm").length).toBeGreaterThanOrEqual(1);
    expect(t2.items.filter((x) => x.title === "Bài thi đã được chấm")).toHaveLength(0);
  });

  it("[TBBTH-DB-04] cờ PORTAL_BAI_TAP_BAI_THI_ENABLED tắt ⇒ không thông báo; bật lại ⇒ có", async () => {
    const p = { attemptId: A("l-s1"), examId: A("de"), studentId: S1, gradedAtMs: 1_700_000_300_000 };
    process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "false";
    try {
      await onExamAttemptGradedNotif(ev(p));
      expect(await db.notification.count({ where: { dedupeKey: `exam.attempt.graded:${A("l-s1")}:${p.gradedAtMs}` } })).toBe(0);
    } finally {
      process.env.PORTAL_BAI_TAP_BAI_THI_ENABLED = "true";
    }
    await onExamAttemptGradedNotif(ev(p));
    expect(await db.notification.count({ where: { dedupeKey: `exam.attempt.graded:${A("l-s1")}:${p.gradedAtMs}` } })).toBe(1);
  });
});
