// tests/finance/bao-luu-nen.test.ts — NỀN DỮ LIỆU bảo lưu (Phiên 2) trên POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// Đo HÀNH VI của những khoá mà lưới thuần chỉ chứng minh còn nằm trong tệp (bài học F5 GĐ1: một biểu
// thức viết sai vẫn khớp regex mà không chặn gì): trigger bất biến, chỉ mục duy nhất từng phần, cascade,
// RLS, cách ly cơ sở qua scopedDb, ghi kép orgUnitId, mặc định cột mới.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

if (!RUN_DB_TESTS) console.warn(`[BL2-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl2-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU1 = `${T}ou1`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HV1 = `${T}hv1`;
const HV2 = `${T}hv2`;
const GD1 = `${T}gd1`;
const GD2 = `${T}gd2`;
const USER = `${T}user`;

async function don() {
  await db.studentReserveEvent.deleteMany({ where: { reserveId: { startsWith: T } } });
  await db.studentReserve.deleteMany({ where: { id: { startsWith: T } } });
  await db.enrollment.deleteMany({ where: { id: { in: [GD1, GD2] } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: [HV1, HV2] } } });
  await db.orgUnit.deleteMany({ where: { id: OU1 } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function dungFixture() {
  await don();
  for (const [id, ten] of [[CS1, "CS1 BL2"], [CS2, "CS2 BL2"]] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "x" } });
  }
  // CS1 có đơn vị ⇒ ghi kép phải tự điền orgUnitId; CS2 cố ý KHÔNG có ⇒ để trống, không ném.
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "Đơn vị BL2", centerId: CS1 } });
  await db.course.create({ data: { id: KHOA, name: "Khoá BL2", slug: `${T}khoa`, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp BL2", courseId: KHOA } });
  await db.student.create({ data: { id: HV1, name: "HV1 BL2", centerId: CS1 } });
  await db.student.create({ data: { id: HV2, name: "HV2 BL2", centerId: CS2 } });
  await db.enrollment.create({ data: { id: GD1, studentId: HV1, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  await db.enrollment.create({ data: { id: GD2, studentId: HV2, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
}

type Tao = Partial<Prisma.StudentReserveUncheckedCreateInput>;
function taoHoSo(o: Tao = {}) {
  return db.studentReserve.create({
    data: { id: `${T}r-${Math.random().toString(36).slice(2, 8)}`, studentId: HV1, enrollmentId: GD1, reason: "fixture BL2", createdByName: "fixture", centerId: CS1, ...o },
  });
}
const loiPrisma = (p: Promise<unknown>) =>
  p.then(() => null).catch((e: unknown) => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e)));

function actorCoSo(centerId: string): Actor {
  return {
    userId: USER, isSuperAdmin: false, isHoLevel: false, orgRoles: [],
    permissions: [{ action: "bao-luu:view", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_MANAGER", centerScope: [centerId] }],
    visibleCenterIds: [centerId], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}
function actorHo(): Actor {
  return {
    userId: USER, isSuperAdmin: false, isHoLevel: true, orgRoles: [],
    permissions: [{ action: "bao-luu:view", scopeType: "GLOBAL", orgUnitId: "ou-ho", roleCode: "HO_ACCOUNTANT", centerScope: "ALL" }],
    visibleCenterIds: [CS1, CS2], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe.skipIf(!RUN_DB_TESTS)("[BL2-DB-01] mặc định cột mới (đường cũ tạo lượt chỉ với cột cũ vẫn nhất quán)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("tạo chỉ với cột cũ ⇒ status ACTIVE, type PARENT, extendCount 0, evidenceFileKeys [], snapSoBuoiSuyRa false, mọi snap* NULL", async () => {
    const r = await db.studentReserve.create({
      data: { id: `${T}r-cu`, studentId: HV1, reason: "đường cũ", createdByName: "x" },
    });
    expect(r).toMatchObject({
      status: "ACTIVE", type: "PARENT", isActive: true, extendCount: 0, evidenceFileKeys: [], snapSoBuoiSuyRa: false,
      snapUnitPrice: null, snapSessionsRemaining: null, snapTuitionNet: null, snapSoBuoiMua: null,
      centerId: null, applicationFileKey: null, extendRequest: null,
    });
  });

  it("Course.allowPause mặc định true; MakeupNeed.nguon cho NULL", async () => {
    expect((await db.course.findUniqueOrThrow({ where: { id: KHOA } })).allowPause).toBe(true);
    const cot = await db.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns WHERE table_name = 'MakeupNeed' AND column_name = 'nguon'`;
    expect(cot[0]?.is_nullable).toBe("YES");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL2-DB-02] StudentReserveEvent BẤT BIẾN", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("INSERT được; UPDATE bị trigger chặn; hồ sơ bị xoá thì sự kiện đi theo (cascade)", async () => {
    const r = await taoHoSo({ id: `${T}r-ev` });
    const ev = await db.studentReserveEvent.create({ data: { id: `${T}r-ev-1`, reserveId: r.id, kind: "START", actorId: USER, centerId: CS1, note: "ban đầu" } });
    const loi = await db.studentReserveEvent
      .update({ where: { id: ev.id }, data: { note: "sửa" } })
      .then(() => null)
      .catch((e: unknown) => String(e));
    expect(loi).toMatch(/bất biến/);
    expect((await db.studentReserveEvent.findUniqueOrThrow({ where: { id: ev.id } })).note).toBe("ban đầu");

    await db.student.delete({ where: { id: HV1 } });
    expect(await db.studentReserveEvent.count({ where: { id: ev.id } })).toBe(0);
    expect(await db.studentReserve.count({ where: { id: r.id } })).toBe(0);
  });

  it("RLS bật, không FORCE", async () => {
    const r = await db.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'StudentReserveEvent'`;
    expect(r[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL2-DB-03] một ghi danh tối đa MỘT hồ sơ đang mở (chỉ mục duy nhất từng phần)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("hồ sơ thứ hai MỞ cho cùng ghi danh ⇒ P2002 — kể cả khi hồ sơ đầu mới ở PENDING", async () => {
    await taoHoSo({ status: "PENDING", isActive: false });
    expect(await loiPrisma(taoHoSo({ status: "ACTIVE" }))).toBe("P2002");
  });

  it.each(["ENDED", "TERMINATED", "REJECTED", "CANCELLED"] as const)(
    "hồ sơ đầu đã %s ⇒ mở hồ sơ mới được (đối chứng dương: chỉ mục chỉ chặn hồ sơ MỞ)",
    async (dong) => {
      await taoHoSo({ status: dong, isActive: false });
      expect(await loiPrisma(taoHoSo({ status: "PENDING", isActive: false }))).toBeNull();
    },
  );

  it("dòng CẢ HỌC VIÊN (enrollmentId NULL, hồ sơ cũ) KHÔNG nằm trong chỉ mục — hai dòng cùng học viên vẫn tạo được (Phiên 3 chặn bằng mã)", async () => {
    await taoHoSo({ enrollmentId: null });
    expect(await loiPrisma(taoHoSo({ enrollmentId: null }))).toBeNull();
  });

  it("ghi danh KHÁC không bị ảnh hưởng", async () => {
    await taoHoSo();
    expect(await loiPrisma(taoHoSo({ studentId: HV2, enrollmentId: GD2, centerId: CS2 }))).toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL2-DB-04] cách ly cơ sở + ghi kép orgUnitId", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("actor neo CS1 CHỈ thấy hồ sơ CS1 — thấy hồ sơ CS1 (đối chứng dương); actor Hội sở thấy cả hai", async () => {
    const a = await taoHoSo({ centerId: CS1 });
    const b = await taoHoSo({ studentId: HV2, enrollmentId: GD2, centerId: CS2 });
    const loc = { where: { id: { in: [a.id, b.id] } }, select: { id: true as const } };
    expect((await scopedDb(actorCoSo(CS1)).studentReserve.findMany(loc)).map((x) => x.id)).toEqual([a.id]);
    expect((await scopedDb(actorCoSo(CS2)).studentReserve.findMany(loc)).map((x) => x.id)).toEqual([b.id]);
    expect((await scopedDb(actorHo()).studentReserve.findMany(loc)).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("sự kiện cũng cách ly; hồ sơ không có centerId (học viên không cơ sở) KHÔNG hiện với actor cơ sở — chỉ Hội sở thấy", async () => {
    const a = await taoHoSo({ centerId: CS1 });
    await db.studentReserveEvent.create({ data: { reserveId: a.id, kind: "REQUEST", centerId: CS1 } });
    await db.studentReserveEvent.create({ data: { reserveId: a.id, kind: "REQUEST", centerId: CS2 } });
    const sdb = scopedDb(actorCoSo(CS1));
    expect(await sdb.studentReserveEvent.count({ where: { reserveId: a.id } })).toBe(1);

    const moc = await taoHoSo({ studentId: HV2, enrollmentId: GD2, centerId: null });
    const loc = { where: { id: moc.id }, select: { id: true as const } };
    expect(await scopedDb(actorCoSo(CS1)).studentReserve.findMany(loc)).toEqual([]);
    expect(await scopedDb(actorCoSo(CS2)).studentReserve.findMany(loc)).toEqual([]);
    expect((await scopedDb(actorHo()).studentReserve.findMany(loc)).map((x) => x.id)).toEqual([moc.id]);
  });

  it("ghi kép: centerId có OrgUnit ⇒ orgUnitId tự điền; cơ sở chưa có OrgUnit ⇒ để trống, không ném", async () => {
    const a = await taoHoSo({ centerId: CS1 });
    expect((await db.studentReserve.findUniqueOrThrow({ where: { id: a.id } })).orgUnitId).toBe(OU1);
    const b = await taoHoSo({ studentId: HV2, enrollmentId: GD2, centerId: CS2 });
    expect((await db.studentReserve.findUniqueOrThrow({ where: { id: b.id } })).orgUnitId).toBeNull();
  });
});
