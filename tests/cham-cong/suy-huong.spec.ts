// tests/cham-cong/suy-huong.spec.ts — chấm công MỘT NÚT (06/10/2026): cầu DB `suyHuongHomNay`
// đọc đúng nguồn, và cổng bấm trùng của `recordTimeLog` bỏ qua lượt ĐÃ BỊ THAY THẾ.
//
// Vì sao cần Postgres thật: hai khẳng định quan trọng nhất ở đây là MỆNH ĐỀ `where`
// (`reviewStatus <> DISMISSED`, `result = ACCEPTED`). `where` sai vẫn trả một mảng hợp lệ, nên
// test thuần (`lib/cham-cong/suy-huong.test.ts`) không nói được gì về chúng.
//
// Ngày cố định (luật 19 — test không đọc đồng hồ thật): mọi lời gọi truyền `now`.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import { seedShiftTemplates } from "../../lib/cham-cong/seed-core";
import { vnDateAt, vnDateOnly } from "../../lib/time/vn";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
const TAG = "cc-suyhuong";

/** 06/10/2026 giờ VN. */
const luc = (h: number, m: number) => vnDateAt(2026, 9, 6, h, m);
const NGAY = vnDateOnly(luc(8, 0));

d("suyHuongHomNay + bấm trùng bỏ qua lượt đã thay thế", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let userId = "";
  let centerId = "";
  let templateId = "";
  let sh: typeof import("../../lib/cham-cong/suy-huong-db");
  let tl: typeof import("../../lib/cham-cong/timelog");

  const donDep = async () => {
    await db.staffAttendanceDay.deleteMany({ where: { userId } });
    await db.staffTimeLog.deleteMany({ where: { userId } });
    await db.shiftAssignment.deleteMany({ where: { userId } });
  };
  const xepCaHaiBuoi = () =>
    db.shiftAssignment.create({
      data: {
        userId, centerId, workDate: NGAY, templateId, templateCode: "ST",
        placeMode: "AT_UNITS", attendanceMode: "REQUIRED", soCapQuetKyVong: 2,
        segments: [
          { start: "07:30", end: "11:30", kind: "WORK" },
          { start: "13:30", end: "17:30", kind: "WORK" },
        ],
        status: "ACTIVE", source: "MANUAL",
      },
    });
  const ghiLuot = (gio: Date, direction: "CHECK_IN" | "CHECK_OUT", extra: { result?: "ACCEPTED" | "REJECTED"; reviewStatus?: "PENDING" | "DISMISSED" } = {}) =>
    db.staffTimeLog.create({
      data: { userId, centerId, direction, loggedAt: gio, workDate: NGAY, source: "TICKET", result: extra.result ?? "ACCEPTED", reviewStatus: extra.reviewStatus ?? "PENDING" },
    });

  beforeAll(async () => {
    sh = await import("../../lib/cham-cong/suy-huong-db");
    tl = await import("../../lib/cham-cong/timelog");
    await seedShiftTemplates(db);
    templateId = (await db.shiftTemplate.findFirstOrThrow({ where: { code: "ST" }, select: { id: true } })).id;
    const old = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = old.map((u) => u.id);
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    centerId = (await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS suy hướng", address: "x", code: `${TAG}-CS1` }, select: { id: true } })).id;
    userId = (await db.user.create({ data: { email: `nv@${TAG}.test`, name: "NV suy hướng", role: "SALES_CSM", roles: ["SALES_CSM"], password: "x", centerId }, select: { id: true } })).id;
  });
  beforeEach(donDep);
  afterAll(async () => {
    await donDep();
    await db.user.deleteMany({ where: { id: userId } });
    await db.center.deleteMany({ where: { slug: `${TAG}-cs1` } });
    await db.$disconnect();
  });

  it("[SHD-01] đọc ô ca: lượt đầu 07:25 là VÀO · buổi sáng", async () => {
    await xepCaHaiBuoi();
    const r = await sh.suyHuongHomNay({ userId, workLocationId: null, now: luc(7, 25) });
    expect(r).toMatchObject({ huong: "CHECK_IN", buoi: 1, nhanBuoi: "buổi sáng", trung: false });
  });

  it("[SHD-02] đọc lượt trong ngày: VÀO 07:25 rồi 11:32 ⇒ RA cùng buổi", async () => {
    await xepCaHaiBuoi();
    await ghiLuot(luc(7, 25), "CHECK_IN");
    const r = await sh.suyHuongHomNay({ userId, workLocationId: null, now: luc(11, 32) });
    expect(r).toMatchObject({ huong: "CHECK_OUT", lyDo: "RA_CUNG_BUOI" });
  });

  it("[SHD-03] lượt DISMISSED (đã bị thay thế) KHÔNG là lượt trước — đối chứng dương PENDING thì CÓ", async () => {
    await xepCaHaiBuoi();
    const l = await ghiLuot(luc(7, 25), "CHECK_IN");
    expect((await sh.suyHuongHomNay({ userId, workLocationId: null, now: luc(11, 32) })).lyDo).toBe("RA_CUNG_BUOI");
    await db.staffTimeLog.update({ where: { id: l.id }, data: { reviewStatus: "DISMISSED" } });
    // Không còn lượt nào ⇒ 11:32 là sau giờ hết buổi sáng, buổi chưa có lượt ⇒ "quên VÀO".
    expect((await sh.suyHuongHomNay({ userId, workLocationId: null, now: luc(11, 32) })).lyDo).toBe("RA_QUEN_VAO");
  });

  it("[SHD-04] lượt REJECTED không là lượt trước", async () => {
    await xepCaHaiBuoi();
    await ghiLuot(luc(7, 25), "CHECK_IN", { result: "REJECTED" });
    const r = await sh.suyHuongHomNay({ userId, workLocationId: null, now: luc(7, 26) });
    expect(r.trung).toBe(false);
  });

  it("[SHD-05] không có ca ⇒ xen kẽ, buổi null", async () => {
    await ghiLuot(luc(8, 0), "CHECK_IN");
    const r = await sh.suyHuongHomNay({ userId, workLocationId: null, now: luc(12, 0) });
    expect(r).toMatchObject({ huong: "CHECK_OUT", buoi: null, nhanBuoi: null, lyDo: "KHONG_CA" });
  });

  it("[SHD-06] recordTimeLog: TRUNG_2_PHUT bỏ qua lượt DISMISSED — đối chứng dương PENDING thì CÓ cờ", async () => {
    const l = await ghiLuot(luc(7, 25), "CHECK_IN");
    const a = await tl.recordTimeLog({ userId, workLocationId: null, direction: "CHECK_IN", source: "CONG_TAC", now: luc(7, 26) });
    expect(a.ok && a.flags).toContain("TRUNG_2_PHUT");
    await db.staffTimeLog.deleteMany({ where: { userId, NOT: { id: l.id } } });
    await db.staffTimeLog.update({ where: { id: l.id }, data: { reviewStatus: "DISMISSED" } });
    const b = await tl.recordTimeLog({ userId, workLocationId: null, direction: "CHECK_IN", source: "CONG_TAC", now: luc(7, 26) });
    expect(b.ok).toBe(true);
    expect(b.ok && b.flags).not.toContain("TRUNG_2_PHUT");
  });
});
