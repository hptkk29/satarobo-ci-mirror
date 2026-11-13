// tests/cham-cong/phan-cong-gop-phan-anh.spec.ts — GĐ6 phản ánh ô công Parttime, Postgres THẬT.
// Chốt 4 (hạn tới lúc chốt kỳ), 5 (duyệt = GHI THÊM lượt quét gắn id phản ánh), 8 (chỉ kỳ ≥ 2026-11). `homNay`/`now` truyền tay (luật 19).
// Mỗi ca tự dựng + dọn (luật 18).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/phan-cong-gop-phan-anh] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "pcg6pa";
const NGAY = "2026-11-18";
const NGAY_KY10 = "2026-10-20";
const HOM_NAY = "2026-11-20";
const NOW = new Date("2026-11-20T03:00:00Z");

d("[PA-DB] phản ánh ô công — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let pa: typeof import("../../lib/phan-cong/phan-anh-db");
  let cs = "";
  let gv = "";
  let ql = "";

  async function don() {
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    const pas = (await db.phanAnhCong.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((x) => x.id);
    await db.auditLog.deleteMany({ where: { entityId: { in: pas } } });
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    await db.phanAnhCong.deleteMany({ where: { userId: { in: ids } } });
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    await db.staffNotification.deleteMany({ where: { dedupeKey: { startsWith: "phan-cong.phan-anh" } } });
    if (cs) await db.attendancePeriod.deleteMany({ where: { centerId: cs } });
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
    pa = await import("../../lib/phan-cong/phan-anh-db");
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS pcg6", address: "x", code: `${TAG}-cs` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV pcg6", path: `/${TAG}-cs/`, depth: 0, centerId: cs } });
    await don();
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    gv = (await db.user.create({ data: { email: `gv@${TAG}.test`, name: "gv", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
    ql = (await db.user.create({ data: { email: `ql@${TAG}.test`, name: "ql", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], password: "x", centerId: cs }, select: { id: true } })).id;
  });
  afterEach(() => don());
  afterAll(async () => {
    await don();
    await db.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    await db.orgUnit.deleteMany({ where: { code: `${TAG}-cs` } });
    await db.center.deleteMany({ where: { slug: `${TAG}-cs` } });
    await db.$disconnect();
  });

  /** GV có MỘT việc dạy ngày `ngay` 14:00–15:30 (ca C) ở cơ sở. */
  const viec = (ngay: string) =>
    db.sessionStaffAssignment.create({
      data: { sourceType: "CLASS_SESSION", sourceId: `${TAG}-s-${ngay}`, centerId: cs, ngay: new Date(`${ngay}T00:00:00Z`), gioBatDau: "14:00", gioKetThuc: "15:30", userId: gv, role: "MAIN_TEACHER", activityType: "REGULAR_CLASS", assignmentType: "SYSTEM", nguonGiao: "DONG_BO", status: "ACCEPTED" },
    });
  const gui = (x: Partial<Parameters<typeof pa.guiPhanAnh>[0]> = {}) =>
    pa.guiPhanAnh({ userId: gv, centerId: cs, ngay: NGAY, ca: "C", lyDo: "Quên quét ra lúc về", moc: [null, "15:40"], homNay: HOM_NAY, ...x });
  const duyet = (id: string, x: Partial<Parameters<typeof pa.duyetPhanAnh>[0]> = {}) =>
    pa.duyetPhanAnh({ id, actor: { id: ql, name: "ql" }, duyet: true, ghiChu: null, now: NOW, ...x });
  const luotPA = (id: string) => db.staffTimeLog.findMany({ where: { phanAnhId: id }, select: { direction: true, source: true, reviewStatus: true, workDate: true } });

  it("[PA-DB-01] DUYỆT ⇒ ghi THÊM lượt quét mang phanAnhId (MANUAL_ADJUST, CONFIRMED) + đánh dấu ngày cần tính lại + một dòng nhật ký; phản ánh DA_DUYET", async () => {
    await viec(NGAY);
    const { id } = await gui();
    expect(await luotPA(id)).toEqual([]);
    await duyet(id);
    expect(await luotPA(id)).toEqual([{ direction: "CHECK_OUT", source: "MANUAL_ADJUST", reviewStatus: "CONFIRMED", workDate: new Date(`${NGAY}T00:00:00Z`) }]);
    expect(await db.phanAnhCong.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DA_DUYET", decidedById: ql });
    expect(await db.auditLog.count({ where: { entityId: id, action: "PT_PHAN_ANH_DUYET" } })).toBe(1);
    expect(await db.domainEvent.count({ where: { type: { contains: "attendance" }, dedupeKey: { contains: gv } } })).toBeGreaterThan(0);
  });

  it("[PA-DB-02] KHÔNG DUYỆT ⇒ không lượt quét nào, lý do lưu lại; thiếu lý do ⇒ chặn, phản ánh vẫn chờ", async () => {
    await viec(NGAY);
    const { id } = await gui();
    await expect(duyet(id, { duyet: false, ghiChu: "ngắn" })).rejects.toThrow(/lý do/);
    expect((await db.phanAnhCong.findUniqueOrThrow({ where: { id } })).status).toBe("CHO_DUYET");
    await duyet(id, { duyet: false, ghiChu: "Camera cho thấy rời lớp 15:00" });
    expect(await db.phanAnhCong.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "KHONG_DUYET", decisionNote: "Camera cho thấy rời lớp 15:00" });
    expect(await luotPA(id)).toEqual([]);
  });

  it("[PA-DB-03] TỰ duyệt ⇒ chặn; một ô chỉ MỘT phản ánh chờ (gửi lần hai ⇒ chặn); rút lại rồi gửi lại được", async () => {
    await viec(NGAY);
    const { id } = await gui();
    await expect(duyet(id, { actor: { id: gv, name: "gv" } })).rejects.toThrow(/tự duyệt/);
    await expect(gui()).rejects.toThrow(/đang có phản ánh chờ/);
    await pa.rutPhanAnh({ id, userId: gv });
    expect((await gui()).id).not.toBe(id);
  });

  it("[PA-DB-04] KỲ ĐÃ CHỐT ⇒ hết hạn: không gửi được, phản ánh đang chờ cũng không duyệt được (chốt 4); đối chứng: mở lại ⇒ duyệt được", async () => {
    await viec(NGAY);
    const { id } = await gui();
    await db.attendancePeriod.create({ data: { centerId: cs, periodKey: "2026-11", status: "LOCKED" } });
    await expect(gui({ ca: "S", moc: ["08:00"] })).rejects.toThrow(/hết hạn/);
    await expect(duyet(id)).rejects.toThrow(/đã chốt/);
    expect(await luotPA(id)).toEqual([]);
    await db.attendancePeriod.updateMany({ where: { centerId: cs, periodKey: "2026-11" }, data: { status: "OPEN" } });
    await duyet(id);
    expect(await luotPA(id)).toHaveLength(1);
  });

  it("[PA-DB-05] cờ kỳ CẢ HAI vế: kỳ 2026-10 ⇒ KHÔNG có đường phản ánh (chốt 8); không có việc ở ô ⇒ chặn", async () => {
    await viec(NGAY_KY10);
    await expect(gui({ ngay: NGAY_KY10, homNay: "2026-10-25" })).rejects.toThrow(/luồng xác nhận cũ/);
    await expect(gui()).rejects.toThrow(/không có việc/);
    expect(await db.phanAnhCong.count({ where: { userId: gv } })).toBe(0);
  });
});
