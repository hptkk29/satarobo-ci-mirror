// [SBQ-DB-*] "Sửa buổi đã qua" (chủ dự án 20/10/2026) — Postgres THẬT, qua ĐÚNG hàm action gọi (`suaBuoiDaQua`) + hai hàm đọc nhật
// ký (QLCS trên dòng buổi · giáo viên ở Công tháng). Thuần: lib/parttime/sua-buoi-da-qua.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-sua-buoi-da-qua] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "suaqua";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const HOM_NAY = "2026-11-20";
const LY_DO = "Cô B dạy thay thầy A ốm, đã đối chiếu điểm danh";

d("[SBQ-DB] sửa buổi đã qua — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let sv: typeof import("../../lib/parttime/sua-buoi-da-qua-db");
  let pcdb: typeof import("../../lib/parttime/phan-cong-db");
  let cs = "";
  const u: Record<"A" | "B" | "C", string> = { A: "", B: "", C: "" };
  const buoi: Record<string, string> = {};
  const actor = { id: null as string | null, name: "QLCS suaqua" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({ where: { code: "LEGACY" }, update: {}, create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } } });
    await db.compensationPolicyVersion.upsert({ where: { code: "SR.QD.238" }, update: {}, create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) } });
  }

  async function cleanup() {
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((x) => x.id);
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const ss = (await db.classSession.findMany({ where: { classId: { in: cls.map((c) => c.id) } }, select: { id: true } })).map((s) => s.id);
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { sourceId: { in: ss } }, select: { id: true } })).map((p) => p.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: [...pcIds, ...ss] } } });
    await db.sessionStaffAssignment.deleteMany({ where: { sourceId: { in: ss } } });
    await db.classSession.deleteMany({ where: { id: { in: ss } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.attendancePeriod.deleteMany({ where: { centerId: cs } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  /** Buổi lớp + (tuỳ chọn) phân công MAIN của A, đã gán. */
  async function taoBuoi(ten: string, p: { ngay: string; status?: "SCHEDULED" | "COMPLETED"; actual?: string | null; main?: boolean }) {
    const khoa = await db.course.upsert({ where: { slug: `${TAG}-k` }, update: {}, create: { name: "Sata 4 suaqua", slug: `${TAG}-k` }, select: { id: true } });
    const l = await db.class.create({ data: { name: `${TAG} ${ten}`, classCode: `${TAG}-${ten}`, courseId: khoa.id, centerId: cs, teacherId: u.A, startTime: "18:00", endTime: "19:30", status: "ACTIVE" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: l.id, centerId: cs, status: p.status ?? "SCHEDULED", date: vn(p.ngay, "18:00"), actualTeacherId: p.actual ?? null }, select: { id: true } });
    buoi[ten] = s.id;
    if (p.main !== false) {
      await db.sessionStaffAssignment.create({
        data: { sourceType: "CLASS_SESSION", sourceId: s.id, centerId: cs, ngay: new Date(`${p.ngay}T00:00:00Z`), gioBatDau: "18:00", gioKetThuc: "19:30", userId: u.A, role: "MAIN_TEACHER", activityType: "REGULAR_CLASS", assignmentType: "SYSTEM", status: "ACCEPTED" },
      });
    }
    return s.id;
  }
  const nguon = (ten: string) => ({ sourceType: "CLASS_SESSION" as const, sourceId: buoi[ten]! });
  const sua = (ten: string, p: { main?: string | null; ta?: string | null; thucDay?: string | null; lyDo?: string; homNay?: string }) =>
    db.$transaction((tx) => sv.suaBuoiDaQua(tx, { nguon: nguon(ten), actor, lyDo: p.lyDo ?? LY_DO, homNay: p.homNay ?? HOM_NAY, main: p.main, ta: p.ta, thucDay: p.thucDay }));
  const demGhi = async () => ({ pc: await db.sessionStaffAssignment.count(), au: await db.auditLog.count({ where: { action: "PT_PAST_SESSION_EDITED" } }) });

  beforeAll(async () => {
    await damBaoChinhSach();
    sv = await import("../../lib/parttime/sua-buoi-da-qua-db");
    pcdb = await import("../../lib/parttime/phan-cong-db");
    const c = await db.center.upsert({ where: { slug: `${TAG}-a` }, update: {}, create: { slug: `${TAG}-a`, name: "CS suaqua", address: "x", code: "SUAQUA-A" }, select: { id: true } });
    await db.orgUnit.upsert({ where: { code: `${TAG}-a` }, update: {}, create: { type: "CENTER", code: `${TAG}-a`, name: "ĐV suaqua", path: `/${TAG}-a/`, depth: 0, centerId: c.id } });
    cs = c.id;
    await cleanup();
    for (const k of ["A", "B", "C"] as const) {
      u[k] = (await db.user.create({ data: { email: `${k.toLowerCase()}@${TAG}.test`, name: `GV ${k}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
    }
    await taoBuoi("QUA_MO", { ngay: "2026-11-16" });
    await taoBuoi("DA_CHOT", { ngay: "2026-11-17", status: "COMPLETED", actual: null });
    await taoBuoi("TUONG_LAI", { ngay: "2026-11-25" });
    await taoBuoi("CU", { ngay: "2026-10-10", main: false });
    await taoBuoi("KY_CHOT", { ngay: "2026-10-28", status: "COMPLETED", main: false });
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  it("[SBQ-DB-01] buổi đã qua còn mở: đổi GV chính A→B ⇒ A REPLACED, B MANUAL·ACCEPTED (gán thẳng), một dòng nhật ký có lý do + người liên quan, chuông cho cả A và B", async () => {
    const r = await sua("QUA_MO", { main: u.B });
    expect(r).toMatchObject({ ok: true, soThayDoi: 1 });
    if (!r.ok) return;
    const pcs = await db.sessionStaffAssignment.findMany({ where: { sourceId: buoi.QUA_MO }, orderBy: { createdAt: "asc" } });
    expect(pcs.map((x) => [x.userId, x.status, x.assignmentType])).toEqual([[u.A, "REPLACED", "SYSTEM"], [u.B, "ACCEPTED", "MANUAL"]]);
    expect(pcs[1]!.replacesAssignmentId).toBe(pcs[0]!.id);
    const au = await db.auditLog.findMany({ where: { entityType: "ParttimeBuoiDaQua", entityId: buoi.QUA_MO } });
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ action: "PT_PAST_SESSION_EDITED", reason: LY_DO, actorName: "QLCS suaqua" });
    expect((au[0]!.newValues as { nguoiLienQuan: string[] }).nguoiLienQuan).toEqual([u.A, u.B]);
    expect(r.thongBao.map((t) => t.userId).sort()).toEqual([u.A, u.B].sort());
    expect(r.thongBao[0]!.body).toContain(LY_DO);
  });

  it("[SBQ-DB-02] nhật ký đọc được ở HAI nơi: theo buổi (QLCS) và theo người liên quan (cả người cũ lẫn người mới); người ngoài không thấy", async () => {
    const theoBuoi = await sv.docNhatKySuaTheoBuoi([buoi.QUA_MO!]);
    expect(theoBuoi.get(buoi.QUA_MO!)?.[0]).toMatchObject({ truong: "MAIN_TEACHER", tu: "GV A", den: "GV B", lyDo: LY_DO, ngay: "2026-11-16" });
    for (const k of ["A", "B"] as const) {
      const cuaToi = await sv.docNhatKySuaCuaToi({ userId: u[k], tu: "2026-11-01", den: "2026-11-30" });
      expect(cuaToi.map((x) => x.sourceId)).toEqual([buoi.QUA_MO]);
    }
    expect(await sv.docNhatKySuaCuaToi({ userId: u.C, tu: "2026-11-01", den: "2026-11-30" })).toEqual([]);
    expect(await sv.docNhatKySuaCuaToi({ userId: u.A, tu: "2026-12-01", den: "2026-12-31" })).toEqual([]);
  });

  it("[SBQ-DB-03] buổi ĐÃ CHỐT: sửa người thực dạy ⇒ ClassSession.actualTeacherId đổi (công dạy đọc trường này), thêm TA ⇒ TA ACCEPTED; hai dòng nhật ký", async () => {
    const r = await sua("DA_CHOT", { thucDay: u.B, ta: u.C });
    expect(r).toMatchObject({ ok: true, soThayDoi: 2 });
    expect((await db.classSession.findUniqueOrThrow({ where: { id: buoi.DA_CHOT! } })).actualTeacherId).toBe(u.B);
    const ta = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: buoi.DA_CHOT, role: "TEACHING_ASSISTANT" } });
    expect([ta.userId, ta.status, ta.assignmentType]).toEqual([u.C, "ACCEPTED", "MANUAL"]);
    const au = await db.auditLog.findMany({ where: { entityType: "ParttimeBuoiDaQua", entityId: buoi.DA_CHOT }, select: { newValues: true } });
    expect(au.map((a) => (a.newValues as { truong: string }).truong).sort()).toEqual(["TEACHING_ASSISTANT", "THUC_DAY"]);
    // Gỡ TA ⇒ CANCELLED (không REPLACED — không có người thay).
    expect(await sua("DA_CHOT", { ta: null })).toMatchObject({ ok: true, soThayDoi: 1 });
    expect((await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: ta.id } })).status).toBe("CANCELLED");
  });

  it("[SBQ-DB-04] TỪ CHỐI trước mọi phép ghi: chưa qua · chính sách cũ · kỳ công đã chốt · lý do ngắn · người thực dạy ở buổi chưa chốt · hai vai một người · không đổi gì", async () => {
    await db.attendancePeriod.create({ data: { centerId: cs, periodKey: "2026-10", status: "LOCKED" } });
    const truoc = await demGhi();
    const loi = async (p: Promise<{ ok: boolean; loi?: string }>) => ((await p) as { ok: false; loi: string }).loi;
    expect(await loi(sua("TUONG_LAI", { main: u.B }))).toMatch(/chưa qua/);
    expect(await loi(sua("CU", { main: u.B }))).toMatch(/chính sách cũ/);
    expect(await loi(sua("KY_CHOT", { thucDay: u.B }))).toMatch(/Kỳ công tháng 10\/2026/);
    expect(await loi(sua("QUA_MO", { main: u.C, lyDo: "ngắn" }))).toMatch(/tối thiểu 10/);
    expect(await loi(sua("QUA_MO", { thucDay: u.C }))).toMatch(/ĐÃ CHỐT/);
    expect(await loi(sua("QUA_MO", { ta: u.B }))).toMatch(/cả hai vai/);
    expect(await loi(sua("QUA_MO", { main: u.B }))).toMatch(/Không có gì thay đổi/);
    expect(await demGhi()).toEqual(truoc);
  });

  it("[SBQ-DB-05] đường phân công THƯỜNG không chạm được buổi đã chốt (cổng MO giữ nguyên — sửa đi đường có nhật ký)", async () => {
    const r = await db.$transaction((tx) => pcdb.phanCongVaoBuoi(tx, { nguon: nguon("DA_CHOT"), userId: u.C, role: "MAIN_TEACHER", assignmentType: "MANUAL", actor }));
    expect(r.ok).toBe(false);
  });
});
