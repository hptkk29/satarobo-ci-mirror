// [CHH-*] cổng hướng ngày Parttime · [CTX-DB-*] ngữ cảnh màn Chấm công — Postgres THẬT. Thuần: lib/parttime/ngu-canh-cham-cong.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-ngu-canh] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ bat: true, dem: 0, bang: [] as string[] }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return { ...goc, getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) => (key === "shift.phanCongNhanLopBat" ? ctl.bat : goc.getSetting(key as never, opts))) as typeof goc.getSetting };
});
vi.mock("../../lib/db", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/db")>();
  const dem = (goc.db as unknown as { $extends: (x: unknown) => unknown }).$extends({
    query: { $allModels: { async $allOperations({ model, args, query }: { model?: string; args: unknown; query: (a: unknown) => Promise<unknown> }) { ctl.dem++; ctl.bang.push(model ?? "?"); return query(args); } } },
  });
  return { ...goc, db: dem };
});

const TAG = "ngucanh";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

d("[CTX-DB] ngữ cảnh một nút Chấm công — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let truc: typeof import("../../lib/parttime/truc-van-hanh-db");
  let sh: typeof import("../../lib/cham-cong/suy-huong-db");
  let ncDb: typeof import("../../lib/parttime/ngu-canh-cham-cong-db");
  let ncThuan: typeof import("../../lib/parttime/ngu-canh-cham-cong");
  let cs1 = "";
  let cs2 = "";
  let wl1 = "";
  let wl2 = "";
  let gv = "";
  let gv2 = "";
  let sale = "";
  let nv = "";
  let ql = "";
  let khoa = "";
  let bai = "";
  let mauC = "";
  const actor = { id: null as string | null, name: "QLCS ctx" };
  const QL = () => ({ id: ql, name: "QL ctx" });

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({ where: { code: "LEGACY" }, update: {}, create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } } });
    await db.compensationPolicyVersion.upsert({ where: { code: "SR.QD.238" }, update: {}, create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) } });
  }

  async function cleanup() {
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    const dutyIds = (await db.operationsDutyAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: [...pcIds, ...dutyIds] } } });
    await db.$transaction([
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      db.$executeRaw`ALTER TABLE "OperationsDutyAcceptance" DISABLE TRIGGER "OperationsDutyAcceptance_bat_bien"`,
      db.operationsDutyAcceptance.deleteMany({ where: { dutyId: { in: dutyIds } } }),
      db.$executeRaw`ALTER TABLE "OperationsDutyAcceptance" ENABLE TRIGGER "OperationsDutyAcceptance_bat_bien"`,
    ]);
    await db.operationsDutyAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  // Ca nào tắt công tắc mà ném giữa chừng thì ca SAU không được thừa hưởng công tắc tắt (luật 18).
  beforeEach(() => {
    ctl.bat = true;
  });

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    svc = await import("../../lib/parttime/phan-cong-db");
    truc = await import("../../lib/parttime/truc-van-hanh-db");
    sh = await import("../../lib/cham-cong/suy-huong-db");
    ncDb = await import("../../lib/parttime/ngu-canh-cham-cong-db");
    ncThuan = await import("../../lib/parttime/ngu-canh-cham-cong");
    const mkCs = async (s: string) => {
      const c = await db.center.upsert({ where: { slug: `${TAG}-${s}` }, update: {}, create: { slug: `${TAG}-${s}`, name: `CS ${s}`, address: "x", code: `${TAG.toUpperCase()}-${s.toUpperCase()}` }, select: { id: true } });
      await db.orgUnit.upsert({ where: { code: `${TAG}-${s}` }, update: {}, create: { type: "CENTER", code: `${TAG}-${s}`, name: `ĐV ${s}`, path: `/${TAG}-${s}/`, depth: 0, centerId: c.id } });
      const w = await db.workLocation.upsert({ where: { code: `${TAG}-${s}` }, update: {}, create: { code: `${TAG}-${s}`, name: `Quầy ${s}`, centerId: c.id }, select: { id: true } });
      return [c.id, w.id] as const;
    };
    [cs1, wl1] = await mkCs("cs1");
    [cs2, wl2] = await mkCs("cs2");
    await cleanup();
    const mk = (e: string, n: string, role: "TEACHER" | "SALES_CSM") => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role, roles: [role], password: "x", centerId: cs1 }, select: { id: true } });
    gv = (await mk("gv", "GV ctx", "TEACHER")).id;
    gv2 = (await mk("gv2", "GV2 ctx", "TEACHER")).id;
    sale = (await mk("sale", "Sale ctx", "SALES_CSM")).id;
    nv = (await mk("nv", "NV ctx", "TEACHER")).id;
    ql = (await mk("ql", "QL ctx", "TEACHER")).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 ctx", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT ctx" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
    mauC = (
      await db.shiftTemplate.upsert({
        where: { code_effectiveFrom: { code: `${TAG}-C`, effectiveFrom: new Date("2000-01-01T00:00:00Z") } },
        update: {},
        create: { code: `${TAG}-C`, name: "Ca chiều ctx", segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.workLocation.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.shiftTemplate.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  // ── tiện ích ──
  let soLop = 0;
  const nhan = async (sourceId: string) => {
    for (const pc of await db.sessionStaffAssignment.findMany({ where: { sourceId, status: "WAITING_ACCEPTANCE" } })) {
      const r = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: pc.userId, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
      if (!r.ok) throw new Error(r.loi);
    }
  };
  const buoi = async (ymd: string, p: { teacherId?: string; taId?: string; thay?: string; tu?: string; den?: string; centerId?: string; nhanLuon?: boolean } = {}) => {
    soLop++;
    const centerId = p.centerId ?? cs1;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, classCode: `CTX-L${soLop}`, courseId: khoa, centerId, teacherId: p.teacherId ?? gv, assistantId: p.taId ?? null, startTime: p.tu ?? "18:00", endTime: p.den ?? "19:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId, status: "SCHEDULED", date: vn(ymd, p.tu ?? "18:00"), substituteTeacherId: p.thay ?? null }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    if (p.nhanLuon !== false) await nhan(s.id);
    return s.id;
  };
  const oCaC = (userId: string, ymd: string) =>
    db.shiftAssignment.create({ data: { userId, centerId: cs1, workDate: new Date(`${ymd}T00:00:00Z`), templateId: mauC, templateCode: `${TAG}-C`, segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] } });
  const quet = (userId: string, ymd: string, direction: "CHECK_IN" | "CHECK_OUT", hhmm: string, centerId = cs1) =>
    db.staffTimeLog.create({ data: { userId, centerId, direction, loggedAt: vn(ymd, hhmm), workDate: new Date(`${ymd}T00:00:00Z`), result: "ACCEPTED" } });
  const huong = (userId: string, ymd: string, hhmm: string, wl: string | null = wl1) => sh.suyHuongHomNay({ userId, workLocationId: wl, now: vn(ymd, hhmm) });
  /** Đúng đường của trang: hướng TỪ `suyHuongHomNay` rồi mới dựng ngữ cảnh trên chính kết quả đó. */
  const ngu = async (userId: string, ymd: string, hhmm: string, wl: string | null = wl1) => {
    const h = await huong(userId, ymd, hhmm, wl);
    return { h, nc: await ncDb.docNguCanhChamCong({ userId, workLocationId: wl, huong: h, now: vn(ymd, hhmm) }) };
  };

  it("[CHH-01] GV có ô ca lịch rảnh C 13:45–17:30 + dạy 18:00: tới 17:47 ⇒ VÀO (luật cũ ghi RA — đối chứng khi tắt công tắc); 19:35 ⇒ RA", async () => {
    const ngay = "2026-11-02";
    await oCaC(gv, ngay);
    await buoi(ngay);
    ctl.bat = false;
    expect(await huong(gv, ngay, "17:47")).toMatchObject({ huong: "CHECK_OUT", lyDo: "RA_QUEN_VAO", cheDo: "CA" });
    ctl.bat = true;
    expect(await huong(gv, ngay, "17:47")).toMatchObject({ huong: "CHECK_IN", cheDo: "PARTTIME" });
    await quet(gv, ngay, "CHECK_IN", "17:47");
    expect(await huong(gv, ngay, "19:35")).toMatchObject({ huong: "CHECK_OUT", cheDo: "PARTTIME" });
    // Bấm trùng vẫn là trùng (luật (a) giữ nguyên).
    expect(await huong(gv, ngay, "17:48")).toMatchObject({ trung: true, huong: "CHECK_IN" });
  });

  it("[CHH-02] nhân viên CHỈ có ca thường (không phân công / trực) ⇒ luật ca CŨ nguyên vẹn, kể cả khi công tắc bật", async () => {
    const ngay = "2026-11-03";
    await oCaC(nv, ngay);
    expect(await huong(nv, ngay, "17:47")).toMatchObject({ huong: "CHECK_OUT", lyDo: "RA_QUEN_VAO", cheDo: "CA" });
    const { nc } = await ngu(nv, ngay, "14:00");
    expect(nc).toMatchObject({ primary: "NORMAL_SHIFT", contexts: ["NORMAL_SHIFT"], operationsDuty: null, teaching: [] });
  });

  it("[CTX-DB-02][CTX-47] CHỈ dạy, KHÔNG trực — có và không có ô ca: ngữ cảnh dạy CÓ, trực KHÔNG; VÀO lúc 17:47 ở cả hai", async () => {
    const khongCa = "2026-11-04";
    await buoi(khongCa);
    const a = await ngu(gv, khongCa, "17:47");
    expect(a.h.huong).toBe("CHECK_IN");
    expect(a.nc).toMatchObject({ primary: "TEACHING", contexts: ["TEACHING_MAIN"], operationsDuty: null, nextTeaching: { tieuDe: "GIÁO VIÊN ĐỨNG CHÍNH", gio: "18:00–19:30", coMatTruoc: "17:50" } });
    const coCa = "2026-11-05";
    await oCaC(gv, coCa);
    await buoi(coCa);
    const b = await ngu(gv, coCa, "17:47");
    expect(b.h.huong).toBe("CHECK_IN");
    expect(b.nc).toMatchObject({ primary: "MIXED", contexts: ["NORMAL_SHIFT", "TEACHING_MAIN"], operationsDuty: null });
    // Sau khi chấm vào/ra đủ: vẫn không có trực nào (P5 sẽ ra 1 tiết · 0 trực).
    await quet(gv, coCa, "CHECK_IN", "17:47");
    await quet(gv, coCa, "CHECK_OUT", "19:35");
    expect((await ngu(gv, coCa, "19:40")).nc?.operationsDuty).toBeNull();
    expect(await truc.docTrucCoSo({ centerId: cs1, tu: coCa, den: coCa, now: vn(coCa, "22:00") })).toEqual([]);
  });

  it("[CTX-DB-03..05] trợ giảng · dạy thay · học bù — nhãn đúng, đều là ngữ cảnh dạy", async () => {
    const ngay = "2026-11-06";
    await buoi(ngay, { teacherId: gv2, taId: gv });
    expect((await ngu(gv, ngay, "14:00")).nc?.nextTeaching).toMatchObject({ tieuDe: "TRỢ GIẢNG", nhanVai: "Trợ giảng" });
    const ngay2 = "2026-11-07";
    await buoi(ngay2, { teacherId: gv2, thay: gv });
    expect((await ngu(gv, ngay2, "14:00")).nc?.nextTeaching).toMatchObject({ tieuDe: "DẠY THAY", nhanVai: "Đứng chính" });
    const ngay3 = "2026-11-09";
    const c = await db.makeupCase.create({ data: { centerId: cs1, courseId: khoa, lessonId: bai, date: new Date(`${ngay3}T00:00:00Z`), startTime: "18:00", endTime: "19:30", teacherId: gv, status: "SCHEDULED", createdById: gv }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "TAO_BUOI", actor);
    await nhan(c.id);
    expect((await ngu(gv, ngay3, "14:00")).nc?.nextTeaching).toMatchObject({ tieuDe: "HỌC BÙ", nhanLop: "Sata 4 ctx" });
  });

  it("[CTX-DB-06][CTX-DB-07] chỉ trực ⇒ OPERATIONS_DUTY; trực + đứng chính ⇒ MIXED, MỘT lượt VÀO 17:10 và MỘT lượt RA 21:05", async () => {
    const ngay = "2026-11-10";
    const giao = async (u: string, ymd: string) => {
      const g = await db.$transaction((tx) => truc.giaoTruc(tx, { userId: u, centerId: cs1, ngay: ymd, shiftCode: "T", note: null, actor: QL() }));
      if (!g.ok) throw new Error(g.loi);
      await db.$transaction((tx) => truc.quyetDinhTruc(tx, { dutyId: g.id, nguoiBam: { id: u, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn(ymd, "07:00") }));
    };
    await giao(gv2, ngay);
    expect((await ngu(gv2, ngay, "14:00")).nc).toMatchObject({ primary: "OPERATIONS_DUTY", operationsDuty: { shiftCode: "T", gio: "17:15–21:00" } });
    const ngay2 = "2026-11-11";
    await giao(gv, ngay2);
    await buoi(ngay2);
    const a = await ngu(gv, ngay2, "17:10");
    expect([a.h.huong, a.nc?.primary, a.nc?.contexts]).toEqual(["CHECK_IN", "MIXED", ["TEACHING_MAIN", "OPERATIONS_DUTY"]]);
    expect(a.nc?.cauDuDoan).toBe("Dự đoán: lần này sẽ ghi VÀO · ca trực + lịch dạy hôm nay.");
    await quet(gv, ngay2, "CHECK_IN", "17:10");
    // 18:00 / 19:30 không đòi thêm lượt: lần bấm kế tiếp (bất kể giờ) là RA.
    expect((await huong(gv, ngay2, "21:05")).huong).toBe("CHECK_OUT");
  });

  it("[DIR-04][CTX-DB-08] hai tiết liền nhau: MỘT VÀO 17:18 + MỘT RA 20:50 là bằng chứng ĐỦ cho CẢ HAI (P4)", async () => {
    const ngay = "2026-11-12";
    await buoi(ngay, { tu: "17:30", den: "19:00" });
    await buoi(ngay, { tu: "19:15", den: "20:45" });
    expect((await huong(gv, ngay, "17:18")).huong).toBe("CHECK_IN");
    await quet(gv, ngay, "CHECK_IN", "17:18");
    expect((await huong(gv, ngay, "20:50")).huong).toBe("CHECK_OUT");
    await quet(gv, ngay, "CHECK_OUT", "20:50");
    const { nc } = await ngu(gv, ngay, "21:00");
    expect(nc?.teaching.map((t) => [t.gio, t.bangChung])).toEqual([
      ["17:30–19:00", "Vào 17:18 · ra 20:50"],
      ["19:15–20:45", "Vào 17:18 · ra 20:50"],
    ]);
  });

  it("[CTX-DB-EV] sau VÀO muộn: bằng chứng P4 nói 'Đã vào … · muộn N''; sau RA: 'Đi muộn N''", async () => {
    const ngay = "2026-11-13";
    await buoi(ngay);
    await quet(gv, ngay, "CHECK_IN", "17:58");
    expect((await ngu(gv, ngay, "18:30")).nc?.nextTeaching?.bangChung).toBe("Đã vào 17:58 · muộn 8'");
    await quet(gv, ngay, "CHECK_OUT", "19:35");
    expect((await ngu(gv, ngay, "19:40")).nc?.nextTeaching?.bangChung).toBe("Đi muộn 8'");
  });

  it("[CTX-DB-09..11] không lịch ⇒ NONE; vai TEACHER mà KHÔNG phân công ⇒ không ngữ cảnh dạy; vai SALE CÓ phân công ⇒ có", async () => {
    const ngay = "2026-11-16";
    expect((await ngu(nv, ngay, "14:00")).nc).toMatchObject({ primary: "NONE", teaching: [], operationsDuty: null });
    await buoi(ngay, { teacherId: sale });
    expect((await ngu(sale, ngay, "14:00")).nc).toMatchObject({ primary: "TEACHING", contexts: ["TEACHING_MAIN"] });
    expect((await ngu(nv, ngay, "14:00")).nc?.teaching).toEqual([]);
  });

  it("[CTX-DB-12] ngày trước 15/10/2026 (LEGACY) ⇒ không ngữ cảnh, hướng theo luật cũ", async () => {
    const ngay = "2026-10-13";
    await oCaC(gv, ngay);
    const { h, nc } = await ngu(gv, ngay, "17:47");
    expect(nc).toBeNull();
    expect(h).toMatchObject({ cheDo: "CA", huong: "CHECK_OUT" });
  });

  it("[CTX-DB-13..15] buổi HUỶ · phân công TỪ CHỐI · phân công bị THAY ⇒ không thành ngữ cảnh dạy", async () => {
    const ngay = "2026-11-17";
    const huy = await buoi(ngay, { tu: "08:00", den: "09:30" });
    await db.classSession.update({ where: { id: huy }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: huy }], "TAO_BUOI", actor);
    const tc = await buoi(ngay, { tu: "10:00", den: "11:30", nhanLuon: false });
    const pc = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: tc, userId: gv } });
    const r = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: gv, name: "x" }, quyetDinh: "DECLINED", phienBanDaXem: pc.assignmentVersion, lyDo: "Bận việc riêng" }));
    expect(r.ok).toBe(true);
    const thay = await buoi(ngay, { tu: "14:00", den: "15:30" });
    await db.classSession.update({ where: { id: thay }, data: { substituteTeacherId: gv2 } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: thay }], "TAO_BUOI", actor);
    const { nc } = await ngu(gv, ngay, "07:00");
    expect(nc?.teaching).toEqual([]);
    expect(nc?.primary).toBe("NONE");
  });

  it("[CTX-DB-CS] tiết ở cơ sở KHÁC điểm đang quét ⇒ nêu rõ (dạy thay ở cơ sở khác dùng cơ sở CỦA BUỔI)", async () => {
    const ngay = "2026-11-18";
    await buoi(ngay, { centerId: cs2 });
    const { nc } = await ngu(gv, ngay, "14:00", wl1);
    expect(nc?.nextTeaching?.khacCoSo).toBe("NGUCANH-CS2");
    expect(nc?.warnings.map((w) => w.ma)).toContain("KHAC_CO_SO");
    expect((await ngu(gv, ngay, "14:00", wl2)).nc?.nextTeaching?.khacCoSo).toBeNull();
  });

  it("[CTX-DB-17] ô ca C + tiết CHƯA NHẬN, bấm 17:47 ⇒ ghi VÀO (theo hiện diện) VÀ thẻ NÓI ra: cảnh báo chưa nhận lớp, không trông y như cũ", async () => {
    const ngay = "2026-11-25";
    await oCaC(gv, ngay);
    await buoi(ngay, { nhanLuon: false });
    const { h, nc } = await ngu(gv, ngay, "17:47");
    expect(h).toMatchObject({ huong: "CHECK_IN", cheDo: "PARTTIME" });
    expect(nc?.primary).toBe("NORMAL_SHIFT"); // tiết chưa nhận không phải ngữ cảnh dạy
    expect(nc?.warnings.map((w) => w.ma)).toEqual(["CHUA_NHAN_LOP"]);
    expect(nc?.huongTiepTheo).toBe("CHECK_OUT");
    expect(ncThuan.hienKhoiNguCanh(nc)).toBe(true);
  });

  it("[CTX-DB-FLAG] công tắc TẮT ⇒ ngữ cảnh null (thẻ cũ) và cổng hướng KHÔNG tra thêm câu nào", async () => {
    const ngay = "2026-11-19";
    await buoi(ngay);
    ctl.bat = false;
    try {
      ctl.bang = [];
      const h = await huong(gv, ngay, "17:47");
      const bangTat = [...ctl.bang];
      expect(await ncDb.docNguCanhChamCong({ userId: gv, workLocationId: wl1, huong: h, now: vn(ngay, "17:47") })).toBeNull();
      // TẮT ⇒ không một câu nào chạm bảng Parttime (hành vi + số câu tra của luật cũ nguyên vẹn).
      const PT = ["SessionStaffAssignment", "OperationsDutyAssignment", "CompensationPolicyVersion"];
      expect(bangTat.filter((b) => PT.includes(b))).toEqual([]);
      expect(h.cheDo).toBe("CA");
      // Đối chứng dương: BẬT thì cổng CÓ tra bảng Parttime (không thì phép lọc trên luôn rỗng vì lý do sai).
      ctl.bat = true;
      ctl.bang = [];
      await huong(gv, ngay, "17:47");
      expect(ctl.bang.filter((b) => PT.includes(b)).length).toBeGreaterThan(0);
      expect(ctl.bang.length).toBe(bangTat.length + 3);
    } finally {
      ctl.bat = true;
    }
  });

  it("[CTX-DB-Q] số câu tra của ngữ cảnh KHÔNG đổi theo số tiết (2 vs 6)", async () => {
    const it1 = "2026-11-23";
    const it2 = "2026-11-24";
    for (const [i, g] of ["08:00", "10:00"].entries()) await buoi(it1, { tu: g, den: ["09:30", "11:30"][i] });
    for (const [i, g] of ["07:00", "08:40", "10:20", "13:00", "14:40", "16:20"].entries()) await buoi(it2, { tu: g, den: ["08:30", "10:10", "11:50", "14:30", "16:10", "17:50"][i] });
    const dem = async (ngay: string) => {
      const h = await huong(gv, ngay, "06:00");
      ctl.dem = 0;
      const nc = await ncDb.docNguCanhChamCong({ userId: gv, workLocationId: wl1, huong: h, now: vn(ngay, "06:00") });
      return { so: nc?.teaching.length, cau: ctl.dem };
    };
    const a = await dem(it1);
    const b = await dem(it2);
    expect([a.so, b.so]).toEqual([2, 6]);
    expect(b.cau).toBe(a.cau);
  });
});
