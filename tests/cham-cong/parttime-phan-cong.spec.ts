// tests/cham-cong/parttime-phan-cong.spec.ts — Công Parttime SR.QD.238 · P2: phân công + xác nhận nhận lớp trên Postgres THẬT.
// Ma trận PT2-01..18 (task P2 §32). Thứ test thuần không chứng minh được: chỉ mục từng phần (một MAIN sống), khoá ngoại
// RESTRICT, trigger bất biến, idempotent dưới khoá, scopedDb theo cơ sở, thay người + phiên bản khi đổi lịch, và các
// đường ĐANG CHẠY (đơn dạy thay, dời lịch, xoá buổi) thật sự đi qua dịch vụ phân công.
//
// Công tắc `shift.phanCongNhanLopBat` giả lập TRONG FILE NÀY (mock `getSetting` cho đúng một khoá) — không ghi
// SystemSetting, nên không bật hộ các bộ khác chạy chung DB.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import type { Actor, PermEntry } from "../../lib/auth/actor";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-phan-cong] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ bat: true }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      key === "shift.phanCongNhanLopBat" ? ctl.bat : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});

const TAG = "pt2pc";
const vn = (y: number, m: number, dd: number, h: number, mi = 0) => new Date(Date.UTC(y, m - 1, dd, h - 7, mi));
const NOW_TEST = new Date("2026-10-20T03:00:00Z");

d("[PT2] phân công + xác nhận nhận lớp — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let requests: typeof import("../../lib/cham-cong/requests");
  let buoiGhi: typeof import("../../lib/classes/buoi-ghi");
  let scope: typeof import("../../lib/db-scope");

  let cs1 = "";
  let cs2 = "";
  let gv = "";
  let gv2 = "";
  let ta = "";
  let ql = "";
  let khoaSata3 = "";
  let khoaKhac = "";
  let bai = "";
  let lopSata3 = ""; // Sata 3, 7 HV ⇒ TA bắt buộc
  let lopThuong = ""; // khoá ngoài bảng ngưỡng ⇒ TA tuỳ chọn
  let lopCs2 = "";
  const actor = { id: "", name: "QLCS pt2" };

  async function cleanup() {
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const classIds = cls.map((c) => c.id);
    const pcs = await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    if (pcs.length) {
      await db.$transaction([
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
        db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcs.map((p) => p.id) } } }),
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      ]);
      await db.auditLog.deleteMany({ where: { entityType: "SessionStaffAssignment", entityId: { in: pcs.map((p) => p.id) } } });
    }
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.classStaffingRequirement.deleteMany({ where: { classId: { in: classIds } } });
    const reqs = await db.workRequest.findMany({ where: { requesterId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: reqs.map((r) => r.id) } } });
    await db.workRequest.deleteMany({ where: { requesterId: { in: ids } } });
    for (const id of classIds) {
      await db.domainEvent.deleteMany({ where: { type: "class.session_changed", payloadJson: { path: ["classId"], equals: id } } });
    }
    const sessions = await db.classSession.findMany({ where: { classId: { in: classIds } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityType: "ClassSession", entityId: { in: sessions.map((s) => s.id) } } });
    await db.enrollment.deleteMany({ where: { classId: { in: classIds } } });
    await db.student.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.classSession.deleteMany({ where: { classId: { in: classIds } } });
    await db.class.deleteMany({ where: { id: { in: classIds } } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    const tcs = await db.trialClassV2.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } });
    await db.trialClassSession.deleteMany({ where: { trialClassId: { in: tcs.map((t) => t.id) } } });
    await db.trialClassV2.deleteMany({ where: { id: { in: tcs.map((t) => t.id) } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  /**
   * Hai dòng chính sách do MIGRATION chèn. Bộ DB khác (`resetDb()` của nen/hoc-bu) TRUNCATE mọi bảng nên chạy chung
   * một DB là mất chúng ⇒ ca này dựng lại ĐÚNG tham số đọc từ migration (không chép tay) — mỗi bộ tự đứng được (luật 18).
   */
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

  beforeAll(async () => {
    await damBaoChinhSach();
    svc = await import("../../lib/parttime/phan-cong-db");
    requests = await import("../../lib/cham-cong/requests");
    buoiGhi = await import("../../lib/classes/buoi-ghi");
    scope = await import("../../lib/db-scope");
    const mkCs = (s: string) =>
      db.center.upsert({ where: { slug: `${TAG}-${s}` }, update: {}, create: { slug: `${TAG}-${s}`, name: `CS ${s}`, address: "x", code: `${TAG}-${s}` }, select: { id: true } });
    cs1 = (await mkCs("cs1")).id;
    cs2 = (await mkCs("cs2")).id;
    await cleanup();
    const mk = (email: string, name: string, role: "TEACHER" | "CENTER_MANAGER" = "TEACHER") =>
      db.user.create({ data: { email: `${email}@${TAG}.test`, name, role, roles: [role], password: "x", centerId: cs1 }, select: { id: true } });
    gv = (await mk("gv", "GV pt2")).id;
    gv2 = (await mk("gv2", "GV thay pt2")).id;
    ta = (await mk("ta", "TA pt2")).id;
    ql = (await mk("ql", "QLCS pt2", "CENTER_MANAGER")).id;
    actor.id = ql;
    khoaSata3 = (await db.course.create({ data: { name: "Sata 3", slug: `${TAG}-sata3` }, select: { id: true } })).id;
    khoaKhac = (await db.course.create({ data: { name: "Robotics nâng cao", slug: `${TAG}-khac` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoaSata3, name: "GT pt2" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
    const mkLop = (name: string, courseId: string, centerId: string, assistantId: string | null = null) =>
      db.class.create({
        data: { name: `${TAG} ${name}`, courseId, centerId, teacherId: gv, assistantId, startTime: "17:30", endTime: "19:30" },
        select: { id: true },
      });
    lopSata3 = (await mkLop("SATA3", khoaSata3, cs1, ta)).id;
    lopThuong = (await mkLop("THUONG", khoaKhac, cs1)).id;
    lopCs2 = (await mkLop("CS2", khoaKhac, cs2)).id;
    for (let i = 0; i < 7; i++) {
      const hv = await db.student.create({ data: { name: `${TAG} hv${i}`, centerId: cs1 }, select: { id: true } });
      await db.enrollment.create({ data: { studentId: hv.id, classId: lopSata3, courseId: khoaSata3, centerId: cs1, status: "ACTIVE" } });
    }
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  // Mỗi ca dựng buổi riêng (luật 18). Ngày ≥ 15/10/2026 ⇒ thuộc SR.QD.238.
  let ngayKe = 0;
  const buoiMoi = async (classId: string, centerId = cs1) => {
    ngayKe++;
    const s = await db.classSession.create({ data: { classId, centerId, status: "SCHEDULED", date: vn(2026, 11, ngayKe, 17, 30) }, select: { id: true, date: true } });
    return s;
  };
  const lop = (id: string) => ({ sourceType: "CLASS_SESSION" as const, sourceId: id });
  const phan = (sessionId: string, userId: string, role: "MAIN_TEACHER" | "TEACHING_ASSISTANT" = "MAIN_TEACHER") =>
    db.$transaction((tx) => svc.phanCongVaoBuoi(tx, { nguon: lop(sessionId), userId, role, assignmentType: "REGULAR", actor }));
  const quyet = (assignmentId: string, nguoiBamId: string, quyetDinh: "ACCEPTED" | "DECLINED", lyDo?: string) =>
    db.$transaction(async (tx) => svc.quyetDinhNhanLop(tx, { assignmentId, nguoiBam: { id: nguoiBamId, name: "x" }, quyetDinh, lyDo, phienBanDaXem: (await tx.sessionStaffAssignment.findUnique({ where: { id: assignmentId } }))?.assignmentVersion ?? 0 }));
  const nhanLuc = (sessionId: string) => svc.docNhanLucBuoi(db, lop(sessionId));
  /** Số DẤU đồng bộ đang chờ cho các buổi (DomainEvent `parttime.staffing_dirty` PENDING). */
  const soDauCho = async (sessionIds: string[]) => {
    const ev = await db.domainEvent.findMany({ where: { type: "parttime.staffing_dirty", status: "PENDING" }, select: { payloadJson: true } });
    return ev.filter((e) => ((e.payloadJson as { nguon?: { sourceId: string }[] }).nguon ?? []).some((n) => sessionIds.includes(n.sourceId))).length;
  };
  /** Chạy hàng đợi CHỈ cho loại sự kiện của Parttime, bằng đúng handler outbox thật — không đụng sự kiện của bộ khác. */
  const chayHangDoi = async () => {
    const { onStaffingDirty } = await import("../../lib/parttime/dong-bo");
    const ev = await db.domainEvent.findMany({ where: { type: "parttime.staffing_dirty", status: "PENDING" }, orderBy: { createdAt: "asc" } });
    for (const e of ev) {
      await onStaffingDirty({ id: e.id, type: e.type, payload: e.payloadJson as Record<string, unknown> });
      await db.domainEvent.update({ where: { id: e.id }, data: { status: "DONE" } });
    }
    return ev.length;
  };
  const okId = (r: Awaited<ReturnType<typeof phan>>) => {
    if (!r.ok) throw new Error(r.loi);
    return r.id;
  };

  it("[PT2-01] phân công MAIN thường: WAITING_ACCEPTANCE, phiên bản 1, ảnh chụp lịch đúng buổi, có audit + thông báo người được phân", async () => {
    const s = await buoiMoi(lopThuong);
    const r = await phan(s.id, gv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pc = await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: r.id } });
    expect(pc).toMatchObject({ status: "WAITING_ACCEPTANCE", assignmentVersion: 1, role: "MAIN_TEACHER", centerId: cs1, gioBatDau: "17:30", gioKetThuc: "19:30", activityType: "REGULAR_CLASS" });
    expect(pc.ngay.toISOString().slice(0, 10)).toBe(s.date.toISOString().slice(0, 10));
    expect(r.thongBao).toEqual([expect.objectContaining({ userId: gv, href: "/teacher/phan-cong", dedupeKey: `parttime.phan-cong:${r.id}:v1` })]);
    const audit = await db.auditLog.findMany({ where: { entityType: "SessionStaffAssignment", entityId: r.id }, select: { action: true } });
    expect(audit.map((a) => a.action).sort()).toEqual(["PT_ACCEPTANCE_REQUESTED", "PT_ASSIGNMENT_CREATED"]);
    expect((await nhanLuc(s.id))?.trangThai).toBe("WAITING_ACCEPTANCE");
  });

  it("[PT2-02] MAIN tự NHẬN ⇒ ACCEPTED + bản ghi xác nhận mang phiên bản; buổi TA tuỳ chọn ⇒ STAFFING_CONFIRMED", async () => {
    const s = await buoiMoi(lopThuong);
    const id = okId(await phan(s.id, gv));
    expect((await quyet(id, gv, "ACCEPTED")).ok).toBe(true);
    expect((await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id } })).status).toBe("ACCEPTED");
    const xn = await db.staffAssignmentAcceptance.findMany({ where: { assignmentId: id } });
    expect(xn).toHaveLength(1);
    expect(xn[0]).toMatchObject({ assignmentVersion: 1, decision: "ACCEPTED", userId: gv, roleSnapshot: "MAIN_TEACHER" });
    expect(await nhanLuc(s.id)).toMatchObject({ trangThai: "STAFFING_CONFIRMED", yeuCauTA: "OPTIONAL" });
  });

  it("[PT2-03] MAIN TỪ CHỐI: bắt buộc lý do ≥5 ký tự; DECLINED ⇒ STAFFING_REJECTED, QLCS (người phân) nhận chuông; nhận lại không được", async () => {
    const s = await buoiMoi(lopThuong);
    const id = okId(await phan(s.id, gv));
    expect(await quyet(id, gv, "DECLINED", "ốm")).toEqual({ ok: false, loi: "Ghi lý do từ chối (tối thiểu 5 ký tự)" });
    const r = await quyet(id, gv, "DECLINED", "Trùng lịch thi");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.thongBao).toEqual([expect.objectContaining({ userId: ql, href: "/cham-cong/phan-cong" })]);
    expect((await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id } })).status).toBe("DECLINED");
    expect((await nhanLuc(s.id))?.trangThai).toBe("STAFFING_REJECTED");
    expect((await quyet(id, gv, "ACCEPTED")).ok).toBe(false);
  });

  it("[PT2-04] lớp Sata 3 có 7 HV ⇒ TA BẮT BUỘC; MAIN nhận mà chưa có TA ⇒ STAFFING_DRAFT; TA được phân chưa nhận ⇒ PARTIALLY_ACCEPTED", async () => {
    const s = await buoiMoi(lopSata3);
    const main = okId(await phan(s.id, gv));
    await quyet(main, gv, "ACCEPTED");
    expect(await nhanLuc(s.id)).toMatchObject({ yeuCauTA: "REQUIRED", trangThai: "STAFFING_DRAFT" });
    okId(await phan(s.id, ta, "TEACHING_ASSISTANT"));
    expect((await nhanLuc(s.id))?.trangThai).toBe("PARTIALLY_ACCEPTED");
  });

  it("[PT2-05] MAIN + TA bắt buộc cùng NHẬN ⇒ STAFFING_CONFIRMED; QLCS hạ TA thành tuỳ chọn cần lý do + audit", async () => {
    const s = await buoiMoi(lopSata3);
    const main = okId(await phan(s.id, gv));
    const tro = okId(await phan(s.id, ta, "TEACHING_ASSISTANT"));
    await quyet(main, gv, "ACCEPTED");
    await quyet(tro, ta, "ACCEPTED");
    expect((await nhanLuc(s.id))?.trangThai).toBe("STAFFING_CONFIRMED");

    const s2 = await buoiMoi(lopSata3);
    const m2 = okId(await phan(s2.id, gv));
    await quyet(m2, gv, "ACCEPTED");
    expect((await nhanLuc(s2.id))?.trangThai).toBe("STAFFING_DRAFT");
    expect(await db.$transaction((tx) => svc.datYeuCauTroGiang(tx, { classId: lopSata3, taRequired: false, lyDo: "abc", actor }))).toEqual({ ok: false, loi: "Ghi lý do (tối thiểu 5 ký tự)" });
    expect((await db.$transaction((tx) => svc.datYeuCauTroGiang(tx, { classId: lopSata3, taRequired: false, lyDo: "Lớp ôn thi ít bài thực hành", actor }))).ok).toBe(true);
    expect(await nhanLuc(s2.id)).toMatchObject({ yeuCauTA: "OVERRIDDEN_OPTIONAL", trangThai: "STAFFING_CONFIRMED" });
    expect(await db.auditLog.count({ where: { entityType: "ClassStaffingRequirement", entityId: lopSata3, action: "PT_TA_REQUIREMENT_SET" } })).toBe(1);
    await db.classStaffingRequirement.deleteMany({ where: { classId: lopSata3 } });
  });

  it("[PT2-06] TA tuỳ chọn vắng mặt KHÔNG chặn: chỉ MAIN nhận ⇒ STAFFING_CONFIRMED", async () => {
    const s = await buoiMoi(lopThuong);
    const main = okId(await phan(s.id, gv));
    await quyet(main, gv, "ACCEPTED");
    expect(await nhanLuc(s.id)).toMatchObject({ yeuCauTA: "OPTIONAL", trangThai: "STAFFING_CONFIRMED" });
  });

  it("[PT2-07] dời lịch (đường THẬT `dichNgayBuoi`) ⇒ phiên bản +1, về WAITING_ACCEPTANCE, xác nhận cũ hết hiệu lực, có audit vô hiệu", async () => {
    const s = await buoiMoi(lopThuong);
    const id = okId(await phan(s.id, gv));
    await quyet(id, gv, "ACCEPTED");
    expect((await nhanLuc(s.id))?.trangThai).toBe("STAFFING_CONFIRMED");
    const den = new Date(s.date.getTime() + 2 * 3600_000); // dời 2 giờ cùng ngày ⇒ giờ bắt đầu đổi
    await db.$transaction((tx) => buoiGhi.dichNgayBuoi(tx, { classId: lopThuong, moves: [{ id: s.id, oldDate: s.date, newDate: den }], xoaSuaTay: false }));
    // P3a: đường dời lịch CHỈ đánh dấu (giao dịch nghiệp vụ có thể có scope) — đồng bộ chạy sau commit qua hàng đợi.
    expect(await soDauCho([s.id])).toBe(1);
    expect((await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id } })).assignmentVersion).toBe(1);
    await chayHangDoi();
    const pc = await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id } });
    expect(pc).toMatchObject({ assignmentVersion: 2, status: "WAITING_ACCEPTANCE", gioBatDau: "19:30" });
    expect((await nhanLuc(s.id))?.trangThai).toBe("WAITING_ACCEPTANCE");
    expect(await db.auditLog.count({ where: { entityId: id, action: "PT_ACCEPTANCE_INVALIDATED" } })).toBe(1);
    // Nhận lại phiên bản 2 ⇒ hai bản ghi xác nhận, bản cũ KHÔNG bị sửa.
    expect((await quyet(id, gv, "ACCEPTED")).ok).toBe(true);
    const xn = await db.staffAssignmentAcceptance.findMany({ where: { assignmentId: id }, orderBy: { assignmentVersion: "asc" } });
    expect(xn.map((x) => x.assignmentVersion)).toEqual([1, 2]);
  });

  it("[PT2-08] đổi GHI CHÚ không đáng kể ⇒ giữ phiên bản + trạng thái, xác nhận vẫn hiệu lực", async () => {
    const s = await buoiMoi(lopThuong);
    const id = okId(await phan(s.id, gv));
    await quyet(id, gv, "ACCEPTED");
    expect((await db.$transaction((tx) => svc.doiGhiChuPhanCong(tx, { id, note: "Mang thêm bộ kit", actor }))).ok).toBe(true);
    const pc = await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id } });
    expect(pc).toMatchObject({ note: "Mang thêm bộ kit", assignmentVersion: 1, status: "ACCEPTED" });
    expect((await nhanLuc(s.id))?.trangThai).toBe("STAFFING_CONFIRMED");
    // Dời mà thời điểm không đổi (đồng bộ lại không có trường đáng kể nào) ⇒ không đụng gì.
    const r = await db.$transaction((tx) => svc.dongBoLichPhanCong(tx, { nguon: lop(s.id), actor }));
    expect(r.soDoi).toBe(0);
    expect((await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id } })).assignmentVersion).toBe(1);
  });

  const base = {
    startTime: null, endTime: null, hours: null, requesterNewTemplateId: null,
    targetNewTemplateId: null, leaveTypeId: null, requestedInAt: null, requestedOutAt: null,
    requestedIn2At: null, requestedOut2At: null, chosenCenterId: null, leaveDurationType: null, detail: null, reason: "test",
  };
  const duyetDayThay = async (sessionDate: Date, classId: string, targetUserId: string) => {
    const ngay = new Date(Date.UTC(sessionDate.getUTCFullYear(), sessionDate.getUTCMonth(), sessionDate.getUTCDate()));
    const n = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: gv, kind: "SUB_TEACH", fromDate: ngay, toDate: null, classId, className: "x", targetUserId });
    if (!n.ok) throw new Error(n.error);
    const r = await requests.decideRequest({ now: NOW_TEST, requestId: n.id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true });
    if (!r.ok) throw new Error(r.error);
    return { donId: n.id, r };
  };

  it("[PT2-09] đơn DẠY THAY duyệt (đường THẬT decideRequest) ⇒ MAIN cũ REPLACED, người thay SUBSTITUTE chờ xác nhận, mang mã đơn; không sinh công", async () => {
    const s = await buoiMoi(lopThuong);
    const cu = okId(await phan(s.id, gv));
    await quyet(cu, gv, "ACCEPTED");
    const { donId, r } = await duyetDayThay(s.date, lopThuong, gv2);
    expect(r.ok && r.thongBaoPhanCong.map((t) => t.userId).sort()).toEqual([gv, gv2].sort());
    const ds = await db.sessionStaffAssignment.findMany({ where: { sourceId: s.id }, orderBy: { createdAt: "asc" } });
    expect(ds.map((x) => [x.userId, x.status, x.assignmentType])).toEqual([
      [gv, "REPLACED", "REGULAR"],
      [gv2, "WAITING_ACCEPTANCE", "SUBSTITUTE"],
    ]);
    expect(ds[1]).toMatchObject({ sourceWorkRequestId: donId, replacesAssignmentId: cu });
    expect((await db.classSession.findUniqueOrThrow({ where: { id: s.id } })).substituteTeacherId).toBe(gv2);
    expect((await nhanLuc(s.id))?.trangThai).toBe("WAITING_ACCEPTANCE");
  });

  it("[PT2-10] người DẠY THAY từ chối ⇒ NEEDS_REASSIGNMENT (không phải 'bác cả đội hình')", async () => {
    const s = await buoiMoi(lopThuong);
    const cu = okId(await phan(s.id, gv));
    await quyet(cu, gv, "ACCEPTED");
    await duyetDayThay(s.date, lopThuong, gv2);
    const thay = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: s.id, userId: gv2 } });
    expect((await quyet(thay.id, gv2, "DECLINED", "Không kịp di chuyển")).ok).toBe(true);
    expect((await nhanLuc(s.id))?.trangThai).toBe("NEEDS_REASSIGNMENT");
  });

  it("[PT2-11] dạy thay KHÔNG nhân đôi MAIN: chạy lại cùng đơn (idempotent), phân MAIN thứ hai bị từ chối, chỉ mục DB chặn MAIN sống thứ hai", async () => {
    const s = await buoiMoi(lopThuong);
    okId(await phan(s.id, gv));
    const { donId } = await duyetDayThay(s.date, lopThuong, gv2);
    // Chạy lại đúng bước tích hợp của đơn (vd. thử lại sau lỗi mạng) ⇒ trả lại phân công đã có.
    const lai = await db.$transaction((tx) => svc.thayGiaoVienChinh(tx, { nguon: lop(s.id), gvMoiId: gv2, actor, sourceWorkRequestId: donId, lyDo: "thử lại" }));
    expect(lai).toMatchObject({ ok: true, moi: false });
    expect(await phan(s.id, ta)).toEqual({ ok: false, loi: "Buổi đã có giáo viên đứng chính — dùng thao tác thay giáo viên" });
    const song = await db.sessionStaffAssignment.count({ where: { sourceId: s.id, role: "MAIN_TEACHER", status: { in: ["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED"] } } });
    expect(song).toBe(1);
    const goc = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: s.id, userId: gv2 } });
    await expect(
      db.sessionStaffAssignment.create({
        data: { sourceType: "CLASS_SESSION", sourceId: s.id, centerId: cs1, ngay: goc.ngay, gioBatDau: "17:30", gioKetThuc: "19:30", userId: ta, role: "MAIN_TEACHER", activityType: "REGULAR_CLASS" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("[PT2-12] buổi HỌC BÙ (MakeupCase): phân công đọc lịch + cơ sở từ case, hoạt động MAKEUP", async () => {
    const c = await db.makeupCase.create({
      data: { centerId: cs1, courseId: khoaSata3, lessonId: bai, date: new Date(Date.UTC(2026, 10, 20)), startTime: "14:00", endTime: "15:30", teacherId: gv, status: "SCHEDULED", createdById: ql },
      select: { id: true },
    });
    const r = await db.$transaction((tx) => svc.phanCongVaoBuoi(tx, { nguon: { sourceType: "MAKEUP_CASE", sourceId: c.id }, userId: gv, role: "MAIN_TEACHER", assignmentType: "REGULAR", actor }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pc = await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: r.id } });
    expect(pc).toMatchObject({ sourceType: "MAKEUP_CASE", activityType: "MAKEUP", assignmentType: "REGULAR", gioBatDau: "14:00", gioKetThuc: "15:30", centerId: cs1 });
    expect(pc.ngay.toISOString().slice(0, 10)).toBe("2026-11-20");
  });

  it("[PT2-13] buổi TRIAL: hoạt động TRIAL, cơ sở lấy từ lớp trial", async () => {
    const tc = await db.trialClassV2.create({ data: { code: `${TAG}-tc1`, name: "Trial pt2", centerId: cs2, sessionCount: 1, teacherId: gv }, select: { id: true } });
    const ts = await db.trialClassSession.create({ data: { trialClassId: tc.id, seq: 1, date: new Date(Date.UTC(2026, 10, 21)), startTime: "09:00", endTime: "10:30", teacherId: gv }, select: { id: true } });
    const r = await db.$transaction((tx) => svc.phanCongVaoBuoi(tx, { nguon: { sourceType: "TRIAL_SESSION", sourceId: ts.id }, userId: gv, role: "MAIN_TEACHER", assignmentType: "REGULAR", actor }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ activityType: "TRIAL", centerId: cs2, gioBatDau: "09:00" });
  });

  it("[PT2-14] thử lại / hai lượt song song cùng người cùng vai ⇒ MỘT phân công (khoá theo buổi + chỉ mục từng phần)", async () => {
    const s = await buoiMoi(lopThuong);
    const [a, b] = await Promise.all([phan(s.id, gv), phan(s.id, gv)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.id).toBe(b.id);
    expect([a.moi, b.moi].sort()).toEqual([false, true]);
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: s.id } })).toBe(1);
    // Dựng mặc định chạy lại bao nhiêu lần cũng không đẻ thêm.
    const s2 = await buoiMoi(lopSata3);
    await db.$transaction((tx) => svc.dungPhanCongMacDinh(tx, { nguon: lop(s2.id), actor }));
    await db.$transaction((tx) => svc.dungPhanCongMacDinh(tx, { nguon: lop(s2.id), actor }));
    expect((await db.sessionStaffAssignment.findMany({ where: { sourceId: s2.id }, select: { userId: true, role: true } })).map((x) => `${x.role}:${x.userId}`).sort()).toEqual(
      [`MAIN_TEACHER:${gv}`, `TEACHING_ASSISTANT:${ta}`].sort(),
    );
  });

  it("[PT2-15] cách ly cơ sở: cơ sở của phân công lấy từ BUỔI; QLCS CS1 đọc qua scopedDb không thấy phân công CS2", async () => {
    const s1 = await buoiMoi(lopThuong, cs1);
    const s2 = await buoiMoi(lopCs2, cs2);
    const a = okId(await phan(s1.id, gv));
    const b = okId(await phan(s2.id, gv));
    expect((await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: b } })).centerId).toBe(cs2);
    const perm = (action: string): PermEntry => ({ action, scopeType: "GLOBAL", orgUnitId: "org-cs1", roleCode: "CENTER_MANAGER", centerScope: [cs1] });
    const qlcs1: Actor = {
      userId: ql,
      isSuperAdmin: false,
      isHoLevel: false,
      orgRoles: [{ orgUnitId: "org-cs1", roleCode: "CENTER_MANAGER" }],
      permissions: [perm("hr_attendance:view"), perm("hr_attendance:assign")],
      visibleCenterIds: [cs1],
      visibleOrgUnitIds: ["org-cs1"],
      grantsAllow: new Set(),
      assignedClassIds: new Set(),
    };
    const thay = await scope.scopedDb(qlcs1).sessionStaffAssignment.findMany({ where: { id: { in: [a, b] } }, select: { id: true } });
    expect(thay.map((x) => x.id)).toEqual([a]);
  });

  it("[PT2-16] người KHÁC không xác nhận hộ được (kể cả QLCS) — không bản ghi xác nhận nào sinh ra", async () => {
    const s = await buoiMoi(lopThuong);
    const id = okId(await phan(s.id, gv));
    expect(await quyet(id, ql, "ACCEPTED")).toEqual({ ok: false, loi: "Chỉ người được phân mới xác nhận được phân công này" });
    expect(await quyet(id, gv2, "DECLINED", "không phải việc của tôi")).toEqual({ ok: false, loi: "Chỉ người được phân mới xác nhận được phân công này" });
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: id } })).toBe(0);
    expect((await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id } })).status).toBe("WAITING_ACCEPTANCE");
  });

  it("[PT2-17] xác nhận BẤT BIẾN: UPDATE / DELETE bị trigger chặn; xoá phân công có xác nhận bị FK RESTRICT chặn", async () => {
    const s = await buoiMoi(lopThuong);
    const id = okId(await phan(s.id, gv));
    await quyet(id, gv, "ACCEPTED");
    const xn = await db.staffAssignmentAcceptance.findFirstOrThrow({ where: { assignmentId: id } });
    await expect(db.staffAssignmentAcceptance.update({ where: { id: xn.id }, data: { decision: "DECLINED" } })).rejects.toThrow(/SAA_IMMUTABLE/);
    await expect(db.staffAssignmentAcceptance.delete({ where: { id: xn.id } })).rejects.toThrow(/SAA_IMMUTABLE/);
    await expect(db.sessionStaffAssignment.delete({ where: { id } })).rejects.toThrow();
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: id } })).toBe(1);
  });

  it("[PT2-18] XOÁ CỨNG buổi đã có phân công bị chặn (kể cả phân công đã huỷ); buổi không phân công thì không bị chặn", async () => {
    const s = await buoiMoi(lopThuong);
    expect(await svc.chanXoaBuoiCoPhanCong(s.id)).toBeNull();
    const id = okId(await phan(s.id, gv));
    expect(await svc.chanXoaBuoiCoPhanCong(s.id)).toMatch(/không xoá được/);
    expect((await db.$transaction((tx) => svc.huyPhanCong(tx, { id, actor, lyDo: "Lớp đổi giáo viên" }))).ok).toBe(true);
    expect(await svc.chanXoaBuoiCoPhanCong(s.id)).toMatch(/1 phân công/);
  });

  it("[PT2-19] công tắc TẮT ⇒ đơn dạy thay chạy đường cũ, KHÔNG đụng phân công (merge không đổi hành vi)", async () => {
    const s = await buoiMoi(lopThuong);
    okId(await phan(s.id, gv));
    ctl.bat = false;
    try {
      const { r } = await duyetDayThay(s.date, lopThuong, gv2);
      expect(r.ok && r.thongBaoPhanCong).toEqual([]);
    } finally {
      ctl.bat = true;
    }
    expect((await db.sessionStaffAssignment.findMany({ where: { sourceId: s.id } })).map((x) => [x.userId, x.status])).toEqual([[gv, "WAITING_ACCEPTANCE"]]);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: s.id } })).substituteTeacherId).toBe(gv2);
  });

  it("[PT2-20] buổi trước 15/10/2026 (LEGACY) ⇒ đơn dạy thay không sinh phân công dù công tắc bật", async () => {
    const s = await db.classSession.create({ data: { classId: lopThuong, centerId: cs1, status: "SCHEDULED", date: vn(2026, 10, 14, 17, 30) }, select: { id: true, date: true } });
    const { r } = await duyetDayThay(s.date, lopThuong, gv2);
    expect(r.ok && r.thongBaoPhanCong).toEqual([]);
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: s.id } })).toBe(0);
    // Phân TAY (màn QLCS) cũng không được — chính sách cũ không có phân công SR.QD.238.
    expect(await phan(s.id, gv)).toEqual({ ok: false, loi: "Buổi trước 15/10/2026 thuộc chính sách cũ — không phân công theo SR.QD.238" });
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: s.id } })).toBe(0);
  });

  it("[PT2-21] màn lớp học (adjustSession / cancelSession với dongBoPhanCong) ⇒ đổi giờ lên phiên bản mới; huỷ buổi huỷ phân công, buổi bù được dựng mặc định", async () => {
    const adj = await import("../../lib/classes/adjust");
    const s = await buoiMoi(lopSata3);
    const main = okId(await phan(s.id, gv));
    await quyet(main, gv, "ACCEPTED");
    const r = await adj.adjustSession({ dongBoPhanCong: true, sessionId: s.id, date: new Date(s.date.getTime() + 3600_000), actorId: ql, actorName: "QLCS pt2" });
    expect(r.ok).toBe(true);
    expect(await soDauCho([s.id])).toBe(1);
    await chayHangDoi();
    expect(await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: main } })).toMatchObject({ assignmentVersion: 2, status: "WAITING_ACCEPTANCE", gioBatDau: "18:30" });

    const c = await adj.cancelSession({ dongBoPhanCong: true, sessionId: s.id, reason: "Trung tâm mất điện", actorId: ql, actorName: "QLCS pt2" });
    expect(c.ok).toBe(true);
    await chayHangDoi();
    expect((await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: main } })).status).toBe("CANCELLED");
    // Buổi bù cuối lịch sinh qua `themBuoi` ⇒ có phân công mặc định GV + TA của lớp, chờ xác nhận.
    const bu = await db.sessionStaffAssignment.findMany({ where: { sourceId: c.makeupSessionId! }, select: { userId: true, role: true, status: true, assignmentType: true } });
    expect(bu.map((x) => `${x.role}:${x.userId}:${x.status}:${x.assignmentType}`).sort()).toEqual(
      [`MAIN_TEACHER:${gv}:WAITING_ACCEPTANCE:SYSTEM`, `TEACHING_ASSISTANT:${ta}:WAITING_ACCEPTANCE:SYSTEM`].sort(),
    );
  });
});
