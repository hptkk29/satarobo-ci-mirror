// [FLAG-*] [RBAC-V2-*] Bốn công tắc Parttime theo CƠ SỞ + cổng RBAC v2 — Postgres THẬT, dòng `SystemSetting` / `CenterSetting`
// THẬT (không giả `getSetting`): thứ được kiểm là chính phép đọc phạm vi công tắc (`lib/parttime/cong-tac-doc.ts`).
// Thuần: lib/parttime/cong-tac.test.ts. Chỉ phần RBAC đi qua ranh giới giả (`rbacV2ChoParttime`) — `checkPermission` không dính.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-cong-tac] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ rbac: true, bang: [] as string[] }));
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => ctl.rbac }));
vi.mock("../../lib/db", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/db")>();
  const dem = (goc.db as unknown as { $extends: (x: unknown) => unknown }).$extends({
    query: { $allModels: { async $allOperations({ model, args, query }: { model?: string; args: unknown; query: (a: unknown) => Promise<unknown> }) { ctl.bang.push(model ?? "?"); return query(args); } } },
  });
  return { ...goc, db: dem };
});

const TAG = "ctpt";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const NGL = "CHAM_NGOAI_LICH";
const K = {
  STAFFING: "shift.parttimeStaffingEnabled",
  ATTENDANCE_CONTEXT: "shift.parttimeAttendanceContextEnabled",
  WORKUNIT_SHADOW: "shift.parttimeWorkUnitShadowEnabled",
  COMPENSATION: "shift.parttimeCompensationEnabled",
} as const;
type Loai = keyof typeof K;
const BANG_PARTTIME = ["SessionStaffAssignment", "OperationsDutyAssignment", "CompensationPolicyVersion", "StaffAssignmentAcceptance", "OperationsDutyAcceptance"];

d("[FLAG] công tắc Parttime theo cơ sở + RBAC v2 — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let ct: typeof import("../../lib/parttime/cong-tac");
  let tl: typeof import("../../lib/cham-cong/timelog");
  let sh: typeof import("../../lib/cham-cong/suy-huong-db");
  let nc: typeof import("../../lib/parttime/ngu-canh-cham-cong-db");
  let cvhl: typeof import("../../lib/parttime/cong-viec-hop-le-db");
  let ss: typeof import("../../lib/parttime/san-sang");
  const cs = { CS1: "", CS2: "" };
  const ou = { CS1: "", CS2: "" };
  const wl = { CS1: "", CS2: "" };
  let gv = "";
  let nv = "";
  let khoa = "";
  let mauC = "";
  let soLop = 0;
  const actor = { id: null as string | null, name: "QLCS ctpt" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({ where: { code: "LEGACY" }, update: {}, create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } } });
    await db.compensationPolicyVersion.upsert({ where: { code: "SR.QD.238" }, update: {}, create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) } });
  }

  /** Đặt công tắc: `macDinh` = dòng SystemSetting (null = không dòng ⇒ mặc định registry false); `coSo` = ghi đè CenterSetting. */
  async function dat(loai: Loai, macDinh: boolean | null, coSo: Partial<Record<"CS1" | "CS2", boolean>> = {}) {
    const key = K[loai];
    await db.systemSetting.deleteMany({ where: { key } });
    await db.centerSetting.deleteMany({ where: { key } });
    if (macDinh !== null) await db.systemSetting.create({ data: { key, valueJson: macDinh, updatedByName: TAG } });
    for (const [c, v] of Object.entries(coSo)) await db.centerSetting.create({ data: { orgUnitId: ou[c as "CS1" | "CS2"], key, valueJson: v as boolean, updatedByName: TAG } });
  }
  const tatHet = async () => {
    for (const loai of Object.keys(K) as Loai[]) await dat(loai, null);
  };

  async function cleanup() {
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    for (const u of ids) await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `attday:${u}:` } } });
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: pcIds } } });
    await db.$transaction([
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
    ]);
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

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    ct = await import("../../lib/parttime/cong-tac");
    tl = await import("../../lib/cham-cong/timelog");
    sh = await import("../../lib/cham-cong/suy-huong-db");
    nc = await import("../../lib/parttime/ngu-canh-cham-cong-db");
    cvhl = await import("../../lib/parttime/cong-viec-hop-le-db");
    ss = await import("../../lib/parttime/san-sang");
    for (const c of ["CS1", "CS2"] as const) {
      const s = c.toLowerCase();
      const center = await db.center.upsert({ where: { slug: `${TAG}-${s}` }, update: {}, create: { slug: `${TAG}-${s}`, name: `CS ${s}`, address: "x", code: `${TAG.toUpperCase()}-${c}` }, select: { id: true } });
      const o = await db.orgUnit.upsert({ where: { code: `${TAG}-${s}` }, update: {}, create: { type: "CENTER", code: `${TAG}-${s}`, name: `ĐV ${s}`, path: `/${TAG}-${s}/`, depth: 0, centerId: center.id }, select: { id: true } });
      const w = await db.workLocation.upsert({ where: { code: `${TAG}-${s}` }, update: {}, create: { code: `${TAG}-${s}`, name: `Quầy ${s}`, centerId: center.id, orgUnitId: o.id }, select: { id: true } });
      cs[c] = center.id;
      ou[c] = o.id;
      wl[c] = w.id;
    }
    await cleanup();
    const mk = (e: string, n: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: n, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs.CS1 }, select: { id: true } });
    gv = (await mk("gv", "GV ctpt")).id;
    nv = (await mk("nv", "NV ctpt")).id;
    khoa = (await db.course.create({ data: { name: "Sata 4 ctpt", slug: `${TAG}-k` }, select: { id: true } })).id;
    mauC = (
      await db.shiftTemplate.upsert({
        where: { code_effectiveFrom: { code: `${TAG}-C`, effectiveFrom: new Date("2000-01-01T00:00:00Z") } },
        update: {},
        create: { code: `${TAG}-C`, name: "Ca chiều ctpt", segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    ctl.rbac = true;
    await tatHet();
  });
  afterEach(tatHet);

  afterAll(async () => {
    await tatHet();
    await cleanup();
    await db.workLocation.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.shiftTemplate.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  /** Buổi 18:00–19:30 ở cơ sở `c`, đồng bộ phân công (như tạo buổi), nhận nếu có phân công. Trả id buổi + số phân công dựng. */
  /** Lớp + buổi + đồng bộ thật. Phân công dựng ra ĐÃ GÁN (ĐẢO 20/10/2026) — không còn bước giáo viên nhận. */
  const buoi = async (ymd: string, c: "CS1" | "CS2") => {
    soLop++;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, classCode: `CT-L${soLop}`, courseId: khoa, centerId: cs[c], teacherId: gv, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs[c], status: "SCHEDULED", date: vn(ymd, "18:00") }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    const pcs = await db.sessionStaffAssignment.findMany({ where: { sourceId: s.id }, select: { status: true } });
    if (pcs.some((p) => p.status !== "ACCEPTED")) throw new Error(`phân công dựng ra phải đã gán: ${pcs.map((p) => p.status).join(",")}`);
    return { id: s.id, soPhanCong: pcs.length };
  };
  const huong = (userId: string, ymd: string, hhmm: string, c: "CS1" | "CS2") => sh.suyHuongHomNay({ userId, workLocationId: wl[c], now: vn(ymd, hhmm) });
  const coNgl = async (userId: string, ymd: string, hhmm: string, c: "CS1" | "CS2") => {
    const r = await tl.recordTimeLog({ userId, workLocationId: wl[c], direction: "CHECK_IN", now: vn(ymd, hhmm) });
    if (!r.ok) throw new Error(r.error);
    return r.flags.includes(NGL);
  };

  it("[FLAG-CENTER-01] CS1 chấm công theo ngữ cảnh BẬT, CS2 TẮT ⇒ CS1 dùng bộ suy Parttime, CS2 luật cũ (hướng ca + cờ ngoài lịch + không thẻ)", async () => {
    await dat("STAFFING", true);
    await dat("ATTENDANCE_CONTEXT", false, { CS1: true });
    // CS1: tiết đã nhận, không ô ca.
    const n1 = "2026-11-02";
    await buoi(n1, "CS1");
    expect((await huong(gv, n1, "17:47", "CS1")).cheDo).toBe("PARTTIME");
    expect([...(await cvhl.coSoCoViecParttime({ userId: gv, workDate: ngayDb(n1), now: vn(n1, "17:47") }))]).toEqual([cs.CS1]);
    expect(await coNgl(gv, n1, "17:47", "CS1")).toBe(false);
    // Việc ở CS1 (BẬT) nhưng QUÉT ở CS2 (TẮT) ⇒ luật cũ: cổng là nơi của LƯỢT, không chỉ nơi của việc.
    expect((await huong(gv, n1, "17:50", "CS2")).cheDo).toBe("CA");
    // CS2: tiết đã nhận y hệt — nhưng CS2 TẮT ⇒ luật cũ.
    const n2 = "2026-11-03";
    await buoi(n2, "CS2");
    const h2 = await huong(gv, n2, "17:47", "CS2");
    expect(h2.cheDo).toBe("CA");
    expect(await nc.docNguCanhChamCong({ userId: gv, workLocationId: wl.CS2, huong: h2, now: vn(n2, "17:47") })).toBeNull();
    expect((await cvhl.coSoCoViecParttime({ userId: gv, workDate: ngayDb(n2), now: vn(n2, "17:47") })).size).toBe(0);
    expect(await coNgl(gv, n2, "17:47", "CS2")).toBe(true);
    // Đối chứng dương: bật CS2 ⇒ cùng hình dạng, ngày khác ⇒ Parttime.
    await dat("ATTENDANCE_CONTEXT", false, { CS1: true, CS2: true });
    const n3 = "2026-11-04";
    await buoi(n3, "CS2");
    expect((await huong(gv, n3, "17:47", "CS2")).cheDo).toBe("PARTTIME");
    expect(await coNgl(gv, n3, "17:47", "CS2")).toBe(false);
  });

  it("[FLAG-CENTER-02] phân công BẬT riêng CS1 ⇒ buổi CS1 dựng phân công, buổi CS2 KHÔNG; thao tác QLCS ở CS2 bị từ chối 'chưa bật'", async () => {
    await dat("STAFFING", false, { CS1: true });
    expect((await buoi("2026-11-05", "CS1")).soPhanCong).toBe(1);
    expect((await buoi("2026-11-05", "CS2")).soPhanCong).toBe(0);
    expect(await ct.congThaoTacParttime("STAFFING", { centerId: cs.CS2 }, "chưa bật")).toEqual({ ok: false, error: "chưa bật", ma: "CHUA_BAT" });
    expect(await ct.congThaoTacParttime("STAFFING", { centerId: cs.CS1 }, "chưa bật")).toEqual({ ok: true });
    // Ghi đè TẮT thắng mặc định BẬT.
    await dat("STAFFING", true, { CS2: false });
    expect((await buoi("2026-11-06", "CS2")).soPhanCong).toBe(0);
    expect((await buoi("2026-11-06", "CS1")).soPhanCong).toBe(1);
  });

  it("[FLAG-SPLIT-01] chấm công theo ngữ cảnh BẬT KHÔNG kéo theo phân công (M-FLAG-02): tạo buổi không dựng gì, QLCS không phân được", async () => {
    await dat("ATTENDANCE_CONTEXT", true);
    await dat("WORKUNIT_SHADOW", true);
    await dat("COMPENSATION", true);
    expect((await buoi("2026-11-09", "CS1")).soPhanCong).toBe(0);
    expect((await ct.congThaoTacParttime("STAFFING", { centerId: cs.CS1 }, "x")).ok).toBe(false);
    expect(await ct.congTacHieuLuc("STAFFING", { centerId: cs.CS1 })).toBe(false);
  });

  it("[FLAG-COMP-01] chạy bóng BẬT, tiền TẮT ⇒ quyết khoản tiền bị từ chối; tiền BẬT riêng một cơ sở ⇒ chỉ cơ sở đó (M-FLAG-03)", async () => {
    await dat("STAFFING", true);
    await dat("WORKUNIT_SHADOW", true);
    expect((await ct.congThaoTacParttime("WORKUNIT_SHADOW", { centerId: cs.CS1 }, "x")).ok).toBe(true);
    expect(await ct.congThaoTacParttime("COMPENSATION", { centerId: cs.CS1 }, "tiền tắt")).toEqual({ ok: false, error: "tiền tắt", ma: "CHUA_BAT" });
    await dat("COMPENSATION", false, { CS2: true });
    expect((await ct.congThaoTacParttime("COMPENSATION", { centerId: cs.CS1 }, "x")).ok).toBe(false);
    expect((await ct.congThaoTacParttime("COMPENSATION", { centerId: cs.CS2 }, "x")).ok).toBe(true);
  });

  it("[RBAC-V2-01] RBAC v1 ⇒ phân công / chạy bóng / tiền FAIL CLOSED (RBAC_V2_REQUIRED_FOR_PARTTIME, đường tự động không ghi); chấm công theo ngữ cảnh KHÔNG bị chặn", async () => {
    for (const loai of Object.keys(K) as Loai[]) await dat(loai, true);
    const n = "2026-11-10";
    await buoi(n, "CS1"); // dựng dưới v2
    ctl.rbac = false;
    for (const loai of ["STAFFING", "WORKUNIT_SHADOW", "COMPENSATION"] as const) {
      const r = await ct.congThaoTacParttime(loai, { centerId: cs.CS1 }, "x");
      expect(r, loai).toMatchObject({ ok: false, ma: "RBAC_V2_REQUIRED_FOR_PARTTIME" });
      expect(await ct.congTacHieuLuc(loai, { centerId: cs.CS1 }), loai).toBe(false);
    }
    expect((await buoi("2026-11-11", "CS1")).soPhanCong).toBe(0);
    // Lượt chấm công của chính mình không bao giờ hỏng vì cờ quyền.
    expect((await huong(gv, n, "17:47", "CS1")).cheDo).toBe("PARTTIME");
    expect(await coNgl(gv, n, "17:47", "CS1")).toBe(false);
  });

  it("[FLAG-NORMAL-01] nhân sự CHỈ có ô ca: công tắc tắt mọi nơi ⇒ KHÔNG câu tra nào chạm bảng Parttime; CS1 thí điểm ⇒ hướng / cờ / thẻ y như cũ (số câu tra GHIM)", async () => {
    const n = "2026-11-12";
    await db.shiftAssignment.create({ data: { userId: nv, centerId: cs.CS1, workDate: ngayDb(n), templateId: mauC, templateCode: `${TAG}-C`, segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] } });
    const doLuot = async () => {
      ctl.bang = [];
      const h = await huong(nv, n, "13:40", "CS1");
      const the = await nc.docNguCanhChamCong({ userId: nv, workLocationId: wl.CS1, huong: h, now: vn(n, "13:40") });
      return { h, the, bang: [...ctl.bang] };
    };
    const tat = await doLuot();
    expect(tat.h.cheDo).toBe("CA");
    expect(tat.the).toBeNull();
    expect(tat.bang.filter((b) => BANG_PARTTIME.includes(b))).toEqual([]);
    // Đo 18/10/2026: 9 thao tác (bản trước tách công tắc: 7 — thêm MỘT lượt đọc ghi đè `CenterSetting` cho mỗi lần hỏi công tắc;
    // trên prod cả hai nằm trong cache `settings` 300 s).
    expect(tat.bang.length).toBe(9);

    await dat("ATTENDANCE_CONTEXT", false, { CS1: true });
    const bat = await doLuot();
    expect(bat.h).toMatchObject({ cheDo: "CA", huong: tat.h.huong });
    // Thẻ ngữ cảnh: người không có việc Parttime ⇒ không thẻ (hành vi cũ). Giá của thí điểm, GHIM để không âm thầm tăng:
    // cổng hướng tra 2 bảng phân công + chính sách; thẻ tra bằng chứng của chính mình (có thể rỗng).
    expect(bat.the?.contexts ?? []).not.toContain("TEACHING");
    expect(bat.bang.filter((b) => ["SessionStaffAssignment", "OperationsDutyAssignment"].includes(b))).toHaveLength(4);
    expect(bat.bang.length).toBe(21);
    expect(await coNgl(nv, n, "13:40", "CS1")).toBe(false);
  });

  it("[READY-01] checkParttimeReadiness: RBAC v1 ⇒ GHI BLOCKED (nêu lý do); v2 + đủ bảng + đủ migration ⇒ READY; ghi đè hiện kèm cơ sở", async () => {
    await dat("STAFFING", false, { CS1: true });
    ctl.rbac = false;
    const v1 = await ss.checkParttimeReadiness({ now: vn("2026-11-12", "09:00") });
    expect(v1.rbacV2).toBe(false);
    expect(v1.ghi).toBe("BLOCKED");
    expect(v1.lyDoChan.join(" ")).toContain("RBAC_V2_REQUIRED_FOR_PARTTIME");
    ctl.rbac = true;
    const v2 = await ss.checkParttimeReadiness({ now: vn("2026-11-12", "09:00") });
    expect(v2).toMatchObject({ rbacV2: true, schemaReady: true, bangThieu: [], ghi: "READY", lyDoChan: [], policyVersion: { code: "SR.QD.238", loai: "SR_QD_238" } });
    expect(v2.migrationState.thieu).toEqual([]);
    expect(v2.congTac.STAFFING).toEqual({ macDinh: false, ghiDe: [{ orgUnitId: ou.CS1, centerId: cs.CS1, bat: true }] });
    expect(v2.congTac.COMPENSATION).toEqual({ macDinh: false, ghiDe: [] });
  });
});
