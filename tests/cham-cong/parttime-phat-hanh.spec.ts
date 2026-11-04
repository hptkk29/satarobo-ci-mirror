// tests/cham-cong/parttime-phat-hanh.spec.ts — ca RIÊNG của nhánh phát hành `release/parttime-sr-qd-238` (dựng từ `main`).
//
// Trên `main` không có "Mở lại buổi" (PR #623 — xem docs/cham-cong/parttime/DEPENDENCY-623.md). Buổi đã huỷ chỉ sống lại qua
// HOÀN TÁC đơn nghỉ buổi dạy đã duyệt (`huyNghiBuoiDay` → móc `khiKhoiPhucBuoi`). Ca ở đây đi ĐÚNG đường thật đó
// (`decideRequest` → `yeuCauHuyDon` → `quyetDinhHuy` → hàng đợi `parttime.staffing_dirty`) và ghim hợp đồng §8 của đợt phát hành:
//   · buổi về SCHEDULED theo vòng đời chuẩn;
//   · phân công cũ KHÔNG sống lại — dòng MỚI phiên bản 1, chờ xác nhận lại;
//   · bản ghi xác nhận cũ còn nguyên (bất biến);
//   · công tắc TẮT ⇒ cùng luồng đơn không sinh phân công nào, không xếp việc đồng bộ nào.
//
// Công tắc `shift.parttime*Enabled` giả lập TRONG FILE (mock `getSetting`), không ghi SystemSetting.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-phat-hanh] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ bat: true }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? ctl.bat : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const TAG = "relpt";
const NOW_TEST = new Date("2026-10-20T03:00:00Z");
const vn = (y: number, m: number, dd: number, h: number, mi = 0) => new Date(Date.UTC(y, m - 1, dd, h - 7, mi));

d("[REL] nhánh phát hành từ main — vòng đời buổi sống lại", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let requests: typeof import("../../lib/cham-cong/requests");
  let huyDon: typeof import("../../lib/cham-cong/huy-don");
  let cs = "";
  let gv = "";
  let classId = "";
  const actor = { id: "", name: "QLCS rel" };

  const base = {
    startTime: null, endTime: null, hours: null, targetUserId: null, requesterNewTemplateId: null,
    targetNewTemplateId: null, leaveTypeId: null, requestedInAt: null, requestedOutAt: null,
    requestedIn2At: null, requestedOut2At: null, chosenCenterId: null, leaveDurationType: null, detail: null, reason: "test",
  };

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
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const classIds = cls.map((c) => c.id);
    const reqs = await db.workRequest.findMany({ where: { requesterId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: reqs.map((r) => r.id) } } });
    await db.workRequest.deleteMany({ where: { requesterId: { in: ids } } });
    for (const id of classIds) {
      await db.domainEvent.deleteMany({ where: { type: "class.session_changed", payloadJson: { path: ["classId"], equals: id } } });
    }
    const sessions = await db.classSession.findMany({ where: { classId: { in: classIds } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityType: "ClassSession", entityId: { in: sessions.map((s) => s.id) } } });
    await db.classSession.deleteMany({ where: { classId: { in: classIds } } });
    await db.class.deleteMany({ where: { id: { in: classIds } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    svc = await import("../../lib/parttime/phan-cong-db");
    dongBo = await import("../../lib/parttime/dong-bo");
    requests = await import("../../lib/cham-cong/requests");
    huyDon = await import("../../lib/cham-cong/huy-don");
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS rel", address: "x", code: `${TAG}-CS` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-CS` }, update: {}, create: { type: "CENTER", code: `${TAG}-CS`, name: "ĐV rel", path: `/${TAG}-cs/`, depth: 0, centerId: cs } });
    await cleanup();
    const mk = (email: string, name: string, role: "TEACHER" | "CENTER_MANAGER" = "TEACHER") =>
      db.user.create({ data: { email: `${email}@${TAG}.test`, name, role, roles: [role], password: "x", centerId: cs }, select: { id: true } });
    gv = (await mk("gv", "GV rel")).id;
    actor.id = (await mk("ql", "QLCS rel", "CENTER_MANAGER")).id;
    const khoa = (await db.course.create({ data: { name: "Robotics rel", slug: `${TAG}-k` }, select: { id: true } })).id;
    classId = (await db.class.create({ data: { name: `${TAG} lớp`, courseId: khoa, centerId: cs, teacherId: gv, startTime: "09:00", endTime: "10:30" }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: `${TAG}-CS` } });
    await db.center.deleteMany({ where: { slug: `${TAG}-cs` } });
    await db.$disconnect();
  });

  const chayHangDoi = async () => {
    const ev = await db.domainEvent.findMany({ where: { type: "parttime.staffing_dirty", status: "PENDING" }, orderBy: { createdAt: "asc" } });
    for (const e of ev) {
      await dongBo.onStaffingDirty({ id: e.id, type: e.type, payload: e.payloadJson as Record<string, unknown> });
      await db.domainEvent.update({ where: { id: e.id }, data: { status: "DONE" } });
    }
    return ev.length;
  };
  const pcCua = (sourceId: string) =>
    db.sessionStaffAssignment.findMany({ where: { sourceId }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, role: true, status: true, assignmentVersion: true } });
  const nhan = (assignmentId: string) =>
    db.$transaction(async (tx) =>
      svc.quyetDinhNhanLop(tx, { assignmentId, nguoiBam: { id: gv, name: "GV rel" }, quyetDinh: "ACCEPTED", phienBanDaXem: (await tx.sessionStaffAssignment.findUniqueOrThrow({ where: { id: assignmentId } })).assignmentVersion }),
    );
  const nghiRoiHoanTac = async (ngay: Date) => {
    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: gv, kind: "CLASS_OFF", fromDate: ngay, toDate: null, classId, className: `${TAG} lớp`, targetUserId: null });
    if (!s.ok) throw new Error(s.error);
    const duyet = await requests.decideRequest({ now: NOW_TEST, requestId: s.id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true });
    expect(duyet.ok).toBe(true);
    return s.id;
  };
  const hoanTac = async (requestId: string) => {
    expect((await huyDon.yeuCauHuyDon({ requestId, requesterId: gv, requesterName: "GV rel", lyDo: "khỏi bệnh sớm", now: NOW_TEST })).ok).toBe(true);
    const r = await huyDon.quyetDinhHuy({ requestId, decision: "APPROVED", note: null, actor, canWriteCenter: () => true, now: NOW_TEST });
    expect(r.ok).toBe(true);
  };

  it("[REL-REOPEN-01] hoàn tác đơn nghỉ đã duyệt (đường THẬT trên main) ⇒ buổi SCHEDULED; phân công cũ giữ CANCELLED; dòng MỚI phiên bản 1 ĐÃ GÁN (gán thẳng 20/10/2026), không dựng xác nhận nào", async () => {
    ctl.bat = true;
    const ngay = new Date(Date.UTC(2027, 0, 12));
    const goc = await db.classSession.create({ data: { classId, centerId: cs, status: "SCHEDULED", date: vn(2027, 1, 12, 9) }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: goc.id }], "TAO_BUOI", actor);
    const [cu] = await pcCua(goc.id);
    expect(cu).toMatchObject({ userId: gv, role: "MAIN_TEACHER", status: "ACCEPTED", assignmentVersion: 1 });
    // Gán thẳng: không có bước nhận ⇒ "nhận" phân công đã gán bị từ chối, và không bản ghi xác nhận nào.
    expect((await nhan(cu!.id)).ok).toBe(false);
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: cu!.id } })).toBe(0);

    const donId = await nghiRoiHoanTac(ngay);
    await chayHangDoi();
    expect((await db.classSession.findUniqueOrThrow({ where: { id: goc.id } })).status).toBe("CANCELLED");
    expect((await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: cu!.id } })).status).toBe("CANCELLED");
    const bu = await db.classSession.findFirstOrThrow({ where: { sourceWorkRequestId: donId }, select: { id: true } });

    await hoanTac(donId);
    await chayHangDoi();
    expect((await db.classSession.findUniqueOrThrow({ where: { id: goc.id } })).status).toBe("SCHEDULED");
    expect((await db.classSession.findUniqueOrThrow({ where: { id: bu.id } })).status).toBe("CANCELLED");
    const ds = await pcCua(goc.id);
    expect(ds.map((p) => [p.id === cu!.id, p.userId, p.status, p.assignmentVersion])).toEqual([
      [true, gv, "CANCELLED", 1],
      [false, gv, "ACCEPTED", 1],
    ]);
    // Không dựng xác nhận hộ — cả dòng cũ lẫn dòng mới (gán thẳng).
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: cu!.id } })).toBe(0);
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: ds[1]!.id } })).toBe(0);
    // Buổi bù đã gỡ không giữ phân công sống nào.
    expect((await pcCua(bu.id)).filter((p) => p.status !== "CANCELLED")).toEqual([]);
  });

  it("[REL-OFF-01] công tắc TẮT: cùng luồng nghỉ → hoàn tác KHÔNG sinh phân công, KHÔNG xếp việc đồng bộ", async () => {
    ctl.bat = false;
    try {
      const ngay = new Date(Date.UTC(2027, 1, 16));
      const goc = await db.classSession.create({ data: { classId, centerId: cs, status: "SCHEDULED", date: vn(2027, 2, 16, 9) }, select: { id: true } });
      const truoc = await db.domainEvent.count({ where: { type: "parttime.staffing_dirty" } });
      const donId = await nghiRoiHoanTac(ngay);
      await hoanTac(donId);
      expect((await db.classSession.findUniqueOrThrow({ where: { id: goc.id } })).status).toBe("SCHEDULED");
      expect(await db.domainEvent.count({ where: { type: "parttime.staffing_dirty" } })).toBe(truoc);
      expect(await db.sessionStaffAssignment.count({ where: { sourceId: goc.id } })).toBe(0);
    } finally {
      ctl.bat = true;
    }
  });
});
