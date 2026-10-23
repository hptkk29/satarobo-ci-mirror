// [TT-DB-*] — tuân thủ buổi dạy (điểm danh + nhận xét học viên) trên Postgres THẬT. Thuần: lib/parttime/tuan-thu-buoi.test.ts.
// Chạy: TEST_DATABASE_URL=postgresql://…/satarobo_test… pnpm test:cham-cong-db
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Actor } from "../../lib/auth/actor";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-tuan-thu] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ dem: 0 }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));
vi.mock("../../lib/db", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/db")>();
  const dem = (goc.db as unknown as { $extends: (x: unknown) => unknown }).$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) {
          ctl.dem++;
          return query(args);
        },
      },
    },
  });
  return { ...goc, db: dem };
});

const TAG = "pttt";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const NGAY = "2026-11-02";
const HOM_SAU = "2026-11-03";

d("[TT-DB] tuân thủ buổi dạy — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let wu: typeof import("../../lib/parttime/workunit-db");
  let tt: typeof import("../../lib/parttime/tuan-thu-buoi-db");
  let p4: typeof import("../../lib/parttime/bang-chung-cong-db");
  let roster: typeof import("../../lib/attendance/roster");
  let cs1 = "";
  let gv = "";
  let gv2 = "";
  let ql = "";
  let khoa = "";
  let bai = "";
  const hv: string[] = [];
  const actor = { id: null as string | null, name: "QLCS tt" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({
      where: { code: "LEGACY" },
      update: {},
      create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ (trước SR.QD.238)", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } },
    });
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) },
    });
  }

  async function cleanup() {
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    const wus = await db.workUnit.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { OR: [{ entityType: "SessionStaffAssignment", entityId: { in: pcIds } }, { entityType: "WorkUnit", entityId: { in: wus.map((w) => w.id) } }] } });
    await db.workUnit.deleteMany({ where: { userId: { in: ids } } });
    if (pcIds.length) {
      await db.$transaction([
        db.$executeRaw`ALTER TABLE "WorkConfirmation" DISABLE TRIGGER "WorkConfirmation_bat_bien"`,
        db.workConfirmation.deleteMany({ where: { assignmentId: { in: pcIds } } }),
        db.$executeRaw`ALTER TABLE "WorkConfirmation" ENABLE TRIGGER "WorkConfirmation_bat_bien"`,
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
        db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      ]);
    }
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    const cls = (await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id);
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    await db.makeupNeed.deleteMany({ where: { classId: { in: cls } } });
    await db.studentSessionFeedback.deleteMany({ where: { classSession: { classId: { in: cls } } } });
    await db.attendance.deleteMany({ where: { session: { classId: { in: cls } } } });
    await db.studentReserve.deleteMany({ where: { student: { name: { startsWith: TAG } } } });
    await db.enrollment.deleteMany({ where: { classId: { in: cls } } });
    await db.classSession.deleteMany({ where: { classId: { in: cls } } });
    await db.class.deleteMany({ where: { id: { in: cls } } });
    await db.student.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    if (cs1) await db.attendancePeriod.deleteMany({ where: { centerId: cs1 } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    wu = await import("../../lib/parttime/workunit-db");
    tt = await import("../../lib/parttime/tuan-thu-buoi-db");
    p4 = await import("../../lib/parttime/bang-chung-cong-db");
    roster = await import("../../lib/attendance/roster");
    cs1 = (await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS tt", address: "x", code: `${TAG}-cs1` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs1` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs1`, name: "ĐV tt", path: `/${TAG}-cs1/`, depth: 0, centerId: cs1 } });
    await cleanup();
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 }, select: { id: true } });
    gv = (await mk("gv", "GV tt")).id;
    gv2 = (await mk("gv2", "GV2 tt")).id;
    ql = (await mk("ql", "QL tt")).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 tt", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT tt" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
    for (let i = 1; i <= 9; i++) hv.push((await db.student.create({ data: { name: `${TAG} hv${i}`, centerId: cs1 }, select: { id: true } })).id);
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  // ── tiện ích ──
  let soLop = 0;
  /** Lớp 18:00–19:30, `si` học viên đầu ghi danh ACTIVE; một buổi `ymd` đã phân + nhận + chốt; GV chấm vào 17:48 / ra 19:35. */
  const buoi = async (p: { si?: number; ymd?: string; substituteTeacherId?: string; thucDay?: string; chamCong?: boolean } = {}) => {
    const ymd = p.ymd ?? NGAY;
    soLop++;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, courseId: khoa, centerId: cs1, teacherId: gv, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    for (const h of hv.slice(0, p.si ?? 9)) await db.enrollment.create({ data: { studentId: h, classId: lop.id, courseId: khoa, status: "ACTIVE", centerId: cs1 } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs1, status: "SCHEDULED", date: vn(ymd, "18:00"), lessonId: bai, substituteTeacherId: p.substituteTeacherId ?? null }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    // Phân công dựng bằng đồng bộ đã gán ngay (ĐẢO 20/10/2026) — không còn bước giáo viên nhận.
    const nguoi = p.thucDay ?? p.substituteTeacherId ?? gv;
    await db.classSession.update({ where: { id: s.id }, data: { status: "COMPLETED", actualTeacherId: nguoi } });
    if (p.chamCong !== false) {
      await db.staffTimeLog.create({ data: { userId: nguoi, centerId: cs1, direction: "CHECK_IN", loggedAt: vn(ymd, "17:48"), workDate: new Date(`${ymd}T00:00:00Z`), result: "ACCEPTED" } });
      await db.staffTimeLog.create({ data: { userId: nguoi, centerId: cs1, direction: "CHECK_OUT", loggedAt: vn(ymd, "19:35"), workDate: new Date(`${ymd}T00:00:00Z`), result: "ACCEPTED" } });
    }
    return { sessionId: s.id, classId: lop.id };
  };
  const diemDanh = async (sessionId: string, ds: readonly (readonly [string, "PRESENT" | "LATE" | "ABSENT" | "EXCUSED" | "ABSENT_EXCUSED" | "ABSENT_UNEXCUSED"])[]) => {
    for (const [studentId, status] of ds) await db.attendance.create({ data: { sessionId, studentId, status, centerId: cs1 } });
  };
  const coMatHet = (ids: readonly string[]) => ids.map((h) => [h, "PRESENT"] as const);
  const nhanXet = async (sessionId: string, ids: readonly string[], luc: Date, tacGia = gv) => {
    for (const studentId of ids) await db.studentSessionFeedback.create({ data: { classSessionId: sessionId, studentId, createdById: tacGia, comment: "Tốt", createdAt: luc } });
  };
  const doi = (now: Date, ymd = NGAY) => wu.docDoiSoatThucHien({ centerId: cs1, tu: ymd, den: ymd, now });
  const cuaBuoi = async (sourceId: string, now: Date, ymd = NGAY) => (await doi(now, ymd)).dong.filter((r) => r.bc.sourceId === sourceId);
  const tuanThu = async (sourceId: string, now: Date, userId = gv) => {
    const r = (await cuaBuoi(sourceId, now)).find((x) => x.bc.userId === userId);
    if (!r?.tuanThu) throw new Error("không có dòng tuân thủ");
    return { ...r.tuanThu, ungVien: r.ungVien, dong: r };
  };
  const SAU_HAN = vn(HOM_SAU, "11:00");
  const TRONG_HAN = vn(HOM_SAU, "08:00");

  it("[TT-DB-01] 9 học viên / 9 đã điểm danh ⇒ COMPLETE; nhận xét 9/9 trước hạn ⇒ tổng COMPLETE, WorkUnit ứng viên TU_DONG", async () => {
    const b = await buoi();
    await diemDanh(b.sessionId, coMatHet(hv));
    await nhanXet(b.sessionId, hv, vn(NGAY, "20:30"));
    const t = await tuanThu(b.sessionId, SAU_HAN);
    expect(t).toMatchObject({ studentAttendanceStatus: "COMPLETE", studentAttendanceExpected: 9, studentAttendanceRecorded: 9, studentCommentStatus: "COMPLETE", studentCommentsExpected: 9, studentCommentsCompleted: 9, overallStatus: "COMPLETE", issues: [] });
    expect(t.ungVien.lop).toBe("TU_DONG");
  });

  it("[TT-DB-02] 9 / 8 ⇒ PARTIAL, tổng NEEDS_REVIEW, ứng viên XEM_TAY (không CHAN)", async () => {
    const b = await buoi();
    await diemDanh(b.sessionId, coMatHet(hv.slice(0, 8)));
    await nhanXet(b.sessionId, hv.slice(0, 8), vn(NGAY, "20:30"));
    const t = await tuanThu(b.sessionId, SAU_HAN);
    expect(t).toMatchObject({ studentAttendanceStatus: "PARTIAL", studentAttendanceRecorded: 8, overallStatus: "NEEDS_REVIEW" });
    expect(t.issues).toContain("STUDENT_ATTENDANCE_PARTIAL");
    expect(t.ungVien).toMatchObject({ lop: "XEM_TAY", lyDo: ["DIEM_DANH_HV_CHUA_DU"] });
  });

  it("[TT-DB-03] có mặt + vắng + vắng có phép + muộn đều là ĐÃ ghi ⇒ 9/9 ĐỦ; nhận xét chỉ cần người có mặt / muộn", async () => {
    const b = await buoi();
    await diemDanh(b.sessionId, [...coMatHet(hv.slice(0, 6)), [hv[6], "LATE"], [hv[7], "ABSENT"], [hv[8], "ABSENT_EXCUSED"]]);
    await nhanXet(b.sessionId, hv.slice(0, 7), vn(NGAY, "20:30"));
    const t = await tuanThu(b.sessionId, SAU_HAN);
    expect(t).toMatchObject({ studentAttendanceStatus: "COMPLETE", studentAttendanceExpected: 9, studentAttendanceRecorded: 9, studentCommentsExpected: 7, studentCommentStatus: "COMPLETE", overallStatus: "COMPLETE" });
  });

  it("[TT-DB-04] buổi HUỶ ⇒ điểm danh + nhận xét NOT_REQUIRED, không vào mẫu tỉ lệ", async () => {
    const b = await buoi();
    await db.classSession.update({ where: { id: b.sessionId }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: b.sessionId }], "HUY_BUOI", actor);
    const pcs = await db.sessionStaffAssignment.findMany({ where: { sourceId: b.sessionId }, select: { id: true } });
    const bcs = (await p4.docBangChungCong({ centerId: cs1, tu: NGAY, den: NGAY, now: SAU_HAN })).phanCong.filter((x) => x.sourceId === b.sessionId);
    const ds = await tt.docTuanThu(bcs, SAU_HAN);
    for (const x of ds.values()) expect(x).toMatchObject({ studentAttendanceStatus: "NOT_REQUIRED", studentCommentStatus: "NOT_REQUIRED", overallStatus: "CANCELLED", issues: [] });
    expect(pcs.length).toBeGreaterThan(0);
  });

  it("[TT-DB-05] HỌC BÙ: sĩ số = bé của CASE (2), không phải sĩ số lớp gốc (9); bé vắng buổi bù vẫn là đã điểm danh; phiếu trên mục", async () => {
    const goc = await buoi();
    const ngay = "2026-11-09";
    const c = await db.makeupCase.create({ data: { centerId: cs1, courseId: khoa, lessonId: bai, date: new Date(`${ngay}T00:00:00Z`), startTime: "18:00", endTime: "19:30", teacherId: gv, status: "SCHEDULED", createdById: gv }, select: { id: true } });
    const muc: string[] = [];
    for (const [i, att] of [[0, "PRESENT"], [1, "ABSENT"], [2, "PENDING"]] as const) {
      const need = await db.makeupNeed.create({ data: { studentId: hv[i], classId: goc.classId, centerId: cs1, courseId: khoa, sourceType: "MANUAL", missedSessionId: goc.sessionId, status: "PENDING" }, select: { id: true } });
      const p = await db.makeupCaseParticipant.create({ data: { caseId: c.id, studentId: hv[i], centerId: cs1, attendanceStatus: i === 2 ? "REMOVED" : att }, select: { id: true } });
      const m = await db.makeupCaseStudent.create({ data: { caseId: c.id, makeupNeedId: need.id, centerId: cs1, addedById: gv, participantId: p.id, originalSessionId: goc.sessionId, result: att === "PRESENT" ? "COMPLETED" : "RELEASED", status: att === "PRESENT" ? "PRESENT" : "RELEASED" }, select: { id: true } });
      muc.push(m.id);
    }
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "TAO_BUOI", actor);
    // Phân công dựng bằng đồng bộ đã gán ngay (ĐẢO 20/10/2026) — không còn bước giáo viên nhận.
    await db.makeupCase.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
    const bcs = (await p4.docBangChungCong({ centerId: cs1, tu: ngay, den: ngay, now: vn("2026-11-10", "11:00") })).phanCong.filter((x) => x.sourceId === c.id);
    const truoc = [...(await tt.docTuanThu(bcs, vn("2026-11-10", "11:00"))).values()][0];
    expect(truoc).toMatchObject({ studentAttendanceExpected: 2, studentAttendanceRecorded: 2, studentAttendanceStatus: "COMPLETE", studentCommentsExpected: 1, studentCommentsCompleted: 0, studentCommentStatus: "OVERDUE" });
    // Nhận xét ở BUỔI GỐC không phải phiếu học bù.
    await nhanXet(goc.sessionId, [hv[0]], vn(ngay, "19:50"));
    expect([...(await tt.docTuanThu(bcs, vn("2026-11-10", "11:00"))).values()][0].studentCommentsCompleted).toBe(0);
    await db.makeupCaseStudent.update({ where: { id: muc[0] }, data: { teacherEvaluation: "Bé làm xong", evaluatedById: gv, evaluatedAt: vn(ngay, "19:50") } });
    expect([...(await tt.docTuanThu(bcs, vn("2026-11-10", "11:00"))).values()][0]).toMatchObject({ studentCommentsCompleted: 1, studentCommentStatus: "COMPLETE" });
  });

  it("[TT-DB-06] DẠY THAY: B (dạy thay) chịu nghĩa vụ — A không có dòng; nhận xét A viết KHÔNG tính cho B", async () => {
    const b = await buoi({ substituteTeacherId: gv2 });
    await diemDanh(b.sessionId, coMatHet(hv));
    await nhanXet(b.sessionId, hv.slice(0, 8), vn(NGAY, "20:30"), gv2);
    await nhanXet(b.sessionId, [hv[8]], vn(NGAY, "20:30"), gv);
    const dong = await cuaBuoi(b.sessionId, SAU_HAN);
    expect(dong.filter((r) => r.bc.role === "MAIN_TEACHER").map((r) => r.bc.userId)).toEqual([gv2]);
    const t = await tuanThu(b.sessionId, SAU_HAN, gv2);
    expect(t).toMatchObject({ teacherId: gv2, studentCommentsCompleted: 8, studentCommentsOtherAuthor: 1, studentCommentStatus: "OVERDUE", overallStatus: "NEEDS_REVIEW" });
    expect(t.issues).toEqual(expect.arrayContaining(["STUDENT_COMMENTS_OVERDUE", "STUDENT_COMMENT_AUTHOR_MISMATCH"]));
  });

  it("[TT-DB-07][TT-DB-08] nhận xét 9/9 ⇒ COMPLETE; 7/9 trong hạn ⇒ PARTIAL (tổng IN_PROGRESS)", async () => {
    const a = await buoi();
    await diemDanh(a.sessionId, coMatHet(hv));
    await nhanXet(a.sessionId, hv, vn(NGAY, "21:00"));
    expect((await tuanThu(a.sessionId, TRONG_HAN)).studentCommentStatus).toBe("COMPLETE");
    const b = await buoi();
    await diemDanh(b.sessionId, coMatHet(hv));
    await nhanXet(b.sessionId, hv.slice(0, 7), vn(NGAY, "21:00"));
    expect(await tuanThu(b.sessionId, TRONG_HAN)).toMatchObject({ studentCommentStatus: "PARTIAL", studentCommentsCompleted: 7, overallStatus: "IN_PROGRESS" });
  });

  it("[TT-DB-09][TT-DB-10] mốc 10:00:00 hôm sau là ĐÚNG HẠN; 10:01 ⇒ LATE_COMPLETE (trễ 1 phút), NEEDS_REVIEW, không tự thành đúng hạn", async () => {
    const a = await buoi();
    await diemDanh(a.sessionId, coMatHet(hv));
    await nhanXet(a.sessionId, hv.slice(0, 8), vn(NGAY, "21:00"));
    await nhanXet(a.sessionId, [hv[8]], vn(HOM_SAU, "10:00"));
    expect((await tuanThu(a.sessionId, SAU_HAN)).studentCommentStatus).toBe("COMPLETE");
    const b = await buoi();
    await diemDanh(b.sessionId, coMatHet(hv));
    await nhanXet(b.sessionId, hv.slice(0, 8), vn(NGAY, "21:00"));
    await nhanXet(b.sessionId, [hv[8]], vn(HOM_SAU, "10:01"));
    const t = await tuanThu(b.sessionId, SAU_HAN);
    expect(t).toMatchObject({ studentCommentStatus: "LATE_COMPLETE", commentsLateByMinutes: 1, overallStatus: "NEEDS_REVIEW" });
    expect(t.ungVien.lyDo).toContain("NHAN_XET_HV_TRE");
  });

  it("[TT-DB-11] thiếu nhận xét SAU hạn ⇒ OVERDUE — nhận xét CHUNG của buổi (`classComment`) không thay được nhận xét từng học viên", async () => {
    const b = await buoi();
    await diemDanh(b.sessionId, coMatHet(hv));
    await db.classSession.update({ where: { id: b.sessionId }, data: { classComment: "Cả lớp học tốt" } });
    expect(await tuanThu(b.sessionId, SAU_HAN)).toMatchObject({ studentCommentStatus: "OVERDUE", studentCommentsCompleted: 0, overallStatus: "NEEDS_REVIEW" });
  });

  it("[TT-DB-12] tuân thủ thiếu: WorkUnit vẫn được xác nhận lẻ (kèm lý do) với 1 tiết; hàng loạt bị từ chối; nhận xét bổ sung sau KHÔNG làm đơn vị cũ / đổi số", async () => {
    const b = await buoi();
    await diemDanh(b.sessionId, coMatHet(hv));
    await nhanXet(b.sessionId, hv.slice(0, 7), vn(NGAY, "21:00"));
    const r = (await tuanThu(b.sessionId, SAU_HAN)).dong;
    expect(r.tuanThu?.overallStatus).toBe("NEEDS_REVIEW");
    const xn = (hangLoat: boolean, lyDo: string | null) =>
      wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo, hangLoat, actor: { id: ql, name: "QL tt" }, now: SAU_HAN });
    expect(await xn(true, null)).toMatchObject({ ok: false });
    const kq = await xn(false, "GV đã dạy, nhận xét bổ sung sau");
    expect(kq).toMatchObject({ ok: true });
    const donVi = await db.workUnit.findMany({ where: { assignmentId: r.bc.assignmentId } });
    expect(donVi).toHaveLength(1);
    expect(donVi[0]).toMatchObject({ status: "CONFIRMED", workUnitType: "MAIN_TEACHING" });
    expect(donVi[0].quantity.toString()).toBe("1");
    // Ảnh chụp lúc quyết ghi lại tuân thủ (tra cứu) — không đổi gì của đơn vị.
    const xnRow = await db.workConfirmation.findFirstOrThrow({ where: { assignmentId: r.bc.assignmentId } });
    expect(xnRow.evidenceSnapshot).toMatchObject({ tuanThu: { tong: "NEEDS_REVIEW", diemDanh: "9/9", nhanXet: "7/9" } });
    await nhanXet(b.sessionId, hv.slice(7), vn(HOM_SAU, "12:00"));
    const sau = (await cuaBuoi(b.sessionId, vn(HOM_SAU, "13:00"))).find((x) => x.bc.userId === gv)!;
    expect(sau.donVi).toMatchObject({ hieuLuc: "CONFIRMED", quantity: "1" });
    expect(sau.tuanThu?.studentCommentStatus).toBe("LATE_COMPLETE");
  });

  it("[TT-DB-PAR] sĩ số theo lô == tập ghi được của `getSessionRosterStudentIds` (đang học · tạm dừng · đã rút · bảo lưu tại ngày buổi · chưa tới lượt · học bù luồng cũ)", async () => {
    const b = await buoi({ si: 4 }); // hv0..3 ACTIVE
    await db.enrollment.updateMany({ where: { classId: b.classId, studentId: hv[1] }, data: { status: "PAUSED" } });
    await db.enrollment.create({ data: { studentId: hv[4], classId: b.classId, courseId: khoa, status: "WITHDREW", centerId: cs1 } });
    const bl = await db.enrollment.findFirstOrThrow({ where: { classId: b.classId, studentId: hv[2] } });
    await db.studentReserve.create({ data: { studentId: hv[2], enrollmentId: bl.id, reason: "fx", createdByName: "x", centerId: cs1, status: "ACTIVE", isActive: true, approvedAt: vn("2026-10-20", "09:00"), startedAt: vn("2026-10-20", "09:00") } });
    await db.enrollment.create({ data: { studentId: hv[5], classId: b.classId, courseId: khoa, status: "ACTIVE", centerId: cs1, buoiBatDau: 5 } });
    const lopKhac = await buoi({ si: 0 });
    await db.makeupNeed.create({ data: { studentId: hv[6], classId: lopKhac.classId, centerId: cs1, courseId: khoa, sourceType: "MANUAL", missedSessionId: lopKhac.sessionId, makeupSessionId: b.sessionId, status: "SCHEDULED" } });
    const actorHo = { userId: ql, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as unknown as Actor;
    const chuan = [...(await roster.getSessionRosterStudentIds(actorHo, b.sessionId))].sort();
    const lo = [...((await tt.siSoGhiDuocTheoBuoi([b.sessionId])).get(b.sessionId) ?? [])].sort();
    expect(chuan).toEqual([hv[0], hv[1], hv[3], hv[6]].sort()); // đối chứng: luật roster thật đang loại đúng 3 dạng
    expect(lo).toEqual(chuan);
  });

  it("[TT-DB-Q] số câu tra của docTuanThu KHÔNG đổi theo số buổi (3 vs 30)", async () => {
    const ngay = "2026-11-16";
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const b = await buoi({ ymd: ngay, si: 3, chamCong: i === 0 });
      await diemDanh(b.sessionId, coMatHet(hv.slice(0, 3)));
      await nhanXet(b.sessionId, hv.slice(0, 2), vn(ngay, "21:00"));
      ids.push(b.sessionId);
    }
    const bcs = (await p4.docBangChungCong({ centerId: cs1, tu: ngay, den: ngay, now: vn("2026-11-17", "11:00") })).phanCong;
    const dem = async (n: number) => {
      const lo = bcs.filter((x) => ids.slice(0, n).includes(x.sourceId));
      expect(lo).toHaveLength(n);
      ctl.dem = 0;
      const ra = await tt.docTuanThu(lo, vn("2026-11-17", "11:00"));
      expect(ra.size).toBe(n);
      return ctl.dem;
    };
    const ba = await dem(3);
    const bamuoi = await dem(30);
    expect(ba).toBeGreaterThan(3); // bộ đếm có chạy
    expect(bamuoi).toBe(ba);
  });
});
