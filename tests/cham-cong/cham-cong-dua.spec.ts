// [RACE-*] H2 — hai / ba lượt bấm "Chấm công" SONG SONG của CÙNG một người — Postgres THẬT.
//   · RACE-01..05: qua ĐÚNG Server Action `recordCheckin` (vé thật, mỗi lượt một vé — tiêu vé nguyên tử giữ nguyên), đồng hồ thật.
//     Người KHÔNG ô ca ⇒ hướng xen kẽ theo hiện diện, không phụ thuộc giờ chạy (luật 19).
//   · RACE-06..09: qua lõi `ghiLuotTuanTu` với mốc TIÊM (luật 19) — ca thường / chỉ dạy / dạy + trực.
// "Lượt VÀO hợp lệ" = ACCEPTED, hướng VÀO, KHÔNG mang `TRUNG_2_PHUT` (engine bỏ lượt trùng). Mỗi phản hồi phải nói ĐÚNG lượt đã lưu:
// tập (hướng, trùng) trả về == tập (direction, có cờ trùng) trong DB.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/cham-cong-dua] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const h = vi.hoisted(() => ({ userId: "", ghiDe: {} as Record<string, unknown> }));
vi.mock("@/lib/auth", () => ({ auth: async () => (h.userId ? { user: { id: h.userId, name: "dua", email: "dua@x.test", role: "TEACHER", roles: ["TEACHER"] } } : null) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async () => true }));
vi.mock("next/cache", async (goc) => ({ ...(await goc<typeof import("next/cache")>()), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// Mỗi lượt một "máy" mới: cookie trống ⇒ action cấp khoá thiết bị mới (RACE-04).
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest-dua" }), cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return { ...goc, getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) => (key in h.ghiDe ? h.ghiDe[key] : goc.getSetting(key as never, opts))) as typeof goc.getSetting };
});

const TAG = "duaccc";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const TRUNG = "TRUNG_2_PHUT";

d("[RACE] lượt bấm song song — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let tl: typeof import("../../lib/cham-cong/timelog");
  let ci: typeof import("../../lib/attendance/checkin-action");
  let lt: typeof import("../../lib/cham-cong/ghi-luot-tuan-tu");
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let truc: typeof import("../../lib/parttime/truc-van-hanh-db");
  let cs1 = "";
  let wl1 = "";
  let khoa = "";
  let mauC = "";
  let soNguoi = 0;
  let soLop = 0;
  const actor = { id: null as string | null, name: "dua" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238");
    await db.compensationPolicyVersion.upsert({ where: { code: "LEGACY" }, update: {}, create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } } });
    await db.compensationPolicyVersion.upsert({ where: { code: "SR.QD.238" }, update: {}, create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) } });
  }

  async function cleanup() {
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    for (const u of ids) await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `attday:${u}:` } } });
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    const dutyIds = (await db.operationsDutyAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: [...pcIds, ...dutyIds] } } });
    await db.$transaction([
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER USER`,
      db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER USER`,
      db.$executeRaw`ALTER TABLE "OperationsDutyAcceptance" DISABLE TRIGGER USER`,
      db.operationsDutyAcceptance.deleteMany({ where: { dutyId: { in: dutyIds } } }),
      db.$executeRaw`ALTER TABLE "OperationsDutyAcceptance" ENABLE TRIGGER USER`,
    ]);
    await db.operationsDutyAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.attendanceTicket.deleteMany({ where: { userId: { in: ids } } });
    await db.staffDevice.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeEach(() => {
    h.ghiDe = { "shift.phanCongNhanLopBat": true };
    h.userId = "";
  });

  beforeAll(async () => {
    await damBaoChinhSach();
    tl = await import("../../lib/cham-cong/timelog");
    ci = await import("../../lib/attendance/checkin-action");
    lt = await import("../../lib/cham-cong/ghi-luot-tuan-tu");
    dongBo = await import("../../lib/parttime/dong-bo");
    svc = await import("../../lib/parttime/phan-cong-db");
    truc = await import("../../lib/parttime/truc-van-hanh-db");
    const c = await db.center.upsert({ where: { slug: `${TAG}-cs1` }, update: {}, create: { slug: `${TAG}-cs1`, name: "CS dua", address: "x", code: `${TAG.toUpperCase()}-CS1` }, select: { id: true } });
    cs1 = c.id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs1` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs1`, name: "ĐV dua", path: `/${TAG}-cs1/`, depth: 0, centerId: cs1 } });
    wl1 = (await db.workLocation.upsert({ where: { code: `${TAG}-cs1` }, update: {}, create: { code: `${TAG}-cs1`, name: "Quầy dua", centerId: cs1 }, select: { id: true } })).id;
    await cleanup();
    khoa = (await db.course.create({ data: { name: "Sata 4 dua", slug: `${TAG}-k` }, select: { id: true } })).id;
    mauC = (
      await db.shiftTemplate.upsert({
        where: { code_effectiveFrom: { code: `${TAG}-C`, effectiveFrom: new Date("2000-01-01T00:00:00Z") } },
        update: {},
        create: { code: `${TAG}-C`, name: "Ca chiều dua", segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] },
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
  const nguoiMoi = async () => (await db.user.create({ data: { email: `u${++soNguoi}@${TAG}.test`, name: `NV dua ${soNguoi}`, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs1 }, select: { id: true } })).id;
  const bam = async (userId: string) => {
    const v = await tl.issueTicket({ userId, workLocationId: wl1 });
    return ci.recordCheckin({ ticketId: v.ticketId, nonce: v.nonce });
  };
  const luot = (userId: string) => db.staffTimeLog.findMany({ where: { userId, result: "ACCEPTED" }, orderBy: [{ loggedAt: "asc" }, { id: "asc" }], select: { direction: true, flags: true } });
  const vaoHopLe = (ls: { direction: string; flags: string[] }[]) => ls.filter((l) => l.direction === "CHECK_IN" && !l.flags.includes(TRUNG)).length;
  /** Tập (hướng, trùng) MỖI phản hồi nói == tập (direction, có cờ trùng) ĐÃ LƯU — máy chủ trả đúng lượt nó ghi. */
  const khop = (ra: { huong: string; trung: boolean }[], ls: { direction: string; flags: string[] }[]) =>
    expect(ra.map((x) => `${x.huong}|${x.trung}`).sort()).toEqual(ls.map((l) => `${l.direction}|${l.flags.includes(TRUNG)}`).sort());
  const okHet = <T extends { ok: boolean }>(rs: T[]) => {
    for (const r of rs) expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    return rs as Extract<T, { ok: true }>[];
  };

  it("[RACE-01][RACE-03] HAI lượt song song (hai vé hợp lệ riêng) ⇒ TỐI ĐA một VÀO hợp lệ; lượt kia là TRÙNG (không thành RA); phản hồi == DB", async () => {
    const u = await nguoiMoi();
    h.userId = u;
    const rs = okHet(await Promise.all([bam(u), bam(u)]));
    const ls = await luot(u);
    expect(ls.map((l) => l.direction)).toEqual(["CHECK_IN", "CHECK_IN"]);
    expect(vaoHopLe(ls)).toBe(1);
    khop(rs, ls);
    expect(await db.attendanceTicket.count({ where: { userId: u, consumedAt: { not: null } } })).toBe(2);
  });

  it("[RACE-02] BA lượt song song ⇒ không có hai VÀO hợp lệ", async () => {
    const u = await nguoiMoi();
    h.userId = u;
    const rs = okHet(await Promise.all([bam(u), bam(u), bam(u)]));
    const ls = await luot(u);
    expect(ls).toHaveLength(3);
    expect(vaoHopLe(ls)).toBe(1);
    expect(ls.every((l) => l.direction === "CHECK_IN")).toBe(true);
    khop(rs, ls);
  });

  it("[RACE-03b] CÙNG một vé gửi hai lần song song ⇒ đúng MỘT lượt được ghi (vé dùng một lần giữ nguyên)", async () => {
    const u = await nguoiMoi();
    h.userId = u;
    const v = await tl.issueTicket({ userId: u, workLocationId: wl1 });
    const rs = await Promise.all([ci.recordCheckin({ ticketId: v.ticketId, nonce: v.nonce }), ci.recordCheckin({ ticketId: v.ticketId, nonce: v.nonce })]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.staffTimeLog.count({ where: { userId: u, result: "ACCEPTED" } })).toBe(1);
  });

  it("[RACE-04] chế độ thiết bị QUAN SÁT, mỗi lượt một máy khác ⇒ vẫn một VÀO hợp lệ; cờ thiết bị giữ nguyên trên cả hai", async () => {
    h.ghiDe["shift.thietBiCheDo"] = "OBSERVE";
    const u = await nguoiMoi();
    h.userId = u;
    const rs = okHet(await Promise.all([bam(u), bam(u)]));
    const ls = await luot(u);
    expect(vaoHopLe(ls)).toBe(1);
    khop(rs, ls);
    expect(await db.staffDevice.count({ where: { userId: u } })).toBe(2);
    // Gắn thiết bị vào vé (P2.3) còn nguyên; đăng ký máy đã tuần tự sẵn (`khoaNguoi`) ⇒ máy ĐẦU tự tin cậy, máy sau CHƯA tin cậy.
    expect(await db.attendanceTicket.count({ where: { userId: u, deviceId: { not: null } } })).toBe(2);
    expect(ls.filter((l) => l.flags.includes("THIET_BI_CHUA_TIN_CAY"))).toHaveLength(1);
  });

  it("[RACE-05] hai lượt cách 200ms ⇒ lượt sau là TRÙNG theo `shift.duplicateTapMinutes`, KHÔNG thành RA chỉ vì lượt đầu đã commit", async () => {
    const u = await nguoiMoi();
    h.userId = u;
    const p1 = bam(u);
    await new Promise((r) => setTimeout(r, 200));
    const p2 = bam(u);
    const rs = okHet(await Promise.all([p1, p2]));
    const ls = await luot(u);
    expect(ls.map((l) => l.direction)).toEqual(["CHECK_IN", "CHECK_IN"]);
    expect(rs.map((r) => r.huong)).toEqual(["CHECK_IN", "CHECK_IN"]);
    expect(rs[1]?.trung).toBe(true);
    khop(rs, ls);
  });

  // ── lõi với mốc tiêm ──
  const ghi = (userId: string, now: Date) => lt.ghiLuotTuanTu({ userId, workLocationId: wl1, now });
  const songSong = async (userId: string, now: Date, n = 2) => {
    const rs = await Promise.all(Array.from({ length: n }, () => ghi(userId, now)));
    for (const x of rs) expect(x.r.ok).toBe(true);
    return rs.map((x) => ({ huong: x.suy.huong, trung: x.suy.trung, cheDo: x.suy.cheDo }));
  };
  const luotNgay = (userId: string, ymd: string) =>
    db.staffTimeLog.findMany({ where: { userId, workDate: ngayDb(ymd), result: "ACCEPTED" }, orderBy: [{ loggedAt: "asc" }, { id: "asc" }], select: { direction: true, flags: true } });

  it("[RACE-06] lượt hợp lệ SAU cửa sổ trùng ⇒ RA (không bị nuốt thành trùng)", async () => {
    const u = await nguoiMoi();
    const ngay = "2026-11-02";
    await songSong(u, vn(ngay, "09:00"));
    const r = await ghi(u, vn(ngay, "09:05"));
    expect([r.suy.huong, r.suy.trung]).toEqual(["CHECK_OUT", false]);
    expect((await luotNgay(u, ngay)).map((l) => `${l.direction}|${l.flags.includes(TRUNG)}`)).toEqual(["CHECK_IN|false", "CHECK_IN|true", "CHECK_OUT|false"]);
  });

  const buoi = async (gv: string, ymd: string) => {
    soLop++;
    const lop = await db.class.create({ data: { name: `${TAG} L${soLop}`, classCode: `DUA-L${soLop}`, courseId: khoa, centerId: cs1, teacherId: gv, startTime: "18:00", endTime: "19:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs1, status: "SCHEDULED", date: vn(ymd, "18:00") }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    for (const pc of await db.sessionStaffAssignment.findMany({ where: { sourceId: s.id, status: "WAITING_ACCEPTANCE" } })) {
      const r = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: pc.userId, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
      if (!r.ok) throw new Error(r.loi);
    }
  };

  it("[RACE-07] CHỈ dạy (Parttime): hai lượt song song 17:47 ⇒ một VÀO hợp lệ (cheDo PARTTIME); 19:35 ⇒ RA", async () => {
    const u = await nguoiMoi();
    const ngay = "2026-11-03";
    await buoi(u, ngay);
    const rs = await songSong(u, vn(ngay, "17:47"));
    expect(rs.every((x) => x.cheDo === "PARTTIME")).toBe(true);
    const ls = await luotNgay(u, ngay);
    expect(vaoHopLe(ls)).toBe(1);
    khop(rs, ls);
    expect((await ghi(u, vn(ngay, "19:35"))).suy.huong).toBe("CHECK_OUT");
  });

  it("[RACE-08] nhân viên CA THƯỜNG: hành vi cũ (cheDo CA) — hai lượt song song 13:40 ⇒ một VÀO hợp lệ; 17:35 ⇒ RA", async () => {
    const u = await nguoiMoi();
    const ngay = "2026-11-04";
    await db.shiftAssignment.create({ data: { userId: u, centerId: cs1, workDate: ngayDb(ngay), templateId: mauC, templateCode: `${TAG}-C`, segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] } });
    const rs = await songSong(u, vn(ngay, "13:40"));
    expect(rs.every((x) => x.cheDo === "CA")).toBe(true);
    const ls = await luotNgay(u, ngay);
    expect(vaoHopLe(ls)).toBe(1);
    khop(rs, ls);
    expect((await ghi(u, vn(ngay, "17:35"))).suy.huong).toBe("CHECK_OUT");
  });

  it("[RACE-09] dạy + trực (MIXED): BA lượt song song 17:10 ⇒ một VÀO hợp lệ; 21:05 ⇒ RA", async () => {
    const u = await nguoiMoi();
    const ngay = "2026-11-05";
    const g = await db.$transaction((tx) => truc.giaoTruc(tx, { userId: u, centerId: cs1, ngay, shiftCode: "T", note: null, actor: { id: u, name: "x" } }));
    if (!g.ok) throw new Error(g.loi);
    await db.$transaction((tx) => truc.quyetDinhTruc(tx, { dutyId: g.id, nguoiBam: { id: u, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn(ngay, "07:00") }));
    await buoi(u, ngay);
    const rs = await songSong(u, vn(ngay, "17:10"), 3);
    const ls = await luotNgay(u, ngay);
    expect(vaoHopLe(ls)).toBe(1);
    khop(rs, ls);
    expect((await ghi(u, vn(ngay, "21:05"))).suy.huong).toBe("CHECK_OUT");
  });
});
