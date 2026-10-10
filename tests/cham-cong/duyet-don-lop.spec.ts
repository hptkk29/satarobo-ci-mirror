// tests/cham-cong/duyet-don-lop.spec.ts — đợt 3 đơn từ (08/10/2026): duyệt ĐƠN LỚP (nghỉ buổi dạy /
// dạy thay) chạy trong MỘT giao dịch với trạng thái đơn + audit (BA §13–14).
//
// Trước đợt 3: đơn đổi APPROVED trước, rồi `cancelSession`/`adjustSession` tự mở transaction riêng,
// lỗi thì "bù trừ" đơn về PENDING; audit ghi ở action SAU commit. Ca [DT3-02] là phép cấy CỐ ĐỊNH:
// audit hỏng SAU khi buổi đã bị huỷ ⇒ phải không còn dòng nào đổi.
//
// File RIÊNG (không gộp vào requests.spec.ts) vì nó giả lập module audit — giữ phạm vi giả lập hẹp.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/duyet-don-lop] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

// Cấy lỗi có điều khiển: audit APPROVE_REQUEST ném — nó đứng SAU phép ghi của handler.
const ctl = vi.hoisted(() => ({ hongAuditDuyet: false }));
vi.mock("../../lib/audit/audit-log", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/audit/audit-log")>();
  return {
    ...goc,
    writeAudit: async (p: Parameters<typeof goc.writeAudit>[0]) => {
      if (ctl.hongAuditDuyet && p.action === "APPROVE_REQUEST") throw new Error("audit hỏng (cấy)");
      return goc.writeAudit(p);
    },
  };
});

const TAG = "cc-dt3";
const utc = (y: number, m: number, dd: number) => new Date(Date.UTC(y, m - 1, dd));
const NOW_TEST = new Date("2026-09-09T03:00:00Z");

d("[DT3] duyệt đơn lớp — một giao dịch", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let requests: typeof import("../../lib/cham-cong/requests");
  let cs = "";
  let gv = "";
  let gvThay = "";
  let classId = "";
  const actor = { id: "", name: "QL dt3" };

  const base = {
    startTime: null, endTime: null, hours: null, targetUserId: null, requesterNewTemplateId: null,
    targetNewTemplateId: null, leaveTypeId: null, requestedInAt: null, requestedOutAt: null,
    requestedIn2At: null, requestedOut2At: null, chosenCenterId: null, leaveDurationType: null, detail: null, reason: "test",
  };

  async function cleanup() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const classIds = cls.map((c) => c.id);
    const reqs = await db.workRequest.findMany({ where: { requesterId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: reqs.map((r) => r.id) } } });
    await db.workRequest.deleteMany({ where: { requesterId: { in: ids } } });
    for (const id of classIds) {
      await db.domainEvent.deleteMany({ where: { type: "class.session_changed", payloadJson: { path: ["classId"], equals: id } } });
    }
    const sessions = await db.classSession.findMany({ where: { classId: { in: classIds } }, select: { id: true } });
    await db.attendance.deleteMany({ where: { sessionId: { in: sessions.map((x) => x.id) } } });
    await db.student.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.auditLog.deleteMany({ where: { entityType: "ClassSession", entityId: { in: sessions.map((s) => s.id) } } });
    await db.classSession.deleteMany({ where: { classId: { in: classIds } } });
    await db.class.deleteMany({ where: { id: { in: classIds } } });
    await db.course.deleteMany({ where: { slug: TAG } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    requests = await import("../../lib/cham-cong/requests");
    const c = await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS dt3", address: "x", code: `${TAG}-CS` }, select: { id: true } });
    cs = c.id;
    await cleanup();
    const mk = (email: string, name: string) =>
      db.user.create({ data: { email: `${email}@${TAG}.test`, name, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } });
    gv = (await mk("gv", "GV dt3")).id;
    gvThay = (await mk("gvthay", "GV thay dt3")).id;
    actor.id = (await mk("ql", "QL dt3")).id;
    const course = await db.course.create({ data: { name: "Khoá dt3", slug: TAG }, select: { id: true } });
    classId = (await db.class.create({ data: { name: `${TAG} lớp`, courseId: course.id, centerId: cs, teacherId: gv }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  /** Buổi học lúc `gioVn` (giờ VN) của ngày `ngay` — mỗi ca dựng buổi riêng của mình (luật 18). */
  const taoBuoi = (ngay: Date, gioVn: number, phut = 0) =>
    db.classSession.create({
      data: { classId, centerId: cs, status: "SCHEDULED", date: new Date(Date.UTC(ngay.getUTCFullYear(), ngay.getUTCMonth(), ngay.getUTCDate(), gioVn - 7, phut)) },
      select: { id: true },
    });

  const nopDonLop = async (kind: "CLASS_OFF" | "SUB_TEACH", ngay: Date, targetUserId: string | null = null) => {
    const s = await requests.submitAttendanceRequest({ now: NOW_TEST, ...base, requesterId: gv, kind, fromDate: ngay, toDate: null, classId, className: `${TAG} lớp`, targetUserId });
    if (!s.ok) throw new Error(s.error);
    return s.id;
  };
  const duyet = (id: string) =>
    requests.decideRequest({ now: NOW_TEST, requestId: id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true });

  it("[DT3-01] nghỉ buổi dạy: buổi 06:30 sáng VN (= 23:30 UTC hôm trước) vẫn được tìm thấy và huỷ + buổi bù; audit mang giá trị cũ → mới", async () => {
    const ngay = utc(2026, 10, 20);
    const buoi = await taoBuoi(ngay, 6, 30);
    const id = await nopDonLop("CLASS_OFF", ngay);

    const r = await duyet(id);
    expect(r).toMatchObject({ ok: true, applied: true });

    expect((await db.classSession.findUniqueOrThrow({ where: { id: buoi.id } })).status).toBe("CANCELLED");
    const don = await db.workRequest.findUniqueOrThrow({ where: { id }, select: { status: true, appliedAt: true, applyError: true } });
    expect(don.status).toBe("APPROVED");
    expect(don.appliedAt).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: id, action: "APPROVE_REQUEST" } });
    const moi = audit.newValues as { hieuQua: { sessionId: string; trangThai: { truoc: string; sau: string }; buoiBu: string } };
    expect(moi.hieuQua.sessionId).toBe(buoi.id);
    expect(moi.hieuQua.trangThai).toEqual({ truoc: "SCHEDULED", sau: "CANCELLED" });
    expect(moi.hieuQua.buoiBu).toBeTruthy();
  });

  it("[DT3-02] CẤY: audit hỏng SAU khi buổi đã huỷ ⇒ rollback CẢ CỤM — đơn PENDING + applyError, buổi nguyên, không buổi bù", async () => {
    const ngay = utc(2026, 10, 21);
    const buoi = await taoBuoi(ngay, 18);
    const id = await nopDonLop("CLASS_OFF", ngay);
    const soBuoiTruoc = await db.classSession.count({ where: { classId } });

    ctl.hongAuditDuyet = true;
    try {
      const r = await duyet(id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("audit hỏng (cấy)");
    } finally {
      ctl.hongAuditDuyet = false;
    }

    const don = await db.workRequest.findUniqueOrThrow({ where: { id }, select: { status: true, appliedAt: true, applyError: true, reviewedById: true } });
    expect(don.status).toBe("PENDING");
    expect(don.reviewedById).toBeNull();
    expect(don.appliedAt).toBeNull();
    expect(don.applyError).toContain("audit hỏng (cấy)");
    expect((await db.classSession.findUniqueOrThrow({ where: { id: buoi.id } })).status).toBe("SCHEDULED");
    expect(await db.classSession.count({ where: { classId } })).toBe(soBuoiTruoc);
    expect(await db.auditLog.count({ where: { entityType: "ClassSession", entityId: buoi.id } })).toBe(0);

    // Hết lỗi ⇒ duyệt lại được bình thường (không kẹt ở trạng thái nửa vời).
    expect((await duyet(id)).ok).toBe(true);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: buoi.id } })).status).toBe("CANCELLED");
  });

  it("[DT3-03] dạy thay thiếu người ⇒ không duyệt được, đơn giữ PENDING; có người ⇒ gán substituteTeacherId", async () => {
    const ngay = utc(2026, 10, 22);
    const buoi = await taoBuoi(ngay, 9);
    const thieu = await nopDonLop("SUB_TEACH", ngay);
    const r1 = await duyet(thieu);
    expect(r1).toEqual({ ok: false, error: "Đơn chưa chọn người dạy thay — gán thủ công." });
    expect((await db.workRequest.findUniqueOrThrow({ where: { id: thieu } })).status).toBe("PENDING");

    // Cổng "đơn trùng" chặn đơn cùng loại cùng ngày còn chờ ⇒ người nộp rút đơn thiếu người, nộp lại.
    expect((await requests.withdrawRequest({ requestId: thieu, requesterId: gv, requesterName: "GV", now: NOW_TEST })).ok).toBe(true);
    const du = await nopDonLop("SUB_TEACH", ngay, gvThay);
    const r2 = await duyet(du);
    expect(r2.ok).toBe(true);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: buoi.id } })).substituteTeacherId).toBe(gvThay);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: du, action: "APPROVE_REQUEST" } });
    expect((audit.newValues as { hieuQua: { gvDayThay: unknown } }).hieuQua.gvDayThay).toEqual({ truoc: null, sau: gvThay });
  });

  it("[DT3-04] từ chối: audit REJECT_REQUEST ghi TRONG giao dịch của decideRequest", async () => {
    const ngay = utc(2026, 10, 23);
    await taoBuoi(ngay, 9);
    const id = await nopDonLop("CLASS_OFF", ngay);
    const r = await requests.decideRequest({ now: NOW_TEST, requestId: id, decision: "REJECTED", note: "không duyệt", actor, canWriteCenter: () => true });
    expect(r.ok).toBe(true);
    expect(await db.auditLog.count({ where: { entityId: id, action: "REJECT_REQUEST" } })).toBe(1);
    expect((await db.workRequest.findUniqueOrThrow({ where: { id } })).status).toBe("REJECTED");
  });

  // ── Đợt 11: huỷ đơn lớp đã duyệt ─────────────────────────────────────────────────────────
  const huyDon = () => import("../../lib/cham-cong/huy-don");

  it("[DT3-05] dạy thay đã duyệt, buổi CHƯA diễn ra ⇒ duyệt huỷ trả buổi về giáo viên cũ; buổi ĐÃ QUA ⇒ từ chối", async () => {
    const huy = await huyDon();
    const ngay = utc(2026, 10, 24);
    const buoi = await taoBuoi(ngay, 9);
    const id = await nopDonLop("SUB_TEACH", ngay, gvThay);
    expect((await duyet(id)).ok).toBe(true);
    expect((await huy.yeuCauHuyDon({ requestId: id, requesterId: gv, requesterName: "GV", lyDo: "khỏi bệnh sớm", now: NOW_TEST })).ok).toBe(true);
    const r = await huy.quyetDinhHuy({ requestId: id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true, now: NOW_TEST });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notify.map((n) => n.userId)).toContain(gvThay); // người dạy thay được báo
    expect((await db.classSession.findUniqueOrThrow({ where: { id: buoi.id } })).substituteTeacherId).toBeNull();

    // Buổi đã qua so với "bây giờ" ⇒ dạy thay đã là sự thật.
    const ngay2 = utc(2026, 10, 27);
    await taoBuoi(ngay2, 9);
    const id2 = await nopDonLop("SUB_TEACH", ngay2, gvThay);
    expect((await duyet(id2)).ok).toBe(true);
    expect((await huy.yeuCauHuyDon({ requestId: id2, requesterId: gv, requesterName: "GV", lyDo: "khỏi bệnh sớm", now: NOW_TEST })).ok).toBe(true);
    const sauBuoi = new Date("2026-10-28T03:00:00Z");
    const r2 = await huy.quyetDinhHuy({ requestId: id2, decision: "APPROVED", note: null, actor, canWriteCenter: () => true, now: sauBuoi });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/đã qua/);
  });

  // ── Huỷ "Nghỉ buổi dạy" (đợt 11 bổ sung) — Case A–D của yêu cầu WORK-REQUEST-FINAL ─────────
  // Mỗi ca cách nhau 2 tháng: các ca dùng CHUNG một lớp, buổi bù rơi sau buổi muộn nhất của lớp — đặt
  // gần nhau là buổi bù ca trước trùng ngày ca sau và `buoiCuaDon` bắt nhầm buổi (luật 18).
  const nghiBuoiDaDuyet = async (ngay: Date) => {
    const goc = await taoBuoi(ngay, 9);
    const id = await nopDonLop("CLASS_OFF", ngay);
    expect((await duyet(id)).ok).toBe(true);
    const bu = await db.classSession.findFirstOrThrow({ where: { sourceWorkRequestId: id } });
    return { id, goc: goc.id, bu };
  };
  const xinHuyDon = async (id: string) =>
    (await huyDon()).yeuCauHuyDon({ requestId: id, requesterId: gv, requesterName: "GV", lyDo: "khỏi bệnh sớm", now: NOW_TEST });
  const duyetHuyDon = async (id: string) =>
    (await huyDon()).quyetDinhHuy({ requestId: id, decision: "APPROVED", note: null, actor, canWriteCenter: () => true, now: NOW_TEST });
  const trangThaiBuoi = async (id: string) => (await db.classSession.findUniqueOrThrow({ where: { id } })).status;

  it("[DT3-06] Case A — huỷ đơn nghỉ buổi dạy: buổi gốc SỐNG LẠI, buổi bù CỦA ĐƠN bị gỡ (không xoá cứng), đơn CANCELLED", async () => {
    const { id, goc, bu } = await nghiBuoiDaDuyet(utc(2027, 1, 12));
    expect(await trangThaiBuoi(goc)).toBe("CANCELLED");
    expect(bu.status).toBe("SCHEDULED");
    expect((await xinHuyDon(id)).ok).toBe(true);
    const r = await duyetHuyDon(id);
    expect(r.ok).toBe(true);
    expect(await trangThaiBuoi(goc)).toBe("SCHEDULED");
    expect(await trangThaiBuoi(bu.id)).toBe("CANCELLED");
    expect((await db.workRequest.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    expect(await db.auditLog.count({ where: { entityType: "ClassSession", entityId: goc, action: "RESTORE_SESSION" } })).toBe(1);
  });

  it("[DT3-07] Case B — buổi bù đã có điểm danh ⇒ chặn, KHÔNG đổi gì, đơn vẫn chờ duyệt huỷ", async () => {
    const { id, goc, bu } = await nghiBuoiDaDuyet(utc(2027, 3, 9));
    const hv = await db.student.create({ data: { name: `${TAG} học viên` }, select: { id: true } });
    await db.attendance.create({ data: { sessionId: bu.id, studentId: hv.id } });
    expect((await xinHuyDon(id)).ok).toBe(true);
    const r = await duyetHuyDon(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/buổi học bù đã phát sinh dữ liệu \(điểm danh\)/);
    expect(await trangThaiBuoi(goc)).toBe("CANCELLED");
    expect(await trangThaiBuoi(bu.id)).toBe("SCHEDULED");
    expect((await db.workRequest.findUniqueOrThrow({ where: { id } })).status).toBe("CANCEL_REQUESTED");
  });

  it("[DT3-08] Case C — buổi bù đã bị dời lịch sau khi duyệt ⇒ chặn do lệch phiên bản", async () => {
    const { id, goc, bu } = await nghiBuoiDaDuyet(utc(2027, 5, 11));
    await db.classSession.update({ where: { id: bu.id }, data: { date: new Date(bu.date.getTime() + 86_400_000) } });
    expect((await xinHuyDon(id)).ok).toBe(true);
    const r = await duyetHuyDon(id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/lịch học đã được thay đổi sau khi đơn được duyệt/);
    expect(await trangThaiBuoi(goc)).toBe("CANCELLED");
    expect(await trangThaiBuoi(bu.id)).toBe("SCHEDULED");
  });

  it("[DT3-09] Case D — duyệt huỷ hai lần / hai người CÙNG LÚC ⇒ đúng một lần khôi phục, một audit, không buổi thừa", async () => {
    const { id, goc, bu } = await nghiBuoiDaDuyet(utc(2027, 7, 13));
    expect((await xinHuyDon(id)).ok).toBe(true);
    const [a, b] = await Promise.all([duyetHuyDon(id), duyetHuyDon(id)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await duyetHuyDon(id)).ok).toBe(false); // thử lại sau đó
    expect(await trangThaiBuoi(goc)).toBe("SCHEDULED");
    expect(await trangThaiBuoi(bu.id)).toBe("CANCELLED");
    expect(await db.classSession.count({ where: { sourceWorkRequestId: id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: id, action: "APPROVE_CANCELLATION" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "ClassSession", entityId: goc, action: "RESTORE_SESSION" } })).toBe(1);
  });

  it("[DT3-10] đơn nghỉ buổi dạy duyệt TRƯỚC khi có ảnh chụp buổi bù ⇒ không nhận yêu cầu huỷ (ngoại lệ dữ liệu cũ)", async () => {
    const { id } = await nghiBuoiDaDuyet(utc(2027, 9, 14));
    // Giả lập đơn cũ: ảnh chụp chỉ có sessionId như bản trước đợt 11 bổ sung.
    await db.workRequest.update({ where: { id }, data: { appliedEffect: { sessionId: "x", trangThai: { truoc: "SCHEDULED", sau: "CANCELLED" } } } });
    const r = await xinHuyDon(id);
    expect(r.ok).toBe(false);
    expect((await db.workRequest.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
  });
});
