// [UAT-*] H4 — UAT CÓ KIỂM SOÁT của mô hình công Parttime, đầu-cuối trên Postgres THẬT (DB cục bộ riêng), dữ liệu cô lập theo TAG.
// Mỗi lượt bấm đi qua ĐÚNG đường ghi thật `ghiLuotTuanTu` (khoá + suy hướng + ghi) với mốc TIÊM (17:47 / 19:35… — trình duyệt thật
// không đặt được đồng hồ). Mỗi lượt ghi lại BA hướng: dự đoán của trang (`suyHuongHomNay` ngoài khoá) · máy chủ trả · `StaffTimeLog`.
// Chuỗi đầy đủ: phân công → nhận → ngữ cảnh màn Chấm công → bấm → cờ → bằng chứng P4 → đối soát + xác nhận P5 → WorkUnit → trực →
// nhận xét / hạn → đề xuất điều chỉnh → báo cáo tháng (tổng == chi tiết == WorkUnit trong DB).
// Màn hình 375 / 768 / 1512 + một nút: `tests/manual/ctx-bam-thu.ts` (trình duyệt thật) — xem docs/cham-cong/parttime/10-CONTROLLED-UAT.md.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-uat-kiem-soat] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return { ...goc, getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) => (/^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts))) as typeof goc.getSetting };
});
// Cổng RBAC v2 của Parttime giả BẬT (prod/test chạy v2); `checkPermission` vẫn chạy theo cờ thật của môi trường test.
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const TAG = "uatpt";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const sau = (ymd: string, n: number, hhmm: string) => {
  const [y, m, dd] = ymd.split("-").map(Number);
  return vn(new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10), hhmm);
};
const P = ["GV-MAIN", "GV-TA", "GV-SUB", "GV-MAKEUP", "GV-DUTY", "GV-MIXED", "GV-2LESSON", "NORMAL", "QLCS-CS1", "QLCS-CS2"] as const;
type Ten = (typeof P)[number];
type LuotGhi = { uat: string; nguoi: Ten; gio: string; duDoan: string; mayChu: string; daLuu: string; co: string[] };

d("[UAT] Parttime — UAT có kiểm soát, Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let truc: typeof import("../../lib/parttime/truc-van-hanh-db");
  let wu: typeof import("../../lib/parttime/workunit-db");
  let dc: typeof import("../../lib/parttime/dieu-chinh-db");
  let bc: typeof import("../../lib/parttime/bao-cao-thang-db");
  let bcc: typeof import("../../lib/parttime/bang-chung-cong-db");
  let nc: typeof import("../../lib/parttime/ngu-canh-cham-cong-db");
  let ncT: typeof import("../../lib/parttime/ngu-canh-cham-cong");
  let sh: typeof import("../../lib/cham-cong/suy-huong-db");
  let lt: typeof import("../../lib/cham-cong/ghi-luot-tuan-tu");
  const id = {} as Record<Ten, string>;
  let cs1 = "";
  let cs2 = "";
  let wl1 = "";
  let khoa = "";
  let bai = "";
  let mauC = "";
  const hv: string[] = [];
  let soLop = 0;
  const luotGhi: LuotGhi[] = [];
  const actor = { id: null as string | null, name: "UAT" };
  const QL = () => ({ id: id["QLCS-CS1"], name: "UAT-QLCS-CS1" });

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
    const wus = (await db.workUnit.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((w) => w.id);
    const adj = (await db.compensationAdjustment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((a) => a.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: [...pcIds, ...dutyIds, ...wus, ...adj] } } });
    await db.compensationAdjustment.deleteMany({ where: { userId: { in: ids } } });
    await db.workUnit.deleteMany({ where: { userId: { in: ids } } });
    await db.$transaction([
      db.$executeRaw`ALTER TABLE "WorkConfirmation" DISABLE TRIGGER USER`,
      db.workConfirmation.deleteMany({ where: { assignmentId: { in: [...pcIds, ...dutyIds] } } }),
      db.$executeRaw`ALTER TABLE "WorkConfirmation" ENABLE TRIGGER USER`,
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER USER`,
      db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
      db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER USER`,
      db.$executeRaw`ALTER TABLE "OperationsDutyAcceptance" DISABLE TRIGGER USER`,
      db.operationsDutyAcceptance.deleteMany({ where: { dutyId: { in: dutyIds } } }),
      db.$executeRaw`ALTER TABLE "OperationsDutyAcceptance" ENABLE TRIGGER USER`,
    ]);
    await db.operationsDutyAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffAttendanceDay.deleteMany({ where: { userId: { in: ids } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.shiftAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const ses = (await db.classSession.findMany({ where: { classId: { in: cls.map((c) => c.id) } }, select: { id: true } })).map((s) => s.id);
    await db.studentSessionFeedback.deleteMany({ where: { classSessionId: { in: ses } } });
    await db.attendance.deleteMany({ where: { sessionId: { in: ses } } });
    await db.makeupCase.deleteMany({ where: { teacherId: { in: ids } } });
    await db.classSession.deleteMany({ where: { id: { in: ses } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.student.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    dongBo = await import("../../lib/parttime/dong-bo");
    svc = await import("../../lib/parttime/phan-cong-db");
    truc = await import("../../lib/parttime/truc-van-hanh-db");
    wu = await import("../../lib/parttime/workunit-db");
    dc = await import("../../lib/parttime/dieu-chinh-db");
    bc = await import("../../lib/parttime/bao-cao-thang-db");
    bcc = await import("../../lib/parttime/bang-chung-cong-db");
    nc = await import("../../lib/parttime/ngu-canh-cham-cong-db");
    ncT = await import("../../lib/parttime/ngu-canh-cham-cong");
    sh = await import("../../lib/cham-cong/suy-huong-db");
    lt = await import("../../lib/cham-cong/ghi-luot-tuan-tu");
    const mkCs = async (s: string) => {
      const c = await db.center.upsert({ where: { slug: `${TAG}-${s}` }, update: {}, create: { slug: `${TAG}-${s}`, name: `CS UAT ${s}`, address: "x", code: `${TAG.toUpperCase()}-${s.toUpperCase()}` }, select: { id: true } });
      await db.orgUnit.upsert({ where: { code: `${TAG}-${s}` }, update: {}, create: { type: "CENTER", code: `${TAG}-${s}`, name: `ĐV UAT ${s}`, path: `/${TAG}-${s}/`, depth: 0, centerId: c.id } });
      // Điểm chấm ĐÃ khai toạ độ + bật định vị như prod (đo 14/10: không lượt nào mang CHUA_TOA_DO) — thiếu toạ độ thì MỌI lượt mang cờ
      // ⇒ P4 `canhBaoLuot` ⇒ P5 đẩy mọi tiết sang XEM_TAY (đã thấy ở lượt UAT đầu tiên).
      const geo = { latitude: 16.04, longitude: 108.22, radiusMeters: 150, geofenceEnabled: true };
      const w = await db.workLocation.upsert({ where: { code: `${TAG}-${s}` }, update: geo, create: { code: `${TAG}-${s}`, name: `Quầy UAT ${s}`, centerId: c.id, ...geo }, select: { id: true } });
      return [c.id, w.id] as const;
    };
    [cs1, wl1] = await mkCs("cs1");
    [cs2] = await mkCs("cs2");
    await cleanup();
    for (const t of P) {
      id[t] = (await db.user.create({ data: { email: `${t.toLowerCase()}@${TAG}.test`, name: `UAT-${t}`, role: t.startsWith("QLCS") ? "CENTER_MANAGER" : "TEACHER", roles: [t.startsWith("QLCS") ? "CENTER_MANAGER" : "TEACHER"], password: "x", centerId: t === "QLCS-CS2" ? cs2 : cs1 }, select: { id: true } })).id;
    }
    khoa = (await db.course.create({ data: { name: "Sata 4 UAT", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT UAT" }, select: { id: true } });
    bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
    for (const i of [1, 2]) hv.push((await db.student.create({ data: { name: `${TAG} hv${i}`, centerId: cs1 }, select: { id: true } })).id);
    mauC = (
      await db.shiftTemplate.upsert({
        where: { code_effectiveFrom: { code: `${TAG}-C`, effectiveFrom: new Date("2000-01-01T00:00:00Z") } },
        update: {},
        create: { code: `${TAG}-C`, name: "Ca chiều UAT", segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] },
        select: { id: true },
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    // Bảng lượt bấm cho báo cáo UAT (dự đoán · máy chủ · đã lưu).
    console.log(`[UAT-TAPS]\n${luotGhi.map((l) => `${l.uat} ${l.nguoi} ${l.gio} dự đoán=${l.duDoan} máy chủ=${l.mayChu} đã lưu=${l.daLuu} cờ=[${l.co.join(",")}]`).join("\n")}`);
    await cleanup();
    await db.workLocation.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.shiftTemplate.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  // ── tiện ích ──
  const nhan = async (sourceId: string, userId?: string) => {
    for (const pc of await db.sessionStaffAssignment.findMany({ where: { sourceId, status: "WAITING_ACCEPTANCE", ...(userId ? { userId } : {}) } })) {
      const r = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: pc.userId, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: pc.assignmentVersion }));
      if (!r.ok) throw new Error(r.loi);
    }
  };
  const lop = async (ymd: string, p: { gv: Ten; ta?: Ten; thay?: Ten; tu?: string; den?: string; nhanLuon?: boolean }) => {
    soLop++;
    const l = await db.class.create({ data: { name: `${TAG} L${soLop}`, classCode: `UAT-L${soLop}`, courseId: khoa, centerId: cs1, teacherId: id[p.gv], assistantId: p.ta ? id[p.ta] : null, startTime: p.tu ?? "18:00", endTime: p.den ?? "19:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: l.id, centerId: cs1, status: "SCHEDULED", date: vn(ymd, p.tu ?? "18:00"), substituteTeacherId: p.thay ? id[p.thay] : null }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
    if (p.nhanLuon !== false) await nhan(s.id);
    return { sessionId: s.id, classCode: `UAT-L${soLop}` };
  };
  /** Buổi đã dạy xong: chốt + điểm danh 2 HV (+ nhận xét nếu có mốc). */
  const chot = async (sessionId: string, thucDay: Ten, nhanXetLuc?: Date) => {
    await db.classSession.update({ where: { id: sessionId }, data: { status: "COMPLETED", actualTeacherId: id[thucDay] } });
    for (const h of hv) await db.attendance.create({ data: { sessionId, studentId: h, status: "PRESENT" } });
    if (nhanXetLuc) for (const h of hv) await db.studentSessionFeedback.create({ data: { classSessionId: sessionId, studentId: h, createdById: id[thucDay], comment: "Tốt", createdAt: nhanXetLuc } });
  };
  const giaoTruc = async (u: Ten, ymd: string) => {
    const g = await db.$transaction((tx) => truc.giaoTruc(tx, { userId: id[u], centerId: cs1, ngay: ymd, shiftCode: "T", note: null, actor: QL() }));
    if (!g.ok) throw new Error(g.loi);
    await db.$transaction((tx) => truc.quyetDinhTruc(tx, { dutyId: g.id, nguoiBam: { id: id[u], name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1, lyDo: null, now: vn(ymd, "07:00") }));
    return g.id;
  };
  /** MỘT lượt bấm: dự đoán của trang (ngoài khoá) → ĐƯỜNG GHI THẬT → lượt đã lưu. Ba hướng phải khớp (không có đua ở đây). */
  const cham = async (uat: string, u: Ten, ymd: string, hhmm: string) => {
    const now = vn(ymd, hhmm);
    const duDoan = await sh.suyHuongHomNay({ userId: id[u], workLocationId: wl1, now });
    const g = await lt.ghiLuotTuanTu({ userId: id[u], workLocationId: wl1, now, latitude: 16.0401, longitude: 108.2201, accuracyMeters: 20 });
    if (!g.r.ok) throw new Error(g.r.error);
    const luu = await db.staffTimeLog.findUniqueOrThrow({ where: { id: g.r.logId }, select: { direction: true, flags: true } });
    luotGhi.push({ uat, nguoi: u, gio: `${ymd} ${hhmm}`, duDoan: duDoan.huong, mayChu: g.suy.huong, daLuu: luu.direction, co: luu.flags });
    expect([duDoan.huong, g.suy.huong], `${uat} ${u} ${hhmm}`).toEqual([luu.direction, luu.direction]);
    return { huong: luu.direction, co: luu.flags, cheDo: g.suy.cheDo };
  };
  const ngu = async (u: Ten, ymd: string, hhmm: string) => {
    const now = vn(ymd, hhmm);
    const h = await sh.suyHuongHomNay({ userId: id[u], workLocationId: wl1, now });
    return nc.docNguCanhChamCong({ userId: id[u], workLocationId: wl1, huong: h, now });
  };
  const dongDoiSoat = async (ymd: string, sourceId: string, u: Ten) =>
    (await wu.docDoiSoatThucHien({ centerId: cs1, tu: ymd, den: ymd, now: vn(ymd, "22:00") })).dong.find((r) => r.bc.sourceId === sourceId && r.bc.userId === id[u]);
  const xacNhanDay = async (ymd: string, sourceId: string, u: Ten) => {
    const r = await dongDoiSoat(ymd, sourceId, u);
    if (!r) throw new Error(`không có dòng đối soát ${u}`);
    const kq = await wu.xacNhanThucHien({ assignmentId: r.bc.assignmentId, phienBanDaXem: r.bc.assignmentVersion, dauVanDaXem: r.bc.dauVan, quyetDinh: "CONFIRMED", lyDo: r.ungVien.lop === "TU_DONG" ? null : "QLCS đã kiểm tra (UAT)", hangLoat: false, actor: QL(), now: vn(ymd, "22:00") });
    if (!kq.ok) throw new Error(kq.loi);
    return { dong: r, wu: await db.workUnit.findUniqueOrThrow({ where: { id: kq.workUnitId! } }) };
  };
  const xacNhanTrucNgay = async (ymd: string, dutyId: string) => {
    const t = (await truc.docTrucCoSo({ centerId: cs1, tu: ymd, den: ymd, now: vn(ymd, "23:00") })).find((x) => x.dutyId === dutyId)!;
    const k = await truc.xacNhanTruc({ dutyId, phienBanDaXem: t.phienBan, dauVanDaXem: t.dauVan, quyetDinh: "CONFIRMED", lyDo: null, hangLoat: false, actor: QL(), now: vn(ymd, "23:00") });
    if (!k.ok) throw new Error(k.loi);
    return { t, wu: await db.workUnit.findUniqueOrThrow({ where: { id: k.workUnitId! } }) };
  };
  const donViDay = (u: Ten) => db.workUnit.findMany({ where: { userId: id[u], workUnitType: { in: ["MAIN_TEACHING", "ASSISTANT_TEACHING"] }, status: { not: "VOIDED" } } });
  const donViTruc = (u: Ten) => db.workUnit.findMany({ where: { userId: id[u], workUnitType: "OPERATIONS_DUTY", status: { not: "VOIDED" } } });

  it("[UAT-01][UAT-02] CHỈ đứng chính 18:00–19:30 (không ô ca, không trực) + trợ giảng: thẻ, 17:47 VÀO, 19:35 RA, không cờ ngoài lịch, P4 đủ, P5 1 MAIN 100' + 1 TA, 0 trực", async () => {
    const ngay = "2026-11-02";
    const { sessionId, classCode } = await lop(ngay, { gv: "GV-MAIN", ta: "GV-TA" });
    const the = await ngu("GV-MAIN", ngay, "17:40");
    expect(the).toMatchObject({ primary: "TEACHING", contexts: ["TEACHING_MAIN"], operationsDuty: null, nextTeaching: { tieuDe: "GIÁO VIÊN ĐỨNG CHÍNH", nhanLop: classCode, gio: "18:00–19:30", coMatTruoc: "17:50" } });
    expect(the && ncT.hienKhoiNguCanh(the)).toBe(true);
    expect(the?.warnings.map((w) => w.ma)).toEqual([]);
    expect((await ngu("GV-TA", ngay, "17:40"))?.nextTeaching).toMatchObject({ tieuDe: "TRỢ GIẢNG" });
    for (const [u, vao, ra] of [["GV-MAIN", "17:47", "19:35"], ["GV-TA", "17:45", "19:36"]] as const) {
      const a = await cham("UAT-01/02", u, ngay, vao);
      const b = await cham("UAT-01/02", u, ngay, ra);
      expect([a.huong, b.huong, a.cheDo]).toEqual(["CHECK_IN", "CHECK_OUT", "PARTTIME"]);
      expect([...a.co, ...b.co]).not.toContain("CHAM_NGOAI_LICH");
    }
    await chot(sessionId, "GV-MAIN", vn(ngay, "19:40"));
    const p4 = (await bcc.docBangChungCong({ centerId: cs1, tu: ngay, den: ngay, now: vn(ngay, "22:00") })).phanCong.filter((r) => r.sourceId === sessionId);
    expect(p4.map((r) => [r.role, r.coMat, r.diMuon, r.raSom, r.khopNguoiDay])).toEqual(
      expect.arrayContaining([["MAIN_TEACHER", "DU", false, false, "KHOP"], ["TEACHING_ASSISTANT", "DU", false, false, expect.anything()]]),
    );
    const main = await xacNhanDay(ngay, sessionId, "GV-MAIN");
    expect(main.dong.ungVien).toMatchObject({ lop: "TU_DONG", loai: "MAIN_TEACHING" });
    expect([main.wu.workUnitType, main.wu.activityType, main.wu.quantity.toString(), main.wu.standardMinutes]).toEqual(["MAIN_TEACHING", "REGULAR_CLASS", "1", 100]);
    const ta = await xacNhanDay(ngay, sessionId, "GV-TA");
    expect([ta.wu.workUnitType, ta.wu.quantity.toString()]).toEqual(["ASSISTANT_TEACHING", "1"]);
    expect(await donViTruc("GV-MAIN")).toEqual([]);
  });

  it("[UAT-03] DẠY THAY: lớp của A (GV-MAIN), B (GV-SUB) dạy thay đã nhận ⇒ thẻ B 'DẠY THAY' vai đứng chính; B 1 MAIN (SUBSTITUTE); A 0 đơn vị dạy của buổi", async () => {
    const ngay = "2026-11-03";
    const { sessionId } = await lop(ngay, { gv: "GV-MAIN", thay: "GV-SUB" });
    expect((await ngu("GV-SUB", ngay, "17:40"))?.nextTeaching).toMatchObject({ tieuDe: "DẠY THAY", nhanVai: "Đứng chính" });
    expect((await ngu("GV-MAIN", ngay, "17:40"))?.teaching ?? []).toEqual([]);
    await cham("UAT-03", "GV-SUB", ngay, "17:48");
    await cham("UAT-03", "GV-SUB", ngay, "19:33");
    await chot(sessionId, "GV-SUB", vn(ngay, "19:45"));
    const b = await xacNhanDay(ngay, sessionId, "GV-SUB");
    expect([b.wu.workUnitType, b.wu.assignmentType, b.wu.quantity.toString()]).toEqual(["MAIN_TEACHING", "SUBSTITUTE", "1"]);
    expect(await dongDoiSoat(ngay, sessionId, "GV-MAIN")).toBeUndefined();
    expect((await donViDay("GV-MAIN")).filter((w) => w.sourceId === sessionId)).toEqual([]);
  });

  it("[UAT-04] HỌC BÙ: nhãn HỌC BÙ, một nút, bằng chứng đủ, WorkUnit activityType MAKEUP", async () => {
    const ngay = "2026-11-04";
    const c = await db.makeupCase.create({ data: { centerId: cs1, courseId: khoa, lessonId: bai, date: ngayDb(ngay), startTime: "18:00", endTime: "19:30", teacherId: id["GV-MAKEUP"], status: "SCHEDULED", createdById: id["QLCS-CS1"] }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: c.id }], "TAO_BUOI", actor);
    await nhan(c.id);
    expect((await ngu("GV-MAKEUP", ngay, "17:40"))?.nextTeaching).toMatchObject({ tieuDe: "HỌC BÙ", nhanLop: "Sata 4 UAT" });
    await cham("UAT-04", "GV-MAKEUP", ngay, "17:46");
    await cham("UAT-04", "GV-MAKEUP", ngay, "19:34");
    await db.makeupCase.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
    const w = await xacNhanDay(ngay, c.id, "GV-MAKEUP");
    expect([w.wu.workUnitType, w.wu.activityType, w.wu.sourceType]).toEqual(["MAIN_TEACHING", "MAKEUP", "MAKEUP_CASE"]);
  });

  it("[UAT-05] CHỈ TRỰC (không dạy, không ô ca): không cờ ngoài lịch; VÀO 17:10 / RA 21:05; P5 chỉ có đơn vị TRỰC (đo: 1,0 ca vì 0 tiết trong ca)", async () => {
    const ngay = "2026-11-05";
    const duty = await giaoTruc("GV-DUTY", ngay);
    expect(await ngu("GV-DUTY", ngay, "17:00")).toMatchObject({ primary: "OPERATIONS_DUTY", operationsDuty: { shiftCode: "T", gio: "17:15–21:00" } });
    const a = await cham("UAT-05", "GV-DUTY", ngay, "17:10");
    const b = await cham("UAT-05", "GV-DUTY", ngay, "21:05");
    expect([a.huong, b.huong]).toEqual(["CHECK_IN", "CHECK_OUT"]);
    expect([...a.co, ...b.co]).not.toContain("CHAM_NGOAI_LICH");
    const k = await xacNhanTrucNgay(ngay, duty);
    expect([k.t.danhGia.soTietTrongCa, k.t.danhGia.donViTra, k.wu.workUnitType, k.wu.quantity.toString()]).toEqual([0, "1", "OPERATIONS_DUTY", "1"]);
    expect(await donViDay("GV-DUTY")).toEqual([]);
  });

  it("[UAT-06] DẠY + TRỰC (trực T 17:15–21:00, đứng chính 18:00–19:30): một nút, thẻ có cả hai; VÀO 17:10 + RA 21:05, KHÔNG quét thêm cho tiết; P5 1 MAIN + 0,5 trực", async () => {
    const ngay = "2026-11-06";
    const duty = await giaoTruc("GV-MIXED", ngay);
    const { sessionId } = await lop(ngay, { gv: "GV-MIXED" });
    const the = await ngu("GV-MIXED", ngay, "17:05");
    expect([the?.primary, the?.contexts, the?.operationsDuty?.gio, the?.nextTeaching?.gio]).toEqual(["MIXED", ["TEACHING_MAIN", "OPERATIONS_DUTY"], "17:15–21:00", "18:00–19:30"]);
    await cham("UAT-06", "GV-MIXED", ngay, "17:10");
    await cham("UAT-06", "GV-MIXED", ngay, "21:05");
    expect(await db.staffTimeLog.count({ where: { userId: id["GV-MIXED"], workDate: ngayDb(ngay) } })).toBe(2);
    await chot(sessionId, "GV-MIXED", vn(ngay, "19:40"));
    const m = await xacNhanDay(ngay, sessionId, "GV-MIXED");
    expect([m.wu.workUnitType, m.wu.quantity.toString()]).toEqual(["MAIN_TEACHING", "1"]);
    const k = await xacNhanTrucNgay(ngay, duty);
    expect([k.t.danhGia.soTietTrongCa, k.t.danhGia.donViTra, k.wu.quantity.toString()]).toEqual([1, "0.5", "0.5"]);
  });

  it("[UAT-07] HAI TIẾT liền (17:30–19:00, 19:15–20:45): MỘT VÀO trước tiết đầu + MỘT RA sau tiết cuối ⇒ 2 WorkUnit dạy", async () => {
    const ngay = "2026-11-09";
    const a = await lop(ngay, { gv: "GV-2LESSON", tu: "17:30", den: "19:00" });
    const b = await lop(ngay, { gv: "GV-2LESSON", tu: "19:15", den: "20:45" });
    await cham("UAT-07", "GV-2LESSON", ngay, "17:18");
    await cham("UAT-07", "GV-2LESSON", ngay, "20:50");
    await chot(a.sessionId, "GV-2LESSON", vn(ngay, "19:05"));
    await chot(b.sessionId, "GV-2LESSON", vn(ngay, "20:55"));
    await xacNhanDay(ngay, a.sessionId, "GV-2LESSON");
    await xacNhanDay(ngay, b.sessionId, "GV-2LESSON");
    expect((await donViDay("GV-2LESSON")).filter((w) => w.workDate.toISOString().startsWith(ngay)).map((w) => w.quantity.toString())).toEqual(["1", "1"]);
  });

  it("[UAT-08][UAT-09] NHÂN VIÊN CA THƯỜNG (công tắc BẬT): thẻ cũ, luật hướng cũ; KHÔNG LỊCH: cờ ngoài lịch cũ còn, không sinh phân công giả", async () => {
    const ngay = "2026-11-10";
    await db.shiftAssignment.create({ data: { userId: id.NORMAL, centerId: cs1, workDate: ngayDb(ngay), templateId: mauC, templateCode: `${TAG}-C`, segments: [{ start: "13:45", end: "17:30", kind: "WORK" }] } });
    const the = await ngu("NORMAL", ngay, "13:30");
    expect([the?.primary, the && ncT.hienKhoiNguCanh(the)]).toEqual(["NORMAL_SHIFT", false]);
    const a = await cham("UAT-08", "NORMAL", ngay, "13:40");
    const b = await cham("UAT-08", "NORMAL", ngay, "17:35");
    expect([a.huong, b.huong, a.cheDo]).toEqual(["CHECK_IN", "CHECK_OUT", "CA"]);
    const ngay2 = "2026-11-11";
    const the2 = await ngu("NORMAL", ngay2, "09:00");
    expect([the2?.primary, the2?.warnings.map((w) => w.ma)]).toEqual(["NONE", ["KHONG_LICH"]]);
    expect((await cham("UAT-09", "NORMAL", ngay2, "09:00")).co).toContain("CHAM_NGOAI_LICH");
    expect(await db.sessionStaffAssignment.count({ where: { userId: id.NORMAL } })).toBe(0);
    expect(await db.operationsDutyAssignment.count({ where: { userId: id.NORMAL } })).toBe(0);
  });

  it("[UAT-10] tiết bị HUỶ và tiết bị TỪ CHỐI ⇒ không ngữ cảnh dạy, không ứng viên WorkUnit", async () => {
    const ngay = "2026-11-12";
    const huy = await lop(ngay, { gv: "GV-MAIN" });
    await db.classSession.update({ where: { id: huy.sessionId }, data: { status: "CANCELLED" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: huy.sessionId }], "HUY_BUOI", actor);
    const tc = await lop(ngay, { gv: "GV-MAIN", tu: "19:45", den: "21:15", nhanLuon: false });
    const pc = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: tc.sessionId, userId: id["GV-MAIN"] } });
    const r = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pc.id, nguoiBam: { id: id["GV-MAIN"], name: "x" }, quyetDinh: "DECLINED", phienBanDaXem: pc.assignmentVersion, lyDo: "Bận việc gia đình tối nay" }));
    expect(r.ok).toBe(true);
    expect((await ngu("GV-MAIN", ngay, "17:40"))?.teaching ?? []).toEqual([]);
    const ds = await wu.docDoiSoatThucHien({ centerId: cs1, tu: ngay, den: ngay, now: vn(ngay, "23:00") });
    expect(ds.dong.filter((x) => x.bc.userId === id["GV-MAIN"] && x.ungVien.loai !== null && x.ungVien.lop === "TU_DONG")).toEqual([]);
  });

  it("[UAT-VER] đổi lịch SAU khi nhận ⇒ xác nhận cũ hết hiệu lực, GV thấy 'chưa xác nhận', KHÔNG nhận nhầm bản cũ; nhận lại ⇒ thẻ theo giờ mới", async () => {
    const ngay = "2026-11-13";
    const { sessionId } = await lop(ngay, { gv: "GV-MAIN" });
    const v1 = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: sessionId, userId: id["GV-MAIN"] } });
    await db.classSession.update({ where: { id: sessionId }, data: { date: vn(ngay, "19:00") } });
    const { classId } = await db.classSession.findUniqueOrThrow({ where: { id: sessionId }, select: { classId: true } });
    await db.class.update({ where: { id: classId }, data: { startTime: "19:00", endTime: "20:30" } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: sessionId }], "DOI_LICH_BUOI", actor);
    const v2 = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: sessionId, userId: id["GV-MAIN"], status: { in: ["WAITING_ACCEPTANCE", "ACCEPTED"] } } });
    expect([v2.status, v2.assignmentVersion > v1.assignmentVersion, v2.gioBatDau]).toEqual(["WAITING_ACCEPTANCE", true, "19:00"]);
    expect((await ngu("GV-MAIN", ngay, "17:00"))?.warnings.map((w) => w.ma)).toContain("CHUA_NHAN_LOP");
    const cu = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: v2.id, nguoiBam: { id: id["GV-MAIN"], name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: v1.assignmentVersion }));
    expect(cu.ok).toBe(false);
    await nhan(sessionId);
    expect((await ngu("GV-MAIN", ngay, "17:00"))?.nextTeaching).toMatchObject({ gio: "19:00–20:30", coMatTruoc: "18:50" });
  });

  it("[UAT-CMT][UAT-ADJ] hạn nhận xét 10:00 hôm sau: nộp đúng hạn ⇒ ON_TIME; thiếu sau hạn ⇒ MISSING; đi muộn 8' ⇒ ĐỀ XUẤT (PROPOSED, không tự xác nhận)", async () => {
    const ngay = "2026-11-16";
    const { sessionId } = await lop(ngay, { gv: "GV-MAIN" });
    await cham("UAT-ADJ", "GV-MAIN", ngay, "17:58");
    await cham("UAT-ADJ", "GV-MAIN", ngay, "19:35");
    await chot(sessionId, "GV-MAIN");
    const w = await xacNhanDay(ngay, sessionId, "GV-MAIN");
    const docLuc = (ymd: string, now: Date) => dc.docDieuChinh({ centerId: cs1, tu: ymd, den: ymd, now });
    // Buổi ĐÚNG HẠN riêng của ca này (luật 18 — không mượn buổi của ca khác).
    const ngayDH = "2026-11-17";
    const dh = await lop(ngayDH, { gv: "GV-MAIN" });
    await cham("UAT-CMT", "GV-MAIN", ngayDH, "17:46");
    await cham("UAT-CMT", "GV-MAIN", ngayDH, "19:35");
    await chot(dh.sessionId, "GV-MAIN", vn(ngayDH, "19:40"));
    await xacNhanDay(ngayDH, dh.sessionId, "GV-MAIN");
    const ontime = (await docLuc(ngayDH, sau(ngayDH, 1, "10:01"))).dong.find((x) => x.dong.bc.sourceId === dh.sessionId);
    expect(ontime?.nhanXet?.trangThai).toBe("ON_TIME");
    const truocHan = (await docLuc(ngay, sau(ngay, 1, "09:59"))).dong.find((x) => x.dong.bc.sourceId === sessionId);
    const sauHan = (await docLuc(ngay, sau(ngay, 1, "10:01"))).dong.find((x) => x.dong.bc.sourceId === sessionId);
    expect([truocHan?.nhanXet?.trangThai, sauHan?.nhanXet?.trangThai]).toEqual(["PENDING", "MISSING"]);
    await dc.dongBoDeXuat({ centerId: cs1, tu: ngay, den: ngay, now: sau(ngay, 2, "08:00"), actor: QL() });
    const khoan = await db.compensationAdjustment.findMany({ where: { workUnitId: w.wu.id }, orderBy: { type: "asc" }, select: { type: true, amount: true, status: true, ruleCode: true } });
    expect(khoan.map((k) => [k.type, k.amount, k.status])).toEqual([["LATE_ARRIVAL", -10000, "PROPOSED"], ["MISSING_SESSION_COMMENT", -30000, "PROPOSED"]]);
    expect(await db.compensationAdjustment.count({ where: { userId: id["GV-MAIN"], status: "CONFIRMED" } })).toBe(0);
  });

  it("[UAT-MONTH] một tháng RIÊNG (12/2026, tự dựng — luật 18): thường · dạy thay · học bù · trợ giảng · trực · dạy+trực · đi muộn · thiếu nhận xét · khoản đề xuất ⇒ tổng == chi tiết == WorkUnit trong DB; mỗi đơn vị / khoản ở ĐÚNG MỘT ô; GV và QLCS thấy CÙNG dòng; CS2 không lẫn người CS1", async () => {
    // ── dựng tháng ──
    const t1 = await lop("2026-12-01", { gv: "GV-MAIN", ta: "GV-TA" }); // thường + trợ giảng
    for (const [u, v, r] of [["GV-MAIN", "17:46", "19:35"], ["GV-TA", "17:45", "19:36"]] as const) {
      await cham("UAT-MONTH", u, "2026-12-01", v);
      await cham("UAT-MONTH", u, "2026-12-01", r);
    }
    await chot(t1.sessionId, "GV-MAIN", vn("2026-12-01", "19:40"));
    await xacNhanDay("2026-12-01", t1.sessionId, "GV-MAIN");
    await xacNhanDay("2026-12-01", t1.sessionId, "GV-TA");
    const t2 = await lop("2026-12-02", { gv: "GV-MAIN", thay: "GV-SUB" }); // dạy thay
    await cham("UAT-MONTH", "GV-SUB", "2026-12-02", "17:48");
    await cham("UAT-MONTH", "GV-SUB", "2026-12-02", "19:33");
    await chot(t2.sessionId, "GV-SUB", vn("2026-12-02", "19:45"));
    await xacNhanDay("2026-12-02", t2.sessionId, "GV-SUB");
    const bu = await db.makeupCase.create({ data: { centerId: cs1, courseId: khoa, lessonId: bai, date: ngayDb("2026-12-03"), startTime: "18:00", endTime: "19:30", teacherId: id["GV-MAKEUP"], status: "SCHEDULED", createdById: id["QLCS-CS1"] }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "MAKEUP_CASE", sourceId: bu.id }], "TAO_BUOI", actor);
    await nhan(bu.id);
    await cham("UAT-MONTH", "GV-MAKEUP", "2026-12-03", "17:46");
    await cham("UAT-MONTH", "GV-MAKEUP", "2026-12-03", "19:34");
    await db.makeupCase.update({ where: { id: bu.id }, data: { status: "COMPLETED" } });
    await xacNhanDay("2026-12-03", bu.id, "GV-MAKEUP");
    const d1 = await giaoTruc("GV-DUTY", "2026-12-04"); // chỉ trực
    await cham("UAT-MONTH", "GV-DUTY", "2026-12-04", "17:10");
    await cham("UAT-MONTH", "GV-DUTY", "2026-12-04", "21:05");
    await xacNhanTrucNgay("2026-12-04", d1);
    const d2 = await giaoTruc("GV-MIXED", "2026-12-07"); // dạy + trực
    const t3 = await lop("2026-12-07", { gv: "GV-MIXED" });
    await cham("UAT-MONTH", "GV-MIXED", "2026-12-07", "17:10");
    await cham("UAT-MONTH", "GV-MIXED", "2026-12-07", "21:05");
    await chot(t3.sessionId, "GV-MIXED", vn("2026-12-07", "19:40"));
    await xacNhanDay("2026-12-07", t3.sessionId, "GV-MIXED");
    await xacNhanTrucNgay("2026-12-07", d2);
    const t4 = await lop("2026-12-08", { gv: "GV-MAIN" }); // đi muộn 8' + thiếu nhận xét ⇒ hai khoản ĐỀ XUẤT
    await cham("UAT-MONTH", "GV-MAIN", "2026-12-08", "17:58");
    await cham("UAT-MONTH", "GV-MAIN", "2026-12-08", "19:35");
    await chot(t4.sessionId, "GV-MAIN");
    await xacNhanDay("2026-12-08", t4.sessionId, "GV-MAIN");
    await dc.dongBoDeXuat({ centerId: cs1, tu: "2026-12-01", den: "2026-12-31", now: vn("2026-12-10", "08:00"), actor: QL() });

    // ── đối chiếu ──
    const now = vn("2026-12-31", "23:00");
    const r = await bc.docBaoCaoThang({ centerId: cs1, thang: "2026-12", now });
    const ngay = { gte: ngayDb("2026-12-01"), lte: ngayDb("2026-12-31") };
    const donVi = await db.workUnit.findMany({ where: { centerId: cs1, workDate: ngay, status: { not: "VOIDED" }, userId: { in: Object.values(id) } }, select: { assignmentId: true, userId: true, workUnitType: true, quantity: true, standardMinutes: true } });
    const khoan = await db.compensationAdjustment.findMany({ where: { centerId: cs1, workDate: ngay, status: { in: ["PROPOSED", "CONFIRMED"] }, userId: { in: Object.values(id) } }, select: { id: true, amount: true, userId: true, status: true } });
    expect([donVi.length, khoan.length]).toEqual([8, 2]);
    const oDonVi = ["mainThuong", "mainDayThay", "mainHocBu", "mainHocVuot", "mainKhac", "troGiang", "trucDu", "trucNua", "donViCu"] as const;
    const oKhoan = ["deXuat", "daXacNhanTru"] as const;
    for (const w of donVi) expect(r.tongHop.flatMap((x) => oDonVi.flatMap((k) => x.ds[k].filter((i) => i === w.assignmentId).map(() => k))), `${w.workUnitType} ${w.assignmentId}`).toHaveLength(1);
    for (const a of khoan) expect(r.tongHop.flatMap((x) => oKhoan.flatMap((k) => x.ds[k].filter((i) => i === a.id).map(() => k))), a.id).toHaveLength(1);
    for (const t of ["GV-MAIN", "GV-TA", "GV-SUB", "GV-MAKEUP", "GV-DUTY", "GV-MIXED"] as const) {
      const row = r.tongHop.find((x) => x.userId === id[t]);
      const day = donVi.filter((w) => w.userId === id[t] && w.workUnitType !== "OPERATIONS_DUTY");
      const tr = donVi.filter((w) => w.userId === id[t] && w.workUnitType === "OPERATIONS_DUTY");
      const k = khoan.filter((a) => a.userId === id[t] && a.status === "PROPOSED").reduce((s2, a) => s2 + a.amount, 0);
      expect([row?.soTiet ?? 0, row?.phutChuanDay ?? 0, row?.donViTruc ?? 0, row?.tienDeXuat ?? 0], t).toEqual([
        day.reduce((s2, w) => s2 + Number(w.quantity), 0),
        day.reduce((s2, w) => s2 + w.standardMinutes, 0),
        tr.reduce((s2, w) => s2 + Number(w.quantity), 0),
        k,
      ]);
    }
    const a = r.tongHop.find((x) => x.userId === id["GV-MAIN"])!;
    expect([a.ds.mainThuong.length, a.ds.diMuon.length, a.ds.thieuNhanXet.length, a.ds.deXuat.length, a.tienDeXuat]).toEqual([2, 1, 1, 2, -40000]);
    expect(r.tongHop.find((x) => x.userId === id["GV-SUB"])?.ds.mainDayThay.length).toBe(1);
    expect(r.tongHop.find((x) => x.userId === id["GV-MAKEUP"])?.ds.mainHocBu.length).toBe(1);
    expect(r.tongHop.find((x) => x.userId === id["GV-TA"])?.ds.troGiang.length).toBe(1);
    expect(r.tongHop.find((x) => x.userId === id["GV-MIXED"])).toMatchObject({ soTiet: 1, donViTruc: 0.5 });
    expect(r.tongHop.find((x) => x.userId === id["GV-DUTY"])).toMatchObject({ soTiet: 0, donViTruc: 1 });
    const cuaToi = await bc.docBaoCaoCuaToi({ userId: id["GV-MAIN"], thang: "2026-12", now });
    expect(cuaToi.tongHop.find((x) => x.userId === id["GV-MAIN"])).toEqual(a);
    const r2 = await bc.docBaoCaoThang({ centerId: cs2, thang: "2026-12", now });
    expect(r2.tongHop.filter((x) => Object.values(id).includes(x.userId))).toEqual([]);
  });
});
