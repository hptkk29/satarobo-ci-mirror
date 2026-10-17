// [H1-*] "Chấm ngoài lịch" (`CHAM_NGOAI_LICH`) theo mô hình Parttime — Postgres THẬT, qua ĐÚNG hai đường gắn cờ:
//   · lượt quét: `recordTimeLog` (cờ trên `StaffTimeLog.flags` — thứ người bấm đọc thành "hôm nay bạn không có ca");
//   · bảng công ngày: `recomputeAttendanceDay` (engine gắn lại cờ ở mức ngày khi không có ô ca).
// Việc hợp lệ = ô ca ACTIVE (luật cũ) · tiết dạy / trợ giảng ĐÃ NHẬN · ca trực ĐÃ NHẬN — hai loại sau chỉ ở ĐÚNG cơ sở của lượt.
// Thuần: lib/parttime/cong-viec-hop-le.test.ts · lưới dây nối: lib/parttime/cong-viec-hop-le-wiring.test.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-cham-ngoai-lich] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ bat: true, bang: [] as string[] }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return { ...goc, getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) => (key === "shift.phanCongNhanLopBat" ? ctl.bat : goc.getSetting(key as never, opts))) as typeof goc.getSetting };
});
vi.mock("../../lib/db", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/db")>();
  const dem = (goc.db as unknown as { $extends: (x: unknown) => unknown }).$extends({
    query: { $allModels: { async $allOperations({ model, args, query }: { model?: string; args: unknown; query: (a: unknown) => Promise<unknown> }) { ctl.bang.push(model ?? "?"); return query(args); } } },
  });
  return { ...goc, db: dem };
});

const TAG = "h1ngl";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const NGL = "CHAM_NGOAI_LICH";
const BANG_PARTTIME = ["SessionStaffAssignment", "OperationsDutyAssignment", "CompensationPolicyVersion", "StaffAssignmentAcceptance", "OperationsDutyAcceptance"];

d("[H1] CHAM_NGOAI_LICH biết phân công Parttime — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let truc: typeof import("../../lib/parttime/truc-van-hanh-db");
  let tl: typeof import("../../lib/cham-cong/timelog");
  let rc: typeof import("../../lib/cham-cong/recompute");
  let cs1 = "";
  let cs2 = "";
  let wl1 = "";
  let wl2 = "";
  let gv = "";
  let gv2 = "";
  let nv = "";
  let ql = "";
  let khoa = "";
  let mauC = "";
  const actor = { id: null as string | null, name: "QLCS h1" };

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
    for (const u of ids) await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `attday:${u}:` } } });
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
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeEach(() => {
    ctl.bat = true;
  });

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    svc = await import("../../lib/parttime/phan-cong-db");
    truc = await import("../../lib/parttime/truc-van-hanh-db");
    tl = await import("../../lib/cham-cong/timelog");
    rc = await import("../../lib/cham-cong/recompute");
    const mkCs = async (s: string) => {
      const c = await db.center.upsert({ where: { slug: `${TAG}-${s}` }, update: {}, create: { slug: `${TAG}-${s}`, name: `CS ${s}`, address: "x", code: `${TAG.toUpperCase()}-${s.toUpperCase()}` }, select: { id: true } });
      await db.orgUnit.upsert({ where: { code: `${TAG}-${s}` }, update: {}, create: { type: "CENTER", code: `${TAG}-${s}`, name: `ĐV ${s}`, path: `/${TAG}-${s}/`, depth: 0, centerId: c.id } });
      const w = await db.workLocation.upsert({ where: { code: `${TAG}-${s}` }, update: {}, create: { code: `${TAG}-${s}`, name: `Quầy ${s}`, centerId: c.id }, select: { id: true } });
      return [c.id, w.id] as const;
    };
    [cs1, wl1] = await mkCs("cs1");
    [cs2, wl2] = await mkCs("cs2");
    await cleanup();
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 }, select: { id: true } });
    gv = (await mk("gv", "GV h1")).id;
    gv2 = (await mk("gv2", "GV2 h1")).id;
    nv = (await mk("nv", "NV h1")).id;
    ql = (await mk("ql", "QL h1")).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 h1", slug: `${TAG}-k` }, select: { id: true } })).id;
    mauC = (
      await db.shiftTemplate.upsert({
        where: { code_effectiveFrom: { code: `${TAG}-C`, effectiveFrom: new Date("2000-01-01T00:00:00Z") } },
        update: {},
        create: { code: `${TAG}-C`, name: "Ca chiều h1", segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] },
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
  const quyet = async (sourceId: string, quyetDinh: "ACCEPTED" | "DECLINED", userId?: string) => {
    for (const pc of await db.sessionStaffAssignment.findMany({ where: { sourceId, status: "WAITING_ACCEPTANCE", ...(userId ? { userId } : {}) } })) {
      const r = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: pc.userId, name: "x" }, quyetDinh, phienBanDaXem: pc.assignmentVersion, lyDo: quyetDinh === "DECLINED" ? "Bận việc gia đình" : null }));
      if (!r.ok) throw new Error(r.loi);
    }
  };
  const buoi = async (ymd: string, p: { teacherId?: string; taId?: string; centerId?: string; nhan?: boolean } = {}) => {
    soLop++;
    const centerId = p.centerId ?? cs1;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, classCode: `H1-L${soLop}`, courseId: khoa, centerId, teacherId: p.teacherId ?? gv, assistantId: p.taId ?? null, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId, status: "SCHEDULED", date: vn(ymd, "18:00") }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    if (p.nhan !== false) await quyet(s.id, "ACCEPTED");
    return s.id;
  };
  const giaoTruc = async (u: string, ymd: string, nhan = true, centerId = cs1) => {
    const g = await db.$transaction((tx) => truc.giaoTruc(tx, { userId: u, centerId, ngay: ymd, shiftCode: "T", note: null, actor: { id: ql, name: "QL h1" } }));
    if (!g.ok) throw new Error(g.loi);
    if (nhan) await db.$transaction((tx) => truc.quyetDinhTruc(tx, { dutyId: g.id, nguoiBam: { id: u, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn(ymd, "07:00") }));
  };
  const oCaC = (userId: string, ymd: string) =>
    db.shiftAssignment.create({ data: { userId, centerId: cs1, workDate: ngayDb(ymd), templateId: mauC, templateCode: `${TAG}-C`, segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] } });
  /** ĐƯỜNG GHI THẬT của nút Chấm công (không GPS — điểm chưa khai toạ độ ⇒ chỉ cờ CHUA_TOA_DO). */
  const bam = async (userId: string, ymd: string, hhmm: string, direction: "CHECK_IN" | "CHECK_OUT", wl = wl1) => {
    const r = await tl.recordTimeLog({ userId, workLocationId: wl, direction, now: vn(ymd, hhmm) });
    if (!r.ok) throw new Error(r.error);
    return r.flags;
  };
  const coNgl = async (userId: string, ymd: string, hhmm: string, wl = wl1) => (await bam(userId, ymd, hhmm, "CHECK_IN", wl)).includes(NGL);
  const ngayCoNgl = async (userId: string, ymd: string) => {
    const r = await rc.recomputeAttendanceDay(userId, ngayDb(ymd), { now: vn(ymd, "23:00") });
    if (!r.ok || r.skipped) throw new Error(`recompute ${JSON.stringify(r)}`);
    return r.flags.includes(NGL);
  };

  it("[H1-01] chỉ ca thường ⇒ KHÔNG cờ (lượt + ngày) — đối chứng: nhân viên không ca, không việc ⇒ CÓ cờ [H1-10]", async () => {
    const ngay = "2026-11-02";
    await oCaC(nv, ngay);
    expect(await coNgl(nv, ngay, "13:40")).toBe(false);
    await bam(nv, ngay, "17:35", "CHECK_OUT");
    expect(await ngayCoNgl(nv, ngay)).toBe(false);
  });

  it("[H1-10] không ca · không tiết · không trực ⇒ cờ CŨ vẫn còn (lượt + ngày)", async () => {
    const ngay = "2026-11-03";
    expect(await coNgl(nv, ngay, "09:00")).toBe(true);
    expect(await ngayCoNgl(nv, ngay)).toBe(true);
  });

  it("[H1-02] CHỈ đứng chính (đã nhận, không ô ca, không trực): 17:47 VÀO + 19:35 RA ⇒ KHÔNG cờ ở lượt lẫn ngày", async () => {
    const ngay = "2026-11-04";
    await buoi(ngay);
    expect(await coNgl(gv, ngay, "17:47")).toBe(false);
    expect((await bam(gv, ngay, "19:35", "CHECK_OUT")).includes(NGL)).toBe(false);
    expect(await ngayCoNgl(gv, ngay)).toBe(false);
  });

  it("[H1-03] CHỈ trợ giảng (đã nhận) ⇒ KHÔNG cờ", async () => {
    const ngay = "2026-11-05";
    await buoi(ngay, { teacherId: gv2, taId: gv });
    expect(await db.sessionStaffAssignment.count({ where: { userId: gv, ngay: ngayDb(ngay), role: "TEACHING_ASSISTANT", status: "ACCEPTED" } })).toBe(1);
    expect(await coNgl(gv, ngay, "17:45")).toBe(false);
    expect(await ngayCoNgl(gv, ngay)).toBe(false);
  });

  it("[H1-04] CHỈ ca trực (đã nhận, không ô ca) ⇒ KHÔNG cờ; trực CHƯA nhận ⇒ CÓ cờ", async () => {
    const ngay = "2026-11-06";
    await giaoTruc(gv2, ngay);
    expect(await coNgl(gv2, ngay, "17:10")).toBe(false);
    expect(await ngayCoNgl(gv2, ngay)).toBe(false);
    const ngay2 = "2026-11-07";
    await giaoTruc(gv2, ngay2, false);
    expect(await coNgl(gv2, ngay2, "17:10")).toBe(true);
  });

  it("[H1-05] đứng chính + trực ⇒ KHÔNG cờ (một VÀO 17:10, một RA 21:05)", async () => {
    const ngay = "2026-11-09";
    await giaoTruc(gv, ngay);
    await buoi(ngay);
    expect(await coNgl(gv, ngay, "17:10")).toBe(false);
    await bam(gv, ngay, "21:05", "CHECK_OUT");
    expect(await ngayCoNgl(gv, ngay)).toBe(false);
  });

  it("[H1-06] tiết đã nhận rồi BUỔI BỊ HUỶ (đồng bộ HUY_BUOI) ⇒ không còn che cờ", async () => {
    const ngay = "2026-11-10";
    const s = await buoi(ngay);
    await db.classSession.update({ where: { id: s }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s }], "HUY_BUOI", actor);
    expect(await coNgl(gv, ngay, "17:47")).toBe(true);
    expect(await ngayCoNgl(gv, ngay)).toBe(true);
  });

  it("[H1-07] tiết bị TỪ CHỐI ⇒ không che cờ", async () => {
    const ngay = "2026-11-11";
    const s = await buoi(ngay, { nhan: false });
    await quyet(s, "DECLINED");
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: s, userId: gv, status: "DECLINED" } })).toBe(1);
    expect(await coNgl(gv, ngay, "17:47")).toBe(true);
  });

  it("[H1-08] phân công bị THAY (đổi GV dạy thay sang người khác) ⇒ không che cờ cho người cũ; người dạy thay đã nhận thì không cờ", async () => {
    const ngay = "2026-11-12";
    const s = await buoi(ngay);
    await db.classSession.update({ where: { id: s }, data: { substituteTeacherId: gv2 } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s }], "DOI_GV_BUOI", actor);
    const cu = await db.sessionStaffAssignment.findMany({ where: { sourceId: s, userId: gv }, select: { status: true } });
    expect(cu.length).toBeGreaterThan(0);
    expect(cu.every((x) => ["REPLACED", "CANCELLED"].includes(x.status))).toBe(true);
    expect(await coNgl(gv, ngay, "17:47")).toBe(true);
    await quyet(s, "ACCEPTED", gv2);
    expect(await coNgl(gv2, ngay, "17:48")).toBe(false);
  });

  it("[H1-09] tiết đã nhận ở CS2: quét ở CS1 ⇒ VẪN cờ (lượt + ngày); quét ở CS2 ⇒ không cờ", async () => {
    const ngay = "2026-11-13";
    await buoi(ngay, { centerId: cs2 });
    expect(await coNgl(gv, ngay, "17:47", wl1)).toBe(true);
    expect(await ngayCoNgl(gv, ngay)).toBe(true);
    const ngay2 = "2026-11-14";
    await buoi(ngay2, { centerId: cs2 });
    expect(await coNgl(gv, ngay2, "17:47", wl2)).toBe(false);
    expect(await ngayCoNgl(gv, ngay2)).toBe(false);
    // Một lượt ở CS2 (có tiết) + một lượt ở CS1 (không có việc) ⇒ ngày VẪN cờ (bảo thủ: mọi lượt phải có lịch).
    await bam(gv, ngay2, "20:10", "CHECK_OUT", wl1);
    expect(await ngayCoNgl(gv, ngay2)).toBe(true);
  });

  it("[H1-11] tiết CHƯA NHẬN ⇒ hướng đã theo hiện diện nhưng VẪN cờ (chưa nhận lớp thì chưa là nghĩa vụ — có chủ đích)", async () => {
    const ngay = "2026-11-16";
    await buoi(ngay, { nhan: false });
    expect(await coNgl(gv, ngay, "17:47")).toBe(true);
  });

  it("[H1-12] cờ trên lượt gắn TRƯỚC khi nhận lớp ⇒ tính lại ngày sau khi nhận thì ngày hết cờ", async () => {
    const ngay = "2026-11-17";
    const s = await buoi(ngay, { nhan: false });
    expect(await coNgl(gv, ngay, "17:47")).toBe(true);
    await quyet(s, "ACCEPTED");
    expect(await ngayCoNgl(gv, ngay)).toBe(false);
  });

  it("[H1-FLAG] công tắc TẮT ⇒ luật CŨ (đứng chính đã nhận vẫn bị cờ) và KHÔNG câu tra nào chạm bảng Parttime ở cả hai đường", async () => {
    const ngay = "2026-11-18";
    await buoi(ngay);
    ctl.bat = false;
    ctl.bang = [];
    expect(await coNgl(gv, ngay, "17:47")).toBe(true);
    expect(await ngayCoNgl(gv, ngay)).toBe(true);
    expect(ctl.bang.filter((b) => BANG_PARTTIME.includes(b))).toEqual([]);
    ctl.bat = true;
    expect(await ngayCoNgl(gv, ngay)).toBe(false);
  });

  it("[H1-Q] ngày có ô ca làm việc ⇒ KHÔNG câu tra nào chạm bảng Parttime (cả lượt quét lẫn tính lại)", async () => {
    const ngay = "2026-11-19";
    await oCaC(gv, ngay);
    await buoi(ngay);
    ctl.bang = [];
    expect(await coNgl(gv, ngay, "13:40")).toBe(false);
    expect(await ngayCoNgl(gv, ngay)).toBe(false);
    expect(ctl.bang.filter((b) => BANG_PARTTIME.includes(b))).toEqual([]);
  });
});
