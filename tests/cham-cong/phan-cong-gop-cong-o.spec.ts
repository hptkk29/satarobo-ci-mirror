// tests/cham-cong/phan-cong-gop-cong-o.spec.ts — GĐ6 loader công theo ô (`docCongOThang`), Postgres THẬT.
// Một buổi lớp 14:00–15:30 (ca C) cho GV; lượt quét dựng tay. Kỳ 11 đi luật mới; kỳ 10 ⇒ luật cũ, không ô nào (chốt 8). Luật 18/19.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/phan-cong-gop-cong-o] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? true : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const TAG = "pcg6co";
const N11 = "2026-11-18";
const N10 = "2026-10-21";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

d("[CO-DB] công theo ô — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let co: typeof import("../../lib/phan-cong/cong-o-db");
  let pa: typeof import("../../lib/phan-cong/phan-anh-db");
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let cs = "";
  let gv = "";
  let ql = "";
  let khoa = "";
  const actor = { id: "", name: "QL pcg6co" };

  async function don() {
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    const pas = (await db.phanAnhCong.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: pas } } });
    await db.phanAnhCong.deleteMany({ where: { userId: { in: ids } } });
    const pcs = (await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: pcs } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = (await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id);
    await db.classSession.deleteMany({ where: { classId: { in: cls } } });
    await db.class.deleteMany({ where: { id: { in: cls } } });
    await db.domainEvent.deleteMany({ where: { type: { in: ["parttime.staffing_dirty", "class.session_changed"] } } });
  }

  beforeAll(async () => {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238");
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "SR.QD.238", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]!) },
    });
    co = await import("../../lib/phan-cong/cong-o-db");
    pa = await import("../../lib/phan-cong/phan-anh-db");
    dongBo = await import("../../lib/parttime/dong-bo");
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS pcg6co", address: "x", code: `${TAG}-cs` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV pcg6co", path: `/${TAG}-cs/`, depth: 0, centerId: cs } });
    await don();
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    gv = (await db.user.create({ data: { email: `gv@${TAG}.test`, name: "GV co", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
    ql = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "QL co", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs }, select: { id: true } })).id;
    actor.id = ql;
    await db.course.deleteMany({ where: { slug: `${TAG}-k` } });
    khoa = (await db.course.create({ data: { name: "Khoá co", slug: `${TAG}-k` }, select: { id: true } })).id;
  });
  afterEach(() => don());
  afterAll(async () => {
    await don();
    await db.course.deleteMany({ where: { slug: `${TAG}-k` } });
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    await db.orgUnit.deleteMany({ where: { code: `${TAG}-cs` } });
    await db.center.deleteMany({ where: { slug: `${TAG}-cs` } });
    await db.$disconnect();
  });

  async function buoiLop(ngay: string) {
    const lop = await db.class.create({ data: { name: `${TAG} L${ngay}`, courseId: khoa, centerId: cs, teacherId: gv, startTime: "14:00", endTime: "15:30" }, select: { id: true } });
    const s = await db.classSession.create({ data: { classId: lop.id, centerId: cs, status: "SCHEDULED", date: vn(ngay, "14:00") }, select: { id: true } });
    await dongBo.dongBoNgay([{ sourceType: "CLASS_SESSION", sourceId: s.id }], "TAO_BUOI", actor);
  }
  const quet = (ngay: string, hhmm: string, direction: "CHECK_IN" | "CHECK_OUT") =>
    db.staffTimeLog.create({ data: { userId: gv, centerId: cs, direction, loggedAt: vn(ngay, hhmm), workDate: new Date(`${ngay}T00:00:00Z`), source: "TICKET", result: "ACCEPTED" } });
  const doc = (periodKey: string, den: string) => co.docCongOThang({ centerId: cs, periodKey, den, userId: gv });

  it("[CO-DB-01] đủ lượt (vào trước giờ chuẩn bị, ra sau giờ dạy) ⇒ ô ca C TỰ ĐỘNG, mã D, 1 tiết đứng chính", async () => {
    await buoiLop(N11);
    await quet(N11, "13:30", "CHECK_IN");
    await quet(N11, "15:45", "CHECK_OUT");
    const kq = await doc("2026-11", "2026-11-30");
    expect(kq.luat).toBe("MOI");
    expect(kq.o).toEqual([expect.objectContaining({ userId: gv, ngay: N11, ca: "C", ma: "D", tietD: 1, trangThai: "TU_DONG", lyDo: [], phanAnh: null })]);
  });

  it("[CO-DB-02] thiếu lượt RA ⇒ CẦN XEM (THIEU_RA); GV phản ánh, QLCS duyệt (ghi thêm lượt ra) ⇒ ô thành TỰ ĐỘNG và mang phản ánh DA_DUYET", async () => {
    await buoiLop(N11);
    await quet(N11, "13:30", "CHECK_IN");
    const truoc = await doc("2026-11", "2026-11-30");
    expect(truoc.o).toEqual([expect.objectContaining({ trangThai: "CAN_XEM", lyDo: ["THIEU_RA"] })]);
    const { id } = await pa.guiPhanAnh({ userId: gv, centerId: cs, ngay: N11, ca: "C", lyDo: "Quên quét ra", moc: [null, "15:40"], homNay: "2026-11-20" });
    await pa.duyetPhanAnh({ id, actor: { id: ql, name: "QL" }, duyet: true, ghiChu: null, now: new Date("2026-11-20T03:00:00Z") });
    const sau = await doc("2026-11", "2026-11-30");
    expect(sau.o).toEqual([expect.objectContaining({ trangThai: "TU_DONG", phanAnh: expect.objectContaining({ id, status: "DA_DUYET" }) })]);
  });

  it("[CO-DB-03] cờ kỳ CẢ HAI vế: kỳ 2026-10 ⇒ luật CŨ, KHÔNG ô nào (luồng xác nhận P5 giữ nguyên); `den` kẹp trong kỳ", async () => {
    await buoiLop(N10);
    await quet(N10, "13:30", "CHECK_IN");
    expect(await doc("2026-10", "2026-10-31")).toMatchObject({ luat: "CU", o: [] });
    await buoiLop(N11);
    expect((await doc("2026-11", "2026-11-17")).o).toEqual([]); // buổi 18/11 nằm sau `den`
  });
});
