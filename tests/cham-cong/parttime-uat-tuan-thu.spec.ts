// [UAT-C*] — UAT CÓ KIỂM SOÁT của TUÂN THỦ BUỔI DẠY (điểm danh + nhận xét học viên), đầu-cuối trên Postgres THẬT, dữ liệu cô lập theo TAG.
// Mỗi lượt chấm công đi qua ĐÚNG đường ghi thật `ghiLuotTuanTu` với mốc TIÊM; thẻ Chấm công đọc bằng `docNguCanhChamCong` thật; đối soát
// + xác nhận qua `xacNhanThucHien` thật. Điểm danh / nhận xét học viên ghi thẳng bảng nguồn (đường ghi của GV cần phiên đăng nhập — đã
// có lưới riêng `[NDL-*]`); trình duyệt thật: `tests/manual/tt-du-lieu-do.ts`. Tài liệu: docs/cham-cong/parttime/21-TEACHING-SESSION-COMPLIANCE.md.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-uat-tuan-thu] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

// ⚠️ GĐ6 (05/11/2026): bộ này ghim LUỒNG XÁC NHẬN TAY của QLCS (luật CŨ) trên ngày tháng 11/2026 ⇒ cờ theo kỳ
// `shift.parttimeLuatCongMoiTuKy` được đặt `2099-01` để các kỳ ở đây đi luật cũ (đường mã y hệt kỳ 10/2026). Hai vế cờ ở cấu hình MẶC
// ĐỊNH (2026-11, KHÔNG mock) canh ở `tests/cham-cong/phan-cong-gop-chot-ky.spec.ts` [CK-DB-*] + `lib/parttime/workunit.test.ts` [P5-GATE-05].
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return { ...goc, getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) => (/^shift\.parttime\w+Enabled$/.test(key) ? true : key === "shift.parttimeLuatCongMoiTuKy" ? "2099-01" : goc.getSetting(key as never, opts))) as typeof goc.getSetting };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const TAG = "uattt";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const sau = (ymd: string, n: number, hhmm: string) => {
  const [y, m, dd] = ymd.split("-").map(Number);
  return vn(new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10), hhmm);
};
const P = ["GV-A", "GV-B", "NV", "QLCS"] as const;
type Ten = (typeof P)[number];

d("[UAT-C] tuân thủ buổi dạy — UAT có kiểm soát (Postgres thật)", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let wu: typeof import("../../lib/parttime/workunit-db");
  let nc: typeof import("../../lib/parttime/ngu-canh-cham-cong-db");
  let ncT: typeof import("../../lib/parttime/ngu-canh-cham-cong");
  let sh: typeof import("../../lib/cham-cong/suy-huong-db");
  let lt: typeof import("../../lib/cham-cong/ghi-luot-tuan-tu");
  let ttb: typeof import("../../lib/parttime/tuan-thu-buoi");
  const id = {} as Record<Ten, string>;
  let cs1 = "";
  let wl1 = "";
  let khoa = "";
  let bai = "";
  let mauC = "";
  const hv: string[] = [];
  let soLop = 0;
  const actor = { id: null as string | null, name: "UAT" };
  const QL = () => ({ id: id.QLCS, name: "UAT-QLCS" });

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238");
    await db.compensationPolicyVersion.upsert({ where: { code: "LEGACY" }, update: {}, create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } } });
    await db.compensationPolicyVersion.upsert({ where: { code: "SR.QD.238" }, update: {}, create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) } });
  }

  async function cleanup() {
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    for (const u of ids) await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `attday:${u}:` } } });
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    const wus = (await db.workUnit.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((w) => w.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: [...pcIds, ...wus] } } });
    await db.compensationAdjustment.deleteMany({ where: { userId: { in: ids } } });
    await db.workUnit.deleteMany({ where: { userId: { in: ids } } });
    await db.$transaction([
      db.$executeRaw`ALTER TABLE "WorkConfirmation" DISABLE TRIGGER USER`,
      db.workConfirmation.deleteMany({ where: { assignmentId: { in: pcIds } } }),
      db.$executeRaw`ALTER TABLE "WorkConfirmation" ENABLE TRIGGER USER`,
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER USER`,
      db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER USER`,
    ]);
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = (await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id);
    const ses = (await db.classSession.findMany({ where: { classId: { in: cls } }, select: { id: true } })).map((s) => s.id);
    await db.studentSessionFeedback.deleteMany({ where: { classSessionId: { in: ses } } });
    await db.attendance.deleteMany({ where: { sessionId: { in: ses } } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    await db.makeupNeed.deleteMany({ where: { classId: { in: cls } } });
    await db.enrollment.deleteMany({ where: { classId: { in: cls } } });
    await db.classSession.deleteMany({ where: { id: { in: ses } } });
    await db.class.deleteMany({ where: { id: { in: cls } } });
    await db.student.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    wu = await import("../../lib/parttime/workunit-db");
    nc = await import("../../lib/parttime/ngu-canh-cham-cong-db");
    ncT = await import("../../lib/parttime/ngu-canh-cham-cong");
    sh = await import("../../lib/cham-cong/suy-huong-db");
    lt = await import("../../lib/cham-cong/ghi-luot-tuan-tu");
    ttb = await import("../../lib/parttime/tuan-thu-buoi");
    const c = await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS UAT tt", address: "x", code: `${TAG.toUpperCase()}-CS1` }, select: { id: true } });
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs1` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs1`, name: "ĐV UAT tt", path: `/${TAG}-cs1/`, depth: 0, centerId: c.id } });
    const geo = { latitude: 16.04, longitude: 108.22, radiusMeters: 150, geofenceEnabled: true };
    wl1 = (await db.workLocation.upsert({ where: { code: `${TAG}-cs1` }, update: geo, create: { code: `${TAG}-cs1`, name: "Quầy UAT tt", centerId: c.id, ...geo }, select: { id: true } })).id;
    cs1 = c.id;
    await cleanup();
    for (const t of P) {
      const vai = t === "QLCS" ? "CENTER_MANAGER" : t === "NV" ? "HR" : "TEACHER";
      id[t] = (await db.user.create({ data: { email: `${t.toLowerCase()}@${TAG}.test`, name: `UAT-${t}`, role: vai, roles: [vai], password: "x", centerId: cs1 }, select: { id: true } })).id;
    }
    khoa = (await db.course.create({ data: { name: "Sata 3 UAT tt", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT UAT tt" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
    for (let i = 1; i <= 9; i++) hv.push((await db.student.create({ data: { name: `${TAG} hv${i}`, centerId: cs1 }, select: { id: true } })).id);
    mauC = (
      await db.shiftTemplate.upsert({
        where: { code_effectiveFrom: { code: `${TAG}-C`, effectiveFrom: new Date("2000-01-01T00:00:00Z") } },
        update: {},
        create: { code: `${TAG}-C`, name: "Ca chiều UAT tt", segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] },
        select: { id: true },
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await db.workLocation.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.shiftTemplate.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  // ── tiện ích ──
  const lop = async (ymd: string, p: { gv: Ten; thay?: Ten; ta?: Ten }) => {
    soLop++;
    const l = await db.class.create({ data: { name: `${TAG} L${soLop}`, classCode: `UATTT-L${soLop}`, courseId: khoa, centerId: cs1, teacherId: id[p.gv], assistantId: p.ta ? id[p.ta] : null, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    for (const h of hv) await db.enrollment.create({ data: { studentId: h, classId: l.id, courseId: khoa, status: "ACTIVE", centerId: cs1 } });
    const s = await db.classSession.create({ data: { classId: l.id, centerId: cs1, status: "SCHEDULED", date: vn(ymd, "18:00"), lessonId: bai, substituteTeacherId: p.thay ? id[p.thay] : null }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    // Phân công dựng bằng đồng bộ đã gán ngay (ĐẢO 20/10/2026) — không còn bước giáo viên nhận.
    return { sessionId: s.id, classId: l.id };
  };
  const cham = async (u: Ten, ymd: string, hhmm: string) => {
    const g = await lt.ghiLuotTuanTu({ userId: id[u], workLocationId: wl1, now: vn(ymd, hhmm), latitude: 16.0401, longitude: 108.2201, accuracyMeters: 20 });
    if (!g.r.ok) throw new Error(g.r.error);
    return (await db.staffTimeLog.findUniqueOrThrow({ where: { id: g.r.logId }, select: { direction: true } })).direction;
  };
  const the = async (u: Ten, ymd: string, hhmm: string) => {
    const now = vn(ymd, hhmm);
    return nc.docNguCanhChamCong({ userId: id[u], workLocationId: wl1, huong: await sh.suyHuongHomNay({ userId: id[u], workLocationId: wl1, now }), now });
  };
  const diemDanh = async (sessionId: string, ds: readonly (readonly [string, "PRESENT" | "ABSENT" | "ABSENT_EXCUSED" | "LATE"])[]) => {
    for (const [studentId, status] of ds) await db.attendance.create({ data: { sessionId, studentId, status, centerId: cs1 } });
  };
  const nhanXet = async (sessionId: string, ids: readonly string[], luc: Date, u: Ten) => {
    for (const studentId of ids) await db.studentSessionFeedback.create({ data: { classSessionId: sessionId, studentId, createdById: id[u], comment: "Tốt", createdAt: luc } });
  };
  const doi = async (ymd: string, sourceId: string, u: Ten, now: Date) =>
    (await wu.docDoiSoatThucHien({ centerId: cs1, tu: ymd, den: ymd, now })).dong.find((r) => r.bc.sourceId === sourceId && r.bc.userId === id[u])!;
  const coMat = (ids: readonly string[]) => ids.map((h) => [h, "PRESENT"] as const);

  it("[UAT-C01] chấm vào 17:48 (KHÔNG sinh điểm danh) → thẻ nhắc điểm danh 0/9 → điểm danh 9/9 → chấm ra 19:35 → nhận xét 9/9 ⇒ COMPLETE, xác nhận HÀNG LOẠT được", async () => {
    const ngay = "2026-12-07";
    const b = await lop(ngay, { gv: "GV-A" });
    expect(await cham("GV-A", ngay, "17:48")).toBe("CHECK_IN");
    expect(await db.attendance.count({ where: { sessionId: b.sessionId } })).toBe(0); // chấm vào ≠ học viên có mặt
    const dang = await the("GV-A", ngay, "18:10");
    const tiet = dang!.nextTeaching!;
    expect(tiet.daBatDau).toBe(true);
    expect(tiet.hoSo!.buoc.find((x) => x.ma === "DIEM_DANH")).toMatchObject({ nhan: "Điểm danh 0/9", xong: false });
    expect(tiet.dich).toMatchObject({ loai: "LOP", sessionId: b.sessionId, dayThay: false });
    await diemDanh(b.sessionId, coMat(hv));
    expect((await the("GV-A", ngay, "18:40"))!.nextTeaching!.hoSo!.buoc.find((x) => x.ma === "DIEM_DANH")).toMatchObject({ nhan: "Điểm danh 9/9", xong: true });
    expect(await cham("GV-A", ngay, "19:35")).toBe("CHECK_OUT");
    await db.classSession.update({ where: { id: b.sessionId }, data: { status: "COMPLETED", actualTeacherId: id["GV-A"] } });
    await nhanXet(b.sessionId, hv, vn(ngay, "20:30"), "GV-A");
    const r = await doi(ngay, b.sessionId, "GV-A", sau(ngay, 1, "11:00"));
    expect(r.tuanThu).toMatchObject({ overallStatus: "COMPLETE", studentAttendanceRecorded: 9, studentCommentsCompleted: 9, checkoutStatus: "DONE", issues: [] });
    expect(r.ungVien.lop).toBe("TU_DONG");
    const kq = await wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: true, actor: QL(), now: sau(ngay, 1, "11:00") });
    expect(kq).toMatchObject({ ok: true });
  });

  it("[UAT-C02] chấm vào → điểm danh 8/9 ⇒ chưa hoàn tất: thẻ 'Điểm danh 8/9', đối soát NEEDS_REVIEW + XEM_TAY (hàng loạt bị từ chối)", async () => {
    const ngay = "2026-12-08";
    const b = await lop(ngay, { gv: "GV-A" });
    await cham("GV-A", ngay, "17:48");
    await diemDanh(b.sessionId, coMat(hv.slice(0, 8)));
    expect((await the("GV-A", ngay, "18:40"))!.nextTeaching!.hoSo!.buoc.find((x) => x.ma === "DIEM_DANH")).toMatchObject({ nhan: "Điểm danh 8/9", xong: false });
    await cham("GV-A", ngay, "19:35");
    await db.classSession.update({ where: { id: b.sessionId }, data: { status: "COMPLETED", actualTeacherId: id["GV-A"] } });
    await nhanXet(b.sessionId, hv.slice(0, 8), vn(ngay, "20:30"), "GV-A");
    const r = await doi(ngay, b.sessionId, "GV-A", sau(ngay, 1, "11:00"));
    expect(r.tuanThu).toMatchObject({ overallStatus: "NEEDS_REVIEW", studentAttendanceStatus: "PARTIAL" });
    expect(r.ungVien).toMatchObject({ lop: "XEM_TAY", lyDo: ["DIEM_DANH_HV_CHUA_DU"] });
    const kq = await wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: true, actor: QL(), now: sau(ngay, 1, "11:00") });
    expect(kq).toMatchObject({ ok: false });
  });

  it("[UAT-C03] học viên VẮNG nhưng đã ghi trạng thái ⇒ độ đầy đủ vẫn 100 %; nhận xét chỉ cho người có mặt", async () => {
    const ngay = "2026-12-09";
    const b = await lop(ngay, { gv: "GV-A" });
    await cham("GV-A", ngay, "17:48");
    await diemDanh(b.sessionId, [...coMat(hv.slice(0, 7)), [hv[7], "ABSENT"], [hv[8], "ABSENT_EXCUSED"]]);
    await cham("GV-A", ngay, "19:35");
    await db.classSession.update({ where: { id: b.sessionId }, data: { status: "COMPLETED", actualTeacherId: id["GV-A"] } });
    await nhanXet(b.sessionId, hv.slice(0, 7), vn(ngay, "20:30"), "GV-A");
    const r = await doi(ngay, b.sessionId, "GV-A", sau(ngay, 1, "11:00"));
    expect(r.tuanThu).toMatchObject({ studentAttendanceStatus: "COMPLETE", studentAttendanceCompletionPercent: 100, studentCommentsExpected: 7, overallStatus: "COMPLETE" });
  });

  it("[UAT-C04] đã chấm ra, nhận xét 7/9 ⇒ WorkUnit vẫn được xác nhận (1 tiết, lẻ + lý do) và GIỮ NGUYÊN; tuân thủ chưa hoàn tất", async () => {
    const ngay = "2026-12-10";
    const b = await lop(ngay, { gv: "GV-A" });
    await cham("GV-A", ngay, "17:48");
    await diemDanh(b.sessionId, coMat(hv));
    await cham("GV-A", ngay, "19:35");
    await db.classSession.update({ where: { id: b.sessionId }, data: { status: "COMPLETED", actualTeacherId: id["GV-A"] } });
    await nhanXet(b.sessionId, hv.slice(0, 7), vn(ngay, "20:30"), "GV-A");
    const r = await doi(ngay, b.sessionId, "GV-A", sau(ngay, 1, "11:00"));
    expect(r.tuanThu).toMatchObject({ checkoutStatus: "DONE", studentCommentStatus: "OVERDUE", overallStatus: "NEEDS_REVIEW" });
    const kq = await wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: "GV đã dạy, nhận xét bổ sung sau (UAT)", hangLoat: false, actor: QL(), now: sau(ngay, 1, "11:00") });
    expect(kq).toMatchObject({ ok: true });
    const w = await db.workUnit.findMany({ where: { assignmentId: r.bc.assignmentId, status: { not: "VOIDED" } } });
    expect(w).toHaveLength(1);
    expect(w[0].quantity.toString()).toBe("1");
    expect((await doi(ngay, b.sessionId, "GV-A", sau(ngay, 2, "09:00"))).donVi).toMatchObject({ hieuLuc: "CONFIRMED" });
  });

  it("[UAT-C05][UAT-C06] nhận xét xong 09:59 hôm sau ⇒ COMPLETE đúng hạn; xong 10:30 ⇒ LATE_COMPLETE (30 phút) — sự thật, không khoản tiền nào", async () => {
    for (const [ngay, luc, mong, tre] of [["2026-12-14", "09:59", "COMPLETE", null], ["2026-12-15", "10:30", "LATE_COMPLETE", 30]] as const) {
      const b = await lop(ngay, { gv: "GV-A" });
      await cham("GV-A", ngay, "17:48");
      await diemDanh(b.sessionId, coMat(hv));
      await cham("GV-A", ngay, "19:35");
      await db.classSession.update({ where: { id: b.sessionId }, data: { status: "COMPLETED", actualTeacherId: id["GV-A"] } });
      await nhanXet(b.sessionId, hv.slice(0, 8), vn(ngay, "20:30"), "GV-A");
      await nhanXet(b.sessionId, [hv[8]], sau(ngay, 1, luc), "GV-A");
      const r = await doi(ngay, b.sessionId, "GV-A", sau(ngay, 1, "12:00"));
      expect(r.tuanThu).toMatchObject({ studentCommentStatus: mong, commentsLateByMinutes: tre, commentDeadline: sau(ngay, 1, "10:00"), commentsCompletedAt: sau(ngay, 1, luc) });
      if (tre) {
        // LATE_COMPLETE_NO_AUTOMATIC_PENALTY (chủ dự án chốt 19/10/2026): QLCS xác nhận lẻ ⇒ ảnh chụp giữ hạn / lúc xong / số phút trễ.
        const kq = await wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: "Nhận xét nộp trễ 30 phút (UAT)", hangLoat: false, actor: QL(), now: sau(ngay, 1, "12:00") });
        expect(kq).toMatchObject({ ok: true });
        const xn = await db.workConfirmation.findFirstOrThrow({ where: { assignmentId: r.bc.assignmentId } });
        expect(xn.evidenceSnapshot).toMatchObject({ tuanThu: { trangThaiNhanXet: "LATE_COMPLETE", nhanXetTrePhut: 30, hanNhanXet: sau(ngay, 1, "10:00").toISOString(), nhanXetXongLuc: sau(ngay, 1, luc).toISOString() } });
      }
    }
    expect(await db.compensationAdjustment.count({ where: { userId: id["GV-A"] } })).toBe(0);
  });

  it("[UAT-C07] DẠY THAY: B chịu tuân thủ (thẻ của B có hồ sơ + lối Dạy thay); A không có dòng tuân thủ của buổi", async () => {
    const ngay = "2026-12-16";
    const b = await lop(ngay, { gv: "GV-A", thay: "GV-B" });
    await cham("GV-B", ngay, "17:48");
    const theB = (await the("GV-B", ngay, "18:10"))!.nextTeaching!;
    expect(theB.dich).toMatchObject({ loai: "LOP", sessionId: b.sessionId, dayThay: true });
    await diemDanh(b.sessionId, coMat(hv));
    await cham("GV-B", ngay, "19:35");
    await db.classSession.update({ where: { id: b.sessionId }, data: { status: "COMPLETED", actualTeacherId: id["GV-B"] } });
    await nhanXet(b.sessionId, hv, vn(ngay, "20:30"), "GV-B");
    const ds = (await wu.docDoiSoatThucHien({ centerId: cs1, tu: ngay, den: ngay, now: sau(ngay, 1, "11:00") })).dong.filter((r) => r.bc.sourceId === b.sessionId);
    expect(ds.map((r) => r.bc.userId)).toEqual([id["GV-B"]]);
    expect(ds[0].tuanThu).toMatchObject({ teacherId: id["GV-B"], overallStatus: "COMPLETE" });
  });

  it("[UAT-C10] TRỢ GIẢNG (chủ dự án chốt Q14 19/10/2026 — TA_NOT_REQUIRED): TA không chịu điểm danh / nhận xét học viên; GV đứng chính chịu", async () => {
    const ngay = "2026-12-21";
    const b = await lop(ngay, { gv: "GV-A", ta: "GV-B" });
    expect((await db.sessionStaffAssignment.findMany({ where: { sourceId: b.sessionId, status: "ACCEPTED" }, select: { role: true } })).map((x) => x.role).sort()).toEqual(["MAIN_TEACHER", "TEACHING_ASSISTANT"]);
    for (const u of ["GV-A", "GV-B"] as const) await cham(u, ngay, "17:48");
    await diemDanh(b.sessionId, coMat(hv.slice(0, 8))); // GV đứng chính điểm danh THIẾU 1
    for (const u of ["GV-A", "GV-B"] as const) await cham(u, ngay, "19:35");
    await db.classSession.update({ where: { id: b.sessionId }, data: { status: "COMPLETED", actualTeacherId: id["GV-A"] } });
    const ta = await doi(ngay, b.sessionId, "GV-B", sau(ngay, 1, "11:00"));
    expect(ta.bc.role).toBe("TEACHING_ASSISTANT");
    expect(ta.tuanThu).toMatchObject({ studentAttendanceStatus: "NOT_REQUIRED", studentCommentStatus: "NOT_REQUIRED" });
    expect(ta.ungVien.lyDo ?? []).not.toEqual(expect.arrayContaining(["DIEM_DANH_HV_CHUA_DU"]));
    expect(ta.ungVien.lyDo ?? []).not.toEqual(expect.arrayContaining(["NHAN_XET_HV_CHUA_DU"]));
    // đối chứng: cùng buổi, GV đứng chính chịu đúng phần thiếu
    const main = await doi(ngay, b.sessionId, "GV-A", sau(ngay, 1, "11:00"));
    expect(main.tuanThu).toMatchObject({ studentAttendanceStatus: "PARTIAL", studentCommentStatus: "OVERDUE", overallStatus: "NEEDS_REVIEW" });
    expect(main.ungVien.lyDo).toEqual(expect.arrayContaining(["DIEM_DANH_HV_CHUA_DU"]));
  });

  it("[UAT-C08] HỌC BÙ: sĩ số = 2 bé của case (không phải 9 của lớp gốc); phiếu trên mục ⇒ COMPLETE", async () => {
    const goc = await lop("2026-12-02", { gv: "GV-A" });
    const ngay = "2026-12-17";
    const c = await db.makeupCase.create({ data: { centerId: cs1, courseId: khoa, lessonId: bai, date: ngayDb(ngay), startTime: "18:00", endTime: "19:30", teacherId: id["GV-A"], status: "SCHEDULED", createdById: id["GV-A"] }, select: { id: true } });
    for (const i of [0, 1]) {
      const need = await db.makeupNeed.create({ data: { studentId: hv[i], classId: goc.classId, centerId: cs1, courseId: khoa, sourceType: "MANUAL", missedSessionId: goc.sessionId, status: "PENDING" }, select: { id: true } });
      const p = await db.makeupCaseParticipant.create({ data: { caseId: c.id, studentId: hv[i], centerId: cs1, attendanceStatus: "PRESENT" }, select: { id: true } });
      await db.makeupCaseStudent.create({ data: { caseId: c.id, makeupNeedId: need.id, centerId: cs1, addedById: id["GV-A"], participantId: p.id, originalSessionId: goc.sessionId, result: "COMPLETED", status: "PRESENT", teacherEvaluation: "Bé làm tốt", evaluatedById: id["GV-A"], evaluatedAt: vn(ngay, "19:50") } });
    }
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "TAO_BUOI", actor);
    // Phân công dựng bằng đồng bộ đã gán ngay (ĐẢO 20/10/2026) — không còn bước giáo viên nhận.
    await cham("GV-A", ngay, "17:48");
    await cham("GV-A", ngay, "19:35");
    await db.makeupCase.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
    const r = await doi(ngay, c.id, "GV-A", sau(ngay, 1, "11:00"));
    expect(r.tuanThu).toMatchObject({ studentAttendanceExpected: 2, studentAttendanceRecorded: 2, studentCommentsExpected: 2, studentCommentsCompleted: 2, overallStatus: "COMPLETE" });
  });

  it("[UAT-C09] NHÂN VIÊN CA THƯỜNG: thẻ cũ nguyên vẹn (không khối ngữ cảnh, không hồ sơ buổi), không dòng tuân thủ nào; GV vẫn có báo cáo", async () => {
    const ngay = "2026-12-18";
    await db.shiftAssignment.create({ data: { userId: id.NV, centerId: cs1, workDate: ngayDb(ngay), templateId: mauC, templateCode: `${TAG}-C`, segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] } });
    const truoc = await the("NV", ngay, "13:40");
    expect(ncT.hienKhoiNguCanh(truoc)).toBe(false);
    expect(truoc?.teaching ?? []).toEqual([]);
    expect(await cham("NV", ngay, "13:40")).toBe("CHECK_IN");
    expect(await cham("NV", ngay, "17:35")).toBe("CHECK_OUT");
    const ds = await wu.docDoiSoatThucHien({ centerId: cs1, tu: ngay, den: ngay, now: sau(ngay, 1, "11:00") });
    expect(ds.dong.filter((r) => r.bc.userId === id.NV)).toEqual([]);
    const thang = await wu.docDoiSoatThucHien({ centerId: cs1, tu: "2026-12-01", den: "2026-12-31", now: vn("2027-01-02", "11:00") });
    const bao = ttb.tuanThuTheoNguoi(thang.dong.flatMap((r) => (r.tuanThu ? [r.tuanThu] : [])));
    expect(bao.map((x) => x.userId)).not.toContain(id.NV);
    expect(bao.map((x) => x.userId)).toContain(id["GV-A"]);
  });
});
