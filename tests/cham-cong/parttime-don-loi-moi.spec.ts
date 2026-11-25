// [DLMP-DB-*] dọn lời mời cũ 20/10/2026 — Postgres THẬT, qua ĐÚNG hàm mà `scripts/parttime-don-loi-moi.ts` gọi.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-don-loi-moi] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "donlm";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const HOM_NAY = "2026-10-20";

d("[DLMP-DB] dọn lời mời cũ — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dd: typeof import("../../lib/parttime/don-loi-moi-db");
  let pl: typeof import("../../lib/parttime/don-loi-moi");
  let csA = "";
  let csB = "";
  let gv = "";
  const pc: Record<string, string> = {};

  async function cleanup() {
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: pcIds } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  async function loiMoi(ten: string, p: { ngay: string; co?: "A" | "B"; trangThaiBuoi?: "SCHEDULED" | "CANCELLED"; status?: "WAITING_ACCEPTANCE" | "ACCEPTED" }) {
    const centerId = p.co === "B" ? csB : csA;
    const khoa = await db.course.upsert({ where: { slug: `${TAG}-k` }, update: {}, create: { name: "Sata 4 donlm", slug: `${TAG}-k` }, select: { id: true } });
    const l = await db.class.create({ data: { name: `${TAG} ${ten}`, classCode: `${TAG}-${ten}`, courseId: khoa.id, centerId, teacherId: gv, startTime: "18:00", endTime: "19:30", status: "ACTIVE" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: l.id, centerId, status: p.trangThaiBuoi ?? "SCHEDULED", date: vn(p.ngay, "18:00") }, select: { id: true } });
    const a = await db.sessionStaffAssignment.create({
      data: { sourceType: "CLASS_SESSION", sourceId: s.id, centerId, ngay: new Date(`${p.ngay}T00:00:00Z`), gioBatDau: "18:00", gioKetThuc: "19:30", userId: gv, role: "MAIN_TEACHER", activityType: "REGULAR_CLASS", assignmentType: "SYSTEM", nguonGiao: "DONG_BO", status: p.status ?? "WAITING_ACCEPTANCE" },
      select: { id: true },
    });
    pc[ten] = a.id;
  }

  beforeAll(async () => {
    dd = await import("../../lib/parttime/don-loi-moi-db");
    pl = await import("../../lib/parttime/don-loi-moi");
    for (const k of ["a", "b"]) {
      const c = await db.center.upsert({ where: { slug: `${TAG}-${k}` }, update: {}, create: { slug: `${TAG}-${k}`, name: `CS ${k}`, address: "x", code: `${TAG.toUpperCase()}-${k.toUpperCase()}` }, select: { id: true } });
      if (k === "a") csA = c.id;
      else csB = c.id;
    }
    await cleanup();
    gv = (await db.user.create({ data: { email: `gv@${TAG}.test`, name: "gv donlm", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: csA }, select: { id: true } })).id;
    await loiMoi("QUA", { ngay: "2026-10-17" });
    await loiMoi("NAY", { ngay: HOM_NAY });
    await loiMoi("SAU", { ngay: "2026-10-25" });
    await loiMoi("SAU_HUY", { ngay: "2026-10-26", trangThaiBuoi: "CANCELLED" });
    await loiMoi("DA_NHAN", { ngay: "2026-10-27", status: "ACCEPTED" });
    await loiMoi("CO_SO_B", { ngay: "2026-10-17", co: "B" });
  });

  afterAll(async () => {
    await cleanup();
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  it("[DLMP-DB-01] chỉ đọc lời mời CÒN CHỜ của đúng cơ sở; áp: quá khứ + buổi huỷ ⇒ CANCELLED, tương lai ⇒ ACCEPTED, mỗi dòng một audit, 0 xác nhận; chạy lại không đổi gì", async () => {
    const ds = await dd.docLoiMoiCu([csA]);
    expect(ds.map((x) => x.id).sort()).toEqual([pc.QUA, pc.NAY, pc.SAU, pc.SAU_HUY].sort());
    const buoc = pl.keHoachDonLoiMoi(ds, HOM_NAY);
    const xnTruoc = await db.staffAssignmentAcceptance.count();
    const kq = await db.$transaction((tx) => dd.apDungDon(tx, buoc, { id: null, name: "Lệnh dọn test" }));
    expect(kq).toEqual({ huy: 2, ganThang: 2, boQua: 0 });
    const tt = async (k: string) => (await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: pc[k]! } })).status;
    expect([await tt("QUA"), await tt("NAY"), await tt("SAU"), await tt("SAU_HUY"), await tt("DA_NHAN"), await tt("CO_SO_B")]).toEqual(["CANCELLED", "ACCEPTED", "ACCEPTED", "CANCELLED", "ACCEPTED", "WAITING_ACCEPTANCE"]);
    const au = await db.auditLog.findMany({ where: { entityId: { in: [pc.QUA!, pc.NAY!, pc.SAU!, pc.SAU_HUY!] } }, select: { entityId: true, action: true } });
    expect(au).toHaveLength(4);
    expect(au.find((a) => a.entityId === pc.NAY)?.action).toBe("PT_INVITE_CONVERTED_TO_ASSIGNED");
    expect(au.find((a) => a.entityId === pc.QUA)?.action).toBe("PT_ASSIGNMENT_CANCELLED");
    expect(await db.staffAssignmentAcceptance.count()).toBe(xnTruoc);
    const lai = await db.$transaction((tx) => dd.apDungDon(tx, buoc, { id: null, name: "Lệnh dọn test" }));
    expect(lai).toEqual({ huy: 0, ganThang: 0, boQua: 4 });
    expect(await dd.docLoiMoiCu([csA])).toEqual([]);
  });
});
