// tests/cham-cong/phan-cong-gop-ap-khung.spec.ts — GĐ4 "Áp khung lịch", Postgres THẬT.
// `homNay` truyền tay (luật 19); `ClassSession.date` mang giờ thật (luật 4); mỗi ca tự dựng lịch riêng + dọn sau ca (luật 18).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/phan-cong-gop-ap-khung] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const TAG = "pcg4ak";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
// Tuần mẫu 02/11/2026 (T2) · đích hai tuần sau: thứ Tư 11/11 và 18/11.
const MAU_T4 = "2026-11-04";
const DICH = ["2026-11-11", "2026-11-18"];
const HOM_NAY = "2026-11-05";

d("[AK-DB] áp khung lịch — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let ak: typeof import("../../lib/phan-cong/ap-khung-db");
  let cs = "";
  let an = "";
  let binh = "";
  let chi = "";
  let khoa = "";
  const actor = { id: "", name: "QLCS pcg4" };

  async function donLich() {
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const pcs = await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: [...pcs.map((p) => p.id), ...(cs ? [cs] : [])] } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    const tr = await db.operationsDutyAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityId: { in: tr.map((t) => t.id) } } });
    await db.operationsDutyAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const ses = await db.classSession.findMany({ where: { classId: { in: cls.map((c) => c.id) } }, select: { id: true } });
    await db.domainEvent.deleteMany({ where: { type: { in: ["parttime.staffing_dirty", "class.session_changed"] } } });
    await db.auditLog.deleteMany({ where: { entityId: { in: ses.map((s) => s.id) } } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
  }

  beforeAll(async () => {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238");
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "SR.QD.238", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) },
    });
    ak = await import("../../lib/phan-cong/ap-khung-db");
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS pcg4", address: "x", code: `${TAG}-cs` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV pcg4", path: `/${TAG}-cs/`, depth: 0, centerId: cs } });
    await donLich();
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    const mk = (e: string, role: "TEACHER" | "CENTER_MANAGER" = "TEACHER") =>
      db.user.create({ data: { email: `${e}@${TAG}.test`, name: e, role, roles: [role], password: "x", centerId: cs }, select: { id: true } });
    an = (await mk("an")).id;
    binh = (await mk("binh")).id;
    chi = (await mk("chi")).id;
    actor.id = (await mk("ql", "CENTER_MANAGER")).id;
    await db.course.deleteMany({ where: { slug: `${TAG}-k` } });
    khoa = (await db.course.create({ data: { name: "Robotics pcg4", slug: `${TAG}-k` }, select: { id: true } })).id;
  });

  afterEach(() => donLich());
  afterAll(async () => {
    await donLich();
    await db.course.deleteMany({ where: { slug: `${TAG}-k` } });
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  /** Lớp L (GV lớp = chi) có buổi thứ Tư tuần mẫu + hai tuần đích. Mẫu: an đứng chính, binh trợ giảng, an trực C thứ Tư. */
  async function dung(dich: readonly string[] = DICH) {
    const lop = await db.class.create({ data: { name: `${TAG} L`, courseId: khoa, centerId: cs, teacherId: chi, startTime: "14:00", endTime: "15:30" }, select: { id: true } });
    const ss: Record<string, string> = {};
    for (const n of [MAU_T4, ...dich]) ss[n] = (await db.classSession.create({ data: { classId: lop.id, centerId: cs, status: "SCHEDULED", date: vn(n, "14:00") }, select: { id: true } })).id;
    const ou = await db.orgUnit.findFirstOrThrow({ where: { centerId: cs }, select: { id: true } });
    const pc = (sourceId: string, ngay: string, userId: string, role: "MAIN_TEACHER" | "TEACHING_ASSISTANT") =>
      db.sessionStaffAssignment.create({
        data: { sourceType: "CLASS_SESSION", sourceId, centerId: cs, orgUnitId: ou.id, ngay: new Date(`${ngay}T00:00:00Z`), gioBatDau: "14:00", gioKetThuc: "15:30", userId, role, activityType: "REGULAR_CLASS", assignmentType: "MANUAL", nguonGiao: "TAY", status: "ACCEPTED" },
      });
    await pc(ss[MAU_T4]!, MAU_T4, an, "MAIN_TEACHER");
    await pc(ss[MAU_T4]!, MAU_T4, binh, "TEACHING_ASSISTANT");
    for (const n of dich) await pc(ss[n]!, n, chi, "MAIN_TEACHER"); // đích: GV lớp đang đứng
    await db.operationsDutyAssignment.create({ data: { userId: an, centerId: cs, workDate: new Date(`${MAU_T4}T00:00:00Z`), shiftCode: "C", policyVersionId: "cpv_sr_qd_238", nguonGiao: "TAY", status: "ACCEPTED" } });
    return ss;
  }
  const chay = (p: Partial<Parameters<typeof ak.apKhung>[0]> = {}) =>
    ak.apKhung({ centerId: cs, tuanMau: "2026-11-02", tu: DICH[0]!, den: DICH[1]!, cheDo: "BO_SUNG", giaoVien: null, homNay: HOM_NAY, ghiThat: false, actor, ...p });
  const dem = async () => ({
    pc: await db.sessionStaffAssignment.count({ where: { centerId: cs } }),
    truc: await db.operationsDutyAssignment.count({ where: { centerId: cs } }),
    ev: await db.domainEvent.count(),
    audit: await db.auditLog.count({ where: { action: "PT_AP_KHUNG", entityId: cs } }),
  });

  it("[AK-DB-01] XEM TRƯỚC: trả đúng các bước, KHÔNG để lại dòng nào (phân công · trực · DomainEvent · audit)", async () => {
    await dung();
    const truoc = await dem();
    const kq = await chay();
    expect(kq.xemTruoc).toBe(true);
    expect(kq.buoc.map((b) => b.loai).sort()).toEqual(["DAT_NGUOI", "DAT_NGUOI", "DAT_NGUOI", "DAT_NGUOI", "GIAO_TRUC", "GIAO_TRUC"]);
    expect(await dem()).toEqual(truoc);
  });

  it("[AK-DB-02] GHI THẬT: đích theo đúng mẫu, mọi dòng mang nguồn AP_KHUNG, một dòng audit PT_AP_KHUNG; chạy lại ⇒ 0 bước", async () => {
    const ss = await dung();
    const kq = await chay({ ghiThat: true });
    expect(kq.xemTruoc).toBe(false);
    for (const n of DICH) {
      const song = await db.sessionStaffAssignment.findMany({ where: { sourceId: ss[n]!, status: "ACCEPTED" }, select: { userId: true, role: true, nguonGiao: true } });
      expect(song).toEqual(expect.arrayContaining([{ userId: an, role: "MAIN_TEACHER", nguonGiao: "AP_KHUNG" }, { userId: binh, role: "TEACHING_ASSISTANT", nguonGiao: "AP_KHUNG" }]));
      expect(song).toHaveLength(2);
      expect((await db.classSession.findUniqueOrThrow({ where: { id: ss[n]! } })).substituteTeacherId).toBe(an);
      expect(await db.operationsDutyAssignment.findFirstOrThrow({ where: { userId: an, workDate: new Date(`${n}T00:00:00Z`) } })).toMatchObject({ shiftCode: "C", nguonGiao: "AP_KHUNG", status: "ACCEPTED" });
    }
    // Giao dịch THEO TUẦN (chốt lượt 2 điểm 5): mỗi tuần một dòng audit — hai tuần đích ⇒ 2.
    expect((await dem()).audit).toBe(2);
    expect(kq.tuan.map((t) => [t.thuHai, t.soBuoc])).toEqual([["2026-11-09", 3], ["2026-11-16", 3]]);
    expect((await chay({ ghiThat: true })).buoc).toEqual([]);
  });

  it("[AK-DB-03] ngày ≤ hôm nay bỏ qua: homNay = 11/11 ⇒ chỉ áp 18/11", async () => {
    const ss = await dung();
    const kq = await chay({ ghiThat: true, homNay: DICH[0]! });
    expect(kq.boQuaNgay).toContain(DICH[0]);
    expect((await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: ss[DICH[0]!]!, role: "MAIN_TEACHER", status: "ACCEPTED" } })).userId).toBe(chi);
    expect((await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: ss[DICH[1]!]!, role: "MAIN_TEACHER", status: "ACCEPTED" } })).userId).toBe(an);
  });

  it("[AK-DB-04] GHI_DE gỡ ca trực THỪA ở đích; BO_SUNG giữ nguyên (đối chứng)", async () => {
    await dung();
    const thua = await db.operationsDutyAssignment.create({ data: { userId: an, centerId: cs, workDate: new Date(`${DICH[0]}T00:00:00Z`), shiftCode: "T", policyVersionId: "cpv_sr_qd_238", nguonGiao: "TAY", status: "ACCEPTED" } });
    await chay({ ghiThat: true, cheDo: "BO_SUNG" });
    expect((await db.operationsDutyAssignment.findUniqueOrThrow({ where: { id: thua.id } })).status).toBe("ACCEPTED");
    await chay({ ghiThat: true, cheDo: "GHI_DE" });
    expect((await db.operationsDutyAssignment.findUniqueOrThrow({ where: { id: thua.id } })).status).toBe("CANCELLED");
  });

  it("[AK-DB-05] chỉ giáo viên được chọn: chọn binh ⇒ chỉ trợ giảng đổi, đứng chính + trực của an không chép", async () => {
    const ss = await dung();
    await chay({ ghiThat: true, giaoVien: [binh] });
    expect((await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: ss[DICH[0]!]!, role: "MAIN_TEACHER", status: "ACCEPTED" } })).userId).toBe(chi);
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: ss[DICH[0]!]!, role: "TEACHING_ASSISTANT", userId: binh, status: "ACCEPTED" } })).toBe(1);
    expect(await db.operationsDutyAssignment.count({ where: { userId: an, workDate: { in: DICH.map((n) => new Date(`${n}T00:00:00Z`)) } } })).toBe(0);
  });

  it("[AK-DB-06] THEO TUẦN: lỗi ở tuần 3 ⇒ tuần 1–2 GIỮ, tuần 3 không đổi, báo “đã áp tới tuần 16/11”; gỡ nguyên nhân rồi chạy lại ⇒ xong, KHÔNG nhân đôi", async () => {
    const BA = [...DICH, "2026-11-25"];
    const ss = await dung(BA);
    // Tuần 3: an đang dạy LỚP KHÁC cùng giờ ⇒ ghi người dạy thay cho buổi 25/11 vấp trùng lịch GV (adjustSession) ⇒ tuần 3 quay lui.
    const khac = await db.class.create({ data: { name: `${TAG} Lkhac`, courseId: khoa, centerId: cs, teacherId: an, startTime: "14:00", endTime: "15:30" }, select: { id: true } });
    const vuong = await db.classSession.create({ data: { classId: khac.id, centerId: cs, status: "SCHEDULED", date: vn("2026-11-25", "14:00") }, select: { id: true } });
    const kq = await chay({ ghiThat: true, den: "2026-11-25" });
    expect(kq.loi).toMatchObject({ thuHai: "2026-11-23", daApToi: "2026-11-16" });
    expect(kq.tuan.map((t) => t.thuHai)).toEqual(["2026-11-09", "2026-11-16"]);
    const main = async (n: string) => (await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: ss[n]!, role: "MAIN_TEACHER", status: "ACCEPTED" } })).userId;
    expect([await main(DICH[0]!), await main(DICH[1]!), await main("2026-11-25")]).toEqual([an, an, chi]);
    expect(await db.operationsDutyAssignment.count({ where: { userId: an, workDate: new Date("2026-11-25T00:00:00Z") } })).toBe(0); // trực tuần 3 cũng quay lui
    expect((await dem()).audit).toBe(2);
    const sauLan1 = await dem();
    // Gỡ nguyên nhân, chạy lại: chỉ tuần 3 có bước; tuần đã áp ra 0 bước ⇒ không nhân đôi dòng nào.
    await db.classSession.delete({ where: { id: vuong.id } });
    const lai = await chay({ ghiThat: true, den: "2026-11-25" });
    expect(lai.loi).toBeNull();
    expect(lai.tuan.map((t) => [t.thuHai, t.soBuoc])).toEqual([["2026-11-23", 3]]);
    expect(await main("2026-11-25")).toBe(an);
    const sauLan2 = await dem();
    expect(sauLan2.truc - sauLan1.truc).toBe(1);
    expect(await db.sessionStaffAssignment.count({ where: { sourceId: { in: BA.map((n) => ss[n]!) }, status: "ACCEPTED" } })).toBe(6);
    expect((await chay({ ghiThat: true, den: "2026-11-25" })).buoc).toEqual([]);
  });
});
