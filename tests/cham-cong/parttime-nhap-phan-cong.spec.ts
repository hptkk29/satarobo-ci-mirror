// [NPC-DB-*] — nhập phân công GV từ Excel trên Postgres THẬT: ngữ cảnh dựng theo lô (`dungNguCanhNhap`) → xét (`xetFileNhap`) → ghi
// qua CHÍNH dịch vụ của màn (`apDungNhap` → giaoTruc / huyTruc / phanCongVaoBuoi). Chạy lại cùng tệp ⇒ KHÔNG ĐỔI, không dòng trùng.
// Thuần: lib/parttime/nhap-phan-cong.test.ts. Chạy: TEST_DATABASE_URL=postgresql://…/satarobo_test… pnpm test:cham-cong-db
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";
import type { DongNhap } from "../../lib/parttime/nhap-phan-cong";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-nhap-phan-cong] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));
vi.mock("../../lib/notifications/notify", () => ({ notifyStaff: async () => undefined }));

const TAG = "ptnp";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const NOW = vn("2026-11-02", "09:00"); // hôm nay 02/11/2026 (SR.QD.238 từ 15/10)
const COT = ["ImportKey", "ThaoTac", "CoSoSuDung", "Ngay", "Ca_SCT", "MaGV", "EmailThamChieu", "VaiTro", "SessionId", "Truc_YN", "GVThayThe_Ma", "CoSoGoc_ThamChieu", "LyDo", "GhiChu", "PhienBanKyVong", "NguonDoiChieu"] as const;
const dong = (soDong: number, p: Partial<Record<(typeof COT)[number], string>>): DongNhap => ({ soDong, ...Object.fromEntries(COT.map((c) => [c, ""])), ...p }) as DongNhap;

d("[NPC-DB] nhập phân công GV — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let np: typeof import("../../lib/parttime/nhap-phan-cong");
  let npdb: typeof import("../../lib/parttime/nhap-phan-cong-db");
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let cs = "";
  let csKhac = "";
  let gv = "";
  let gvKhac = "";
  let sessionId = "";
  const MA = `${TAG}-cs2`.toUpperCase();
  const MA_KHAC = `${TAG}-cs1`.toUpperCase();
  const actor = { id: null as string | null, name: "QLCS np" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({
      where: { code: "LEGACY" },
      update: {},
      create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } },
    });
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "SR.QD.238", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) },
    });
  }

  async function cleanup() {
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    const pcIds = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    const dutyIds = (await db.operationsDutyAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    await db.auditLog.deleteMany({ where: { entityType: { in: ["SessionStaffAssignment", "OperationsDutyAssignment"] }, entityId: { in: [...pcIds, ...dutyIds] } } });
    if (pcIds.length) {
      await db.$transaction([
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
        db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcIds } } }),
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      ]);
    }
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.operationsDutyAcceptance.deleteMany({ where: { duty: { userId: { in: ids } } } });
    await db.operationsDutyAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = (await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id);
    await db.classSession.deleteMany({ where: { classId: { in: cls } } });
    await db.class.deleteMany({ where: { id: { in: cls } } });
    await db.lesson.deleteMany({ where: { curriculum: { course: { slug: { startsWith: TAG } } } } });
    await db.curriculum.deleteMany({ where: { course: { slug: { startsWith: TAG } } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    for (const c of [cs, csKhac].filter(Boolean)) await db.attendancePeriod.deleteMany({ where: { centerId: c } });
    await db.user.updateMany({ where: { id: { in: ids } }, data: { employeeId: null } });
    await db.employee.deleteMany({ where: { employeeCode: { startsWith: TAG.toUpperCase() } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    np = await import("../../lib/parttime/nhap-phan-cong");
    npdb = await import("../../lib/parttime/nhap-phan-cong-db");
    dongBo = await import("../../lib/parttime/dong-bo");
    const tao = async (code: string) => {
      const c = (await db.center.upsert({ where: { slug: `${TAG}-${code}` }, update: {}, create: { slug: `${TAG}-${code}`, name: `CS ${code}`, address: "x", code: `${TAG}-${code}`.toUpperCase() }, select: { id: true } })).id;
      await db.orgUnit.upsert({ where: { code: `${TAG}-${code}` }, update: {}, create: { type: "CENTER", code: `${TAG}-${code}`, name: `ĐV ${code}`, path: `/${TAG}-${code}/`, depth: 0, centerId: c } });
      return c;
    };
    cs = await tao("cs2");
    csKhac = await tao("cs1");
    await cleanup();
    const nv = await db.employee.create({ data: { employeeCode: `${TAG.toUpperCase()}001`, fullName: "GV A np", jobTitle: "Giáo viên", department: "DAO_TAO", centerId: cs }, select: { id: true } });
    gv = (await db.user.create({ data: { email: `gv@${TAG}.test`, name: "GV A np", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs, employeeId: nv.id }, select: { id: true } })).id;
    gvKhac = (await db.user.create({ data: { email: `gv2@${TAG}.test`, name: "GV B np", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: csKhac }, select: { id: true } })).id;
    const khoa = (await db.course.create({ data: { name: "Sata 4 np", slug: `${TAG}-k` }, select: { id: true } })).id;
    const cur = await db.curriculum.create({ data: { courseId: khoa, name: "GT np" }, select: { id: true } });
    const bai = (await db.lesson.create({ data: { curriculumId: cur.id, order: 1, title: "Bài 1" }, select: { id: true } })).id;
    // Lớp của CS2 do gvKhac (CS1) KHÔNG dạy — gv (CS2) là GV chính ⇒ gv thuộc cơ sở (docGiaoVienCuaCoSo đọc lớp).
    const lop = await db.class.create({ data: { name: `${TAG} L1`, courseId: khoa, centerId: cs, teacherId: gv, startTime: "14:00", endTime: "15:30" }, select: { id: true } });
    sessionId = (await db.classSession.create({ data: { classId: lop.id, centerId: cs, status: "SCHEDULED", date: vn("2026-11-05", "14:00"), lessonId: bai }, select: { id: true } })).id;
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: sessionId }], "TAO_BUOI", actor);
  });
  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  /** Một lượt "xác nhận nhập" đầy đủ, như action làm: ngữ cảnh → xét → ghi. */
  const nhap = async (ds: DongNhap[], coSoDuocPhan = [cs]) => {
    const ngu = await npdb.dungNguCanhNhap({ dong: ds, coSoDuocPhan, coSoDaBat: [cs, csKhac], now: NOW });
    const ketQua = np.xetFileNhap(ds, ngu);
    const ghi = await npdb.apDungNhap({ ketQua, dong: ds, actor });
    return { ketQua, ghi: ghi.ketQua };
  };
  const trucSong = (userId: string) => db.operationsDutyAssignment.findMany({ where: { userId, status: { not: "CANCELLED" } } });

  it("[NPC-DB-01] GAN_TRUC theo MaGV ⇒ một dòng trực (orgUnitId tự điền); chạy lại cùng dòng ⇒ KHÔNG ĐỔI, vẫn một dòng; HUY_TRUC ⇒ CANCELLED", async () => {
    const r1 = await nhap([dong(5, { ImportKey: "K1", ThaoTac: "GAN_TRUC", CoSoSuDung: MA, Ngay: "2026-11-06", Ca_SCT: "S", MaGV: `${TAG.toUpperCase()}001`, VaiTro: "OPS", Truc_YN: "YES" })]);
    expect(r1.ketQua.map((x) => x.ketQua)).toEqual(["THEM"]);
    expect(r1.ghi).toMatchObject([{ ok: true }]);
    const t = await trucSong(gv);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ centerId: cs, shiftCode: "S" });
    expect(t[0]!.orgUnitId).not.toBeNull();
    expect(t[0]!.note).toContain("Import K1");

    const r2 = await nhap([dong(5, { ImportKey: "K1", ThaoTac: "GAN_TRUC", CoSoSuDung: MA, Ngay: "2026-11-06", Ca_SCT: "S", MaGV: `${TAG.toUpperCase()}001` })]);
    expect(r2.ketQua).toMatchObject([{ ketQua: "KHONG_DOI", ma: "DUPLICATE_ASSIGNMENT" }]);
    expect(r2.ghi).toEqual([]);
    expect(await trucSong(gv)).toHaveLength(1);

    const r3 = await nhap([dong(5, { ImportKey: "K2", ThaoTac: "HUY_TRUC", CoSoSuDung: MA, Ngay: "2026-11-06", Ca_SCT: "S", EmailThamChieu: `GV@${TAG}.test`, LyDo: "không trực nữa" })]);
    expect(r3.ketQua).toMatchObject([{ ketQua: "HUY" }]);
    expect(await trucSong(gv)).toHaveLength(0);
  });

  it("[NPC-DB-02] PHAN_CONG_TA vào buổi CÓ THẬT ⇒ SessionStaffAssignment TA (qua phanCongVaoBuoi); chạy lại ⇒ KHÔNG ĐỔI; GV ngoài phạm vi ⇒ LỖI", async () => {
    const ta = dong(5, { ImportKey: "TA1", ThaoTac: "PHAN_CONG_TA", CoSoSuDung: MA, Ngay: "2026-11-05", Ca_SCT: "C", EmailThamChieu: `gv2@${TAG}.test`, SessionId: sessionId });
    // gvKhac (CS1) không thuộc CS2 và người nhập không quản lý CS1 ⇒ không phân được (cùng cổng màn "Phân công buổi").
    expect((await nhap([ta])).ketQua).toMatchObject([{ ketQua: "LOI", ma: "NOT_TEACHER_IN_SCOPE" }]);
    // gvKhac là GV của CS1: lớp CS1 do gvKhac dạy ⇒ thuộc CS1; người nhập quản lý cả CS1 ⇒ mượn được.
    await db.class.create({ data: { name: `${TAG} L2`, courseId: (await db.course.findFirstOrThrow({ where: { slug: `${TAG}-k` } })).id, centerId: csKhac, teacherId: gvKhac, startTime: "08:00", endTime: "09:30" } });
    const r = await nhap([ta], [cs, csKhac]);
    expect(r.ketQua).toMatchObject([{ ketQua: "THEM" }]);
    expect(r.ghi).toMatchObject([{ ok: true }]);
    const pc = await db.sessionStaffAssignment.findMany({ where: { sourceId: sessionId, role: "TEACHING_ASSISTANT", status: { notIn: ["CANCELLED", "REPLACED"] } } });
    expect(pc.map((x) => x.userId)).toEqual([gvKhac]);
    const r2 = await nhap([ta], [cs, csKhac]);
    expect(r2.ketQua).toMatchObject([{ ketQua: "KHONG_DOI" }]);
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: sessionId, role: "TEACHING_ASSISTANT", status: { notIn: ["CANCELLED", "REPLACED"] } } })).toBe(1);
  });

  it("[NPC-DB-03] kỳ công KHOÁ ⇒ CLOSED_PERIOD_MUTATION, không ghi; cơ sở không có quyền ⇒ CROSS_CENTER_RBAC; trực cùng ca ở cơ sở khác ⇒ CROSS_CENTER_OVERLAP", async () => {
    await db.attendancePeriod.create({ data: { centerId: cs, periodKey: "2026-10", status: "LOCKED" } });
    const qk = dong(5, { ImportKey: "Q1", ThaoTac: "GAN_TRUC", CoSoSuDung: MA, Ngay: "2026-10-30", Ca_SCT: "S", MaGV: `${TAG.toUpperCase()}001`, LyDo: "bổ sung trực đã làm" });
    const r = await nhap([qk, dong(6, { ImportKey: "Q2", ThaoTac: "GAN_TRUC", CoSoSuDung: MA_KHAC, Ngay: "2026-11-06", Ca_SCT: "S", MaGV: `${TAG.toUpperCase()}001` })]);
    expect(r.ketQua.map((x) => [x.soDong, x.ma])).toEqual([
      [5, "CLOSED_PERIOD_MUTATION"],
      [6, "CROSS_CENTER_RBAC"],
    ]);
    expect(r.ghi).toEqual([]);
    expect(await trucSong(gv)).toHaveLength(0);

    // gv đang trực ca T ngày 07/11 ở CS1 ⇒ không giao trực cùng ca ở CS2.
    const t = await nhap([dong(5, { ImportKey: "O1", ThaoTac: "GAN_TRUC", CoSoSuDung: MA_KHAC, Ngay: "2026-11-07", Ca_SCT: "T", MaGV: `${TAG.toUpperCase()}001` })], [cs, csKhac]);
    expect(t.ghi).toMatchObject([{ ok: true }]);
    const o = await nhap([dong(5, { ImportKey: "O2", ThaoTac: "GAN_TRUC", CoSoSuDung: MA, Ngay: "2026-11-07", Ca_SCT: "T", MaGV: `${TAG.toUpperCase()}001` })]);
    expect(o.ketQua).toMatchObject([{ ketQua: "LOI", ma: "CROSS_CENTER_OVERLAP" }]);
  });

  it("[NPC-DB-04] file mẫu: danh sách GV mang MaGV + email; danh sách buổi mang đúng SessionId của buổi trong khoảng", async () => {
    const mx = await import("../../lib/parttime/mau-xuat-phan-cong-db");
    const v = await mx.docDauVaoMauNhap({ centerIds: [cs], tu: "2026-11-02", den: "2026-11-08", now: NOW });
    expect(v?.coSo.map((c) => c.ma)).toEqual([MA]);
    expect(v?.giaoVien.find((g) => g.email === `gv@${TAG}.test`)).toMatchObject({ maGV: `${TAG.toUpperCase()}001`, coSo: [MA] });
    expect(v?.buoi.find((b) => b.sessionId === sessionId)).toMatchObject({ ngay: "2026-11-05", ca: "C", gvChinh: "GV A np", loai: "Lớp" });
    // Cơ sở đang xem (phần tử đầu của centerIds) đứng ĐẦU dropdown — không xếp theo mã.
    const v2 = await mx.docDauVaoMauNhap({ centerIds: [cs, csKhac], tu: "2026-11-02", den: "2026-11-08", now: NOW });
    expect(v2?.coSo.map((c) => c.ma)).toEqual([MA, MA_KHAC]);
  });
});
