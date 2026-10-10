/**
 * [DTP] Duyệt "Dạy thay" / điều chỉnh buổi — chỉ CHẶN vì thứ thao tác làm đổi (DB thật, 09/10/2026).
 *
 * Sự cố prod 09/10/2026: QLCS duyệt đơn "Dạy thay" (Hoàng Trà My → Võ Bá Quốc Đạt, CN 11/10,
 * lớp `sata4.09h45-CN.CS1-1-1`) bị chặn "Trùng phòng". Đơn chỉ đổi GV; buổi đang mang phòng
 * riêng CS1-201 trùng SẴN với lớp `sata3.09h45-CN.CS1-201` (43 tuần, có từ trước). Bản cũ
 * (`lib/classes/adjust.ts:221`) kiểm phòng hiện tại của buổi vô điều kiện ⇒ trùng có sẵn thành cổng.
 *
 * Fixture mô phỏng đúng hình dạng đó: ngày 03/05/2099 (CN), mọi lớp 09:45–11:15 trừ lớp "kề"
 * 11:15–12:45. Ngày tuyệt đối năm 2099 — không đọc đồng hồ (luật 19).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { adjustSession } from "../../lib/classes/adjust";
import { decideRequest } from "../../lib/cham-cong/requests";
import { vnDateAt } from "../../lib/time/vn";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const db = new PrismaClient();
const P = "DTP_";
const NGUOI = { actorId: null, actorName: "QL test" };
/** 03/05/2099 là CHỦ NHẬT; `h:m` giờ VN. */
const luc = (ngay: number, h: number, m: number) => vnDateAt(2099, 4, ngay, h, m);

async function don() {
  const lop = await db.class.findMany({ where: { name: { startsWith: P } }, select: { id: true } });
  const ids = lop.map((l) => l.id);
  const users = await db.user.findMany({ where: { email: { startsWith: P.toLowerCase() } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  if (uids.length) await db.workRequest.deleteMany({ where: { requesterId: { in: uids } } });
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
  const center = await db.center.create({ data: { name: `${P}CS1`, slug: `${P.toLowerCase()}cs-${tag}`, address: "x" } });
  const course = await db.course.create({ data: { name: `${P}K`, slug: `${P.toLowerCase()}k-${tag}` } });
  const phong = async (code: string) =>
    db.room.create({ data: { name: code, code: `${code}-${tag}`, centerId: center.id } });
  const [r201, r202, r203, r204, r205, r206, r207] = await Promise.all(
    ["R201", "R202", "R203", "R204", "R205", "R206", "R207"].map(phong),
  );
  const gv = async (ten: string) =>
    db.user.create({ data: { email: `${P.toLowerCase()}${ten.toLowerCase()}-${tag}@x.test`, name: ten, role: "TEACHER" } });
  const [gvA, gvB, gvDat, gvBan, gvKe, gvHuy, gvXoa, gvMoi] = await Promise.all(
    ["GvA", "GvB", "GvDat", "GvBan", "GvKe", "GvHuy", "GvXoa", "GvMoi"].map(gv),
  );

  const lop = async (
    ten: string,
    o: { roomId: string; teacherId: string; gio?: [string, string]; ngay?: number; buoiRoomId?: string | null; huy?: boolean; xoa?: boolean },
  ) => {
    const [bd, kt] = o.gio ?? ["09:45", "11:15"];
    const cls = await db.class.create({
      data: {
        name: `${P}${ten}`,
        courseId: course.id,
        centerId: center.id,
        roomId: o.roomId,
        teacherId: o.teacherId,
        startTime: bd,
        endTime: kt,
        ...(o.xoa ? { deletedAt: luc(1, 0, 0) } : {}),
      },
    });
    const [h, m] = bd.split(":").map(Number) as [number, number];
    const buoi = await db.classSession.create({
      data: {
        classId: cls.id,
        centerId: center.id,
        date: luc(o.ngay ?? 3, h, m),
        roomId: o.buoiRoomId === undefined ? o.roomId : o.buoiRoomId,
        ...(o.huy ? { status: "CANCELLED" as const } : {}),
      },
    });
    return { cls, buoi };
  };

  // Lớp đang xét: phòng LỚP là R202 nhưng BUỔI mang phòng riêng R201 (đúng hình dạng prod).
  const a = await lop("sata4-CS1-1-1", { roomId: r202.id, teacherId: gvA.id, buoiRoomId: r201.id });
  // Trùng phòng CÓ SẴN: lớp khác ở R201 cùng giờ.
  const b = await lop("sata3-CS1-201", { roomId: r201.id, teacherId: gvB.id });
  // GV bận + phòng bận: lớp C ở R203, GV gvBan, cùng giờ.
  const c = await lop("lop-C", { roomId: r203.id, teacherId: gvBan.id });
  // Ca LIỀN KỀ 11:15–12:45 ở R204, GV gvKe.
  const k = await lop("lop-ke", { roomId: r204.id, teacherId: gvKe.id, gio: ["11:15", "12:45"] });
  // Buổi ĐÃ HUỶ (R205, gvHuy) và lớp ĐÃ XOÁ MỀM (R206, gvXoa) — cùng giờ, không được tính.
  await lop("lop-huy", { roomId: r205.id, teacherId: gvHuy.id, huy: true });
  await lop("lop-xoa", { roomId: r206.id, teacherId: gvXoa.id, xoa: true });
  // Ngày 10/05: R207 có lớp khác 09:45 — dời buổi A sang đó với phòng R207 là trùng do ĐỔI GIỜ.
  const h = await lop("lop-ngay-10", { roomId: r207.id, teacherId: gvMoi.id, ngay: 10 });

  return { center, a, b, c, k, h, phong: { r201, r202, r203, r204, r205, r206, r207 }, gv: { gvA, gvDat, gvBan, gvKe, gvHuy, gvXoa } };
}

const doc = (id: string) =>
  db.classSession.findUniqueOrThrow({ where: { id }, select: { date: true, roomId: true, substituteTeacherId: true } });

describe.skipIf(!RUN_DB_TESTS)("[DTP] dạy thay / điều chỉnh buổi — chặn đúng thứ thao tác làm đổi (DB thật)", () => {
  beforeEach(don, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  it("[DTP-01] buổi nằm sẵn trong trùng phòng cũ, đổi GV sang người rảnh ⇒ QUA, chỉ GV đổi, kèm cảnh báo", async () => {
    const x = await dung();
    const r = await adjustSession({ sessionId: x.a.buoi.id, teacherId: x.gv.gvDat.id, ...NGUOI });
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    // Trùng có sẵn KHÔNG mất dấu — người duyệt được báo, kèm tên lớp đang chiếm phòng.
    expect(r.canhBao).toContain("phòng đang trùng với lớp DTP_sata3-CS1-201");
    const sau = await doc(x.a.buoi.id);
    expect(sau.substituteTeacherId).toBe(x.gv.gvDat.id);
    expect(sau.roomId).toBe(x.phong.r201.id); // phòng KHÔNG đổi
    expect(sau.date.getTime()).toBe(x.a.buoi.date.getTime()); // giờ KHÔNG đổi
  }, 60_000);

  it("[DTP-02] GV dạy thay đang dạy lớp khác cùng giờ ⇒ CHẶN, nêu tên lớp, không ghi gì", async () => {
    const x = await dung();
    const r = await adjustSession({ sessionId: x.a.buoi.id, teacherId: x.gv.gvBan.id, ...NGUOI });
    expect(r.ok).toBe(false);
    // T09: câu báo nay do lõi đa nguồn dựng — nêu TÀI NGUYÊN (GV) + TÊN lớp đang chiếm + khung giờ; luật "chặn vì thứ thao tác đổi" là thứ ca này canh.
    expect(r.error).toMatch(/^Trùng lịch — GV .* đang có lớp DTP_lop-C từ /);
    expect((await doc(x.a.buoi.id)).substituteTeacherId).toBeNull();
  }, 60_000);

  it("[DTP-03] đổi THẬT sang phòng đang bận ⇒ CHẶN trùng phòng; đổi sang phòng trống ⇒ QUA", async () => {
    const x = await dung();
    const r = await adjustSession({ sessionId: x.a.buoi.id, roomId: x.phong.r203.id, ...NGUOI });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Trùng lịch — Phòng .* đang được dùng bởi lớp DTP_lop-C từ /);
    expect((await doc(x.a.buoi.id)).roomId).toBe(x.phong.r201.id);

    // Đối chứng dương: chuyển sang R202 (phòng của lớp, đang trống) — gỡ được trùng cũ.
    const ok = await adjustSession({ sessionId: x.a.buoi.id, roomId: x.phong.r202.id, ...NGUOI });
    expect(ok).toEqual({ ok: true });
    expect((await doc(x.a.buoi.id)).roomId).toBe(x.phong.r202.id);
  }, 60_000);

  it("[DTP-04] đổi GIỜ (dời ngày) làm phòng chồng lên lớp khác ⇒ CHẶN", async () => {
    const x = await dung();
    // Đưa buổi về R207 (trống ngày 03/05) trước — thao tác chỉ đổi phòng, qua.
    expect((await adjustSession({ sessionId: x.a.buoi.id, roomId: x.phong.r207.id, ...NGUOI })).ok).toBe(true);
    // Dời sang 10/05: R207 có lớp khác 09:45 ⇒ trùng do ĐỔI GIỜ, phòng không đổi vẫn phải chặn.
    const r = await adjustSession({ sessionId: x.a.buoi.id, date: luc(10, 9, 45), ...NGUOI });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Trùng lịch — Phòng .* đang được dùng bởi lớp DTP_lop-ngay-10 từ /);
    expect((await doc(x.a.buoi.id)).date.getTime()).toBe(x.a.buoi.date.getTime());
  }, 60_000);

  it("[DTP-05] ca LIỀN KỀ (09:45–11:15 và 11:15–12:45) ⇒ KHÔNG trùng, cả GV lẫn phòng", async () => {
    const x = await dung();
    expect(await adjustSession({ sessionId: x.a.buoi.id, roomId: x.phong.r204.id, ...NGUOI })).toEqual({ ok: true });
    expect(await adjustSession({ sessionId: x.a.buoi.id, teacherId: x.gv.gvKe.id, ...NGUOI })).toEqual({ ok: true });
  }, 60_000);

  it("[DTP-06] buổi ĐÃ HUỶ và lớp ĐÃ XOÁ MỀM ⇒ không tạo trùng (phòng lẫn GV)", async () => {
    const x = await dung();
    for (const thaoTac of [
      { roomId: x.phong.r205.id },
      { roomId: x.phong.r206.id },
      { teacherId: x.gv.gvHuy.id },
      { teacherId: x.gv.gvXoa.id },
    ]) {
      const r = await adjustSession({ sessionId: x.a.buoi.id, ...thaoTac, ...NGUOI });
      expect(r.error, JSON.stringify(thaoTac)).toBeUndefined();
    }
  }, 60_000);

  it("[DTP-07] tự đổi GV về chính GV hiện tại ⇒ không tự trùng với chính buổi mình", async () => {
    const x = await dung();
    // Buổi của chính lớp và chính buổi đều bị loại; trùng phòng cũ chỉ còn là cảnh báo.
    const r = await adjustSession({ sessionId: x.a.buoi.id, teacherId: x.gv.gvA.id, ...NGUOI });
    expect(r.ok).toBe(true);
  }, 60_000);

  it("[DTP-08] đơn Dạy thay từng kẹt applyError 'Trùng phòng' ⇒ duyệt lại được, buổi đổi GV", async () => {
    const x = await dung();
    const ql = await db.user.create({ data: { email: `${P.toLowerCase()}ql-${Date.now()}@x.test`, name: "QL", role: "CENTER_MANAGER" } });
    const gvNop = await db.user.findFirstOrThrow({ where: { id: x.gv.gvA.id } });
    const don = await db.workRequest.create({
      data: {
        requesterId: gvNop.id,
        centerId: x.center.id,
        kind: "SUB_TEACH",
        fromDate: new Date(Date.UTC(2099, 4, 3)),
        classId: x.a.cls.id,
        className: x.a.cls.name,
        targetUserId: x.gv.gvDat.id,
        reason: "Việc gia đình",
        applyError: "Trùng phòng: phòng đã được lớp khác sử dụng vào khung giờ này.",
      },
    });
    const kq = await decideRequest({
      now: luc(1, 8, 0),
      requestId: don.id,
      decision: "APPROVED",
      note: null,
      actor: { id: ql.id, name: ql.name ?? "QL" },
      canWriteCenter: (c) => c === x.center.id,
    });
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    // Trùng phòng có sẵn KHÔNG còn chặn, nhưng người duyệt phải đọc được nó.
    expect(kq.ok && kq.message).toContain("phòng đang trùng với lớp DTP_sata3-CS1-201");
    const sau = await db.workRequest.findUniqueOrThrow({ where: { id: don.id } });
    expect(sau.status).toBe("APPROVED");
    expect(sau.applyError).toBeNull();
    expect(sau.appliedAt).not.toBeNull();
    expect((await doc(x.a.buoi.id)).substituteTeacherId).toBe(x.gv.gvDat.id);
  }, 60_000);
});
