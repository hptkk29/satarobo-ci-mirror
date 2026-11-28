/**
 * [MLBDB] "Mở lại buổi" đã huỷ — DB thật (11/10/2026).
 *
 * Tái hiện ca prod 11/10/2026: lớp `sata3.15h45-CN.CS2-P302`, đơn nghỉ của GV chính được duyệt ⇒ `cancelSession` huỷ buổi
 * và nối buổi bù cuối lịch. QLCS muốn buổi VẪN học, cô khác dạy thay. Ngày tuyệt đối năm 2099 + `now` truyền vào (luật 19).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { cancelSession } from "../../lib/classes/adjust";
import { moLaiBuoi } from "../../lib/classes/mo-lai-buoi";
import { vnDateAt } from "../../lib/time/vn";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const db = new PrismaClient();
const P = "MLBDB_";
const NGUOI = { actorId: null, actorName: "QLCS test" };
/** 03/05/2099 là CHỦ NHẬT; `h:m` giờ VN. */
const luc = (ngay: number, h: number, m: number) => vnDateAt(2099, 4, ngay, h, m);
/** "Bây giờ" của ca test: sáng 03/05/2099 — buổi 15:45 cùng ngày còn ở phía trước. */
const NOW = luc(3, 11, 29);

async function don() {
  const lop = await db.class.findMany({ where: { name: { startsWith: P } }, select: { id: true } });
  const ids = lop.map((l) => l.id);
  const users = await db.user.findMany({ where: { email: { startsWith: P.toLowerCase() } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  const hv = await db.student.findMany({ where: { name: { startsWith: P } }, select: { id: true } });
  if (hv.length) {
    await db.attendance.deleteMany({ where: { studentId: { in: hv.map((h) => h.id) } } });
    await db.student.deleteMany({ where: { id: { in: hv.map((h) => h.id) } } });
  }
  if (ids.length) {
    const buoi = await db.classSession.findMany({ where: { classId: { in: ids } }, select: { id: true } });
    const bids = buoi.map((b) => b.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: bids } } });
    for (const id of bids) {
      await db.domainEvent.deleteMany({ where: { payloadJson: { path: ["sessionId"], equals: id } } });
    }
    await db.classSession.deleteMany({ where: { classId: { in: ids } } });
    await db.class.deleteMany({ where: { id: { in: ids } } });
  }
  if (uids.length) await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.course.deleteMany({ where: { slug: { startsWith: P.toLowerCase() } } });
  await db.center.deleteMany({ where: { slug: { startsWith: P.toLowerCase() } } });
}

async function dung() {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const center = await db.center.create({ data: { name: `${P}CS2`, slug: `${P.toLowerCase()}cs-${tag}`, address: "x" } });
  const course = await db.course.create({ data: { name: `${P}K`, slug: `${P.toLowerCase()}k-${tag}` } });
  const room = await db.room.create({ data: { name: "P302", code: `P302-${tag}`, centerId: center.id } });
  const gv = (ten: string) =>
    db.user.create({ data: { email: `${P.toLowerCase()}${ten.toLowerCase()}-${tag}@x.test`, name: ten, role: "TEACHER" } });
  const [gvChinh, gvThay, gvBan] = await Promise.all([gv("Chinh"), gv("Thay"), gv("Ban")]);
  const cls = await db.class.create({
    data: {
      name: `${P}sata3-15h45-CN`,
      courseId: course.id,
      centerId: center.id,
      roomId: room.id,
      teacherId: gvChinh.id,
      startTime: "15:45",
      endTime: "17:15",
    },
  });
  // Buổi hôm nay (03/05) và các buổi sau mỗi tuần (10/05, 17/05).
  const mk = (ngay: number) =>
    db.classSession.create({ data: { classId: cls.id, centerId: center.id, roomId: room.id, date: luc(ngay, 15, 45) } });
  const [homNay, tuanSau, tuan2] = [await mk(3), await mk(10), await mk(17)];
  // Lớp khác của gvBan cùng giờ hôm nay — để thử trùng lịch GV.
  const lopBan = await db.class.create({
    data: {
      name: `${P}lop-ban`,
      courseId: course.id,
      centerId: center.id,
      teacherId: gvBan.id,
      startTime: "15:45",
      endTime: "17:15",
    },
  });
  await db.classSession.create({ data: { classId: lopBan.id, centerId: center.id, date: luc(3, 15, 45) } });
  return { center, cls, homNay, tuanSau, tuan2, gv: { gvChinh, gvThay, gvBan } };
}

const doc = (id: string) =>
  db.classSession.findUniqueOrThrow({ where: { id }, select: { status: true, date: true, substituteTeacherId: true } });

describe.skipIf(!RUN_DB_TESTS)("[MLBDB] mở lại buổi đã huỷ (DB thật)", () => {
  beforeEach(don, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  it("[MLBDB-01] huỷ (sinh buổi bù) → mở lại + GV thay: buổi gốc SCHEDULED, bù CANCELLED, GV thay gán, có audit + sự kiện", async () => {
    const x = await dung();
    const huy = await cancelSession({ dongBoPhanCong: true, sessionId: x.homNay.id, reason: "GV nghỉ ốm", ...NGUOI });
    expect(huy.ok).toBe(true);
    const buId = huy.makeupSessionId!;
    expect((await doc(x.homNay.id)).status).toBe("CANCELLED");
    expect((await doc(buId)).status).toBe("SCHEDULED");

    const r = await moLaiBuoi({ sessionId: x.homNay.id, teacherId: x.gv.gvThay.id, ...NGUOI, now: NOW });
    expect(r).toMatchObject({ ok: true, makeupSessionId: buId, daGoBuoiBu: true });

    const goc = await doc(x.homNay.id);
    expect(goc.status).toBe("SCHEDULED");
    expect(goc.substituteTeacherId).toBe(x.gv.gvThay.id);
    expect((await doc(buId)).status).toBe("CANCELLED"); // gỡ, không xoá

    const audit = await db.auditLog.findMany({ where: { entityId: x.homNay.id, action: "RESTORE_SESSION" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.newValues).toMatchObject({ status: "SCHEDULED", makeupStatus: "CANCELLED", substituteTeacherId: x.gv.gvThay.id });
    const ev = await db.domainEvent.findMany({
      where: { type: "class.session_changed", payloadJson: { path: ["sessionId"], equals: x.homNay.id } },
    });
    expect(ev.some((e) => (e.payloadJson as { change?: string }).change === "RESTORED")).toBe(true);
  }, 60_000);

  it("[MLBDB-02] không chọn GV ⇒ chỉ mở lại + gỡ buổi bù, không đụng người dạy", async () => {
    const x = await dung();
    const huy = await cancelSession({ dongBoPhanCong: true, sessionId: x.homNay.id, reason: "GV nghỉ ốm", ...NGUOI });
    const r = await moLaiBuoi({ sessionId: x.homNay.id, ...NGUOI, now: NOW });
    expect(r.ok).toBe(true);
    expect((await doc(x.homNay.id)).substituteTeacherId).toBeNull();
    expect((await doc(huy.makeupSessionId!)).status).toBe("CANCELLED");
  }, 60_000);

  it("[MLBDB-03] buổi bù đã có điểm danh ⇒ TỪ CHỐI và không ghi gì (buổi gốc vẫn CANCELLED)", async () => {
    const x = await dung();
    const huy = await cancelSession({ dongBoPhanCong: true, sessionId: x.homNay.id, reason: "GV nghỉ ốm", ...NGUOI });
    const hv = await db.student.create({ data: { name: `${P}HV`, centerId: x.center.id } });
    await db.attendance.create({ data: { sessionId: huy.makeupSessionId!, studentId: hv.id, status: "PRESENT", centerId: x.center.id } });
    const r = await moLaiBuoi({ sessionId: x.homNay.id, teacherId: x.gv.gvThay.id, ...NGUOI, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/điểm danh/);
    const goc = await doc(x.homNay.id);
    expect(goc.status).toBe("CANCELLED");
    expect(goc.substituteTeacherId).toBeNull();
    expect((await doc(huy.makeupSessionId!)).status).toBe("SCHEDULED");
    await db.attendance.deleteMany({ where: { studentId: hv.id } });
    await db.student.delete({ where: { id: hv.id } });
  }, 60_000);

  it("[MLBDB-04] GV thay trùng lịch lớp khác ⇒ TỪ CHỐI VÀ ROLLBACK cả cụm (buổi gốc + buổi bù về như cũ)", async () => {
    const x = await dung();
    const huy = await cancelSession({ dongBoPhanCong: true, sessionId: x.homNay.id, reason: "GV nghỉ ốm", ...NGUOI });
    const r = await moLaiBuoi({ sessionId: x.homNay.id, teacherId: x.gv.gvBan.id, ...NGUOI, now: NOW });
    expect(r.ok).toBe(false);
    expect((await doc(x.homNay.id)).status).toBe("CANCELLED");
    expect((await doc(huy.makeupSessionId!)).status).toBe("SCHEDULED");
    expect(await db.auditLog.count({ where: { entityId: x.homNay.id, action: "RESTORE_SESSION" } })).toBe(0);
  }, 60_000);

  it("[MLBDB-05] buổi ĐÃ QUA ngày ⇒ từ chối; buổi chưa huỷ ⇒ từ chối", async () => {
    const x = await dung();
    const huy = await cancelSession({ dongBoPhanCong: true, sessionId: x.homNay.id, reason: "GV nghỉ ốm", ...NGUOI });
    const quaNgay = await moLaiBuoi({ sessionId: x.homNay.id, ...NGUOI, now: luc(4, 8, 0) });
    expect(quaNgay.ok).toBe(false);
    const chuaHuy = await moLaiBuoi({ sessionId: x.tuanSau.id, ...NGUOI, now: NOW });
    expect(chuaHuy.ok).toBe(false);
    expect((await doc(huy.makeupSessionId!)).status).toBe("SCHEDULED");
  }, 60_000);

  it("[MLBDB-06] lớp đã xếp buổi KHÁC đúng giờ đó sau khi huỷ ⇒ từ chối (không hai buổi sống cùng giờ)", async () => {
    const x = await dung();
    await cancelSession({ dongBoPhanCong: true, sessionId: x.homNay.id, reason: "GV nghỉ ốm", ...NGUOI });
    await db.classSession.create({ data: { classId: x.cls.id, centerId: x.center.id, date: luc(3, 15, 45) } });
    const r = await moLaiBuoi({ sessionId: x.homNay.id, ...NGUOI, now: NOW });
    expect(r.ok).toBe(false);
    expect((await doc(x.homNay.id)).status).toBe("CANCELLED");
  }, 60_000);

  it("[MLBDB-07] buổi huỷ bằng 'Nghỉ & lùi lịch' (topic 'Lớp nghỉ — …') ⇒ từ chối", async () => {
    const x = await dung();
    await db.classSession.update({ where: { id: x.homNay.id }, data: { status: "CANCELLED", topic: "Lớp nghỉ — sự kiện" } });
    const r = await moLaiBuoi({ sessionId: x.homNay.id, ...NGUOI, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Nghỉ & lùi lịch/);
    expect((await doc(x.homNay.id)).status).toBe("CANCELLED");
  }, 60_000);
});
