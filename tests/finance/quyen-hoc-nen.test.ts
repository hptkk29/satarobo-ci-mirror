// tests/finance/quyen-hoc-nen.test.ts — NỀN DỮ LIỆU quyền học theo phạm vi trên POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// Đo HÀNH VI của những ràng buộc mà lưới thuần chỉ chứng minh còn nằm trong tệp: các CHECK của BA, chỉ mục
// duy nhất TỪNG PHẦN (Prisma không model), khoá `(entitlementId, lessonOrder)`, cascade, RLS, cách ly cơ sở
// qua scopedDb và ghi kép orgUnitId.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

if (!RUN_DB_TESTS) console.warn(`[QHN-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-qhn-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU1 = `${T}ou1`;
const USER = `${T}user`;

async function don() {
  await db.studyEntitlementUsage.deleteMany({ where: { entitlementId: { startsWith: T } } });
  await db.studyEntitlement.deleteMany({ where: { id: { startsWith: T } } });
  await db.orgUnit.deleteMany({ where: { id: OU1 } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
}

async function dungFixture() {
  await don();
  for (const [id, ten] of [[CS1, "CS1 QHN"], [CS2, "CS2 QHN"]] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "x" } });
  }
  // CS1 có đơn vị ⇒ ghi kép phải tự điền orgUnitId; CS2 cố ý KHÔNG có ⇒ để trống, không ném.
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "Đơn vị QHN", centerId: CS1 } });
}

let dem = 0;
const id = (h: string) => `${T}${h}-${++dem}`;

/** Bản ghi HỢP LỆ tối thiểu: 24 buổi, bài 13–36, 5.016.000 = 5.280.000 − 264.000. */
function hopLe(o: Partial<Prisma.StudyEntitlementUncheckedCreateInput> = {}): Prisma.StudyEntitlementUncheckedCreateInput {
  const k = id("e");
  return {
    id: k,
    studentId: `${T}hv`,
    courseId: `${T}khoa`,
    orderId: `${T}don-${k}`,
    orderItemId: `${T}dong-${k}`,
    centerId: CS1,
    purchaseKind: "MILESTONE",
    purchaseSessions: 24,
    startLessonOrder: 13,
    endLessonOrder: 36,
    listAmount: 5_280_000,
    discountAmount: 264_000,
    netAmount: 5_016_000,
    pricingSnapshot: { gia48: 10_560_000 },
    ...o,
  };
}
const tao = (o: Partial<Prisma.StudyEntitlementUncheckedCreateInput> = {}) => db.studyEntitlement.create({ data: hopLe(o) });
const loi = (p: Promise<unknown>) =>
  p.then(() => null).catch((e: unknown) => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e)));
/** Vi phạm CHECK không có mã Prisma riêng ⇒ lỗi thô; lấy tên ràng buộc ra để khẳng định ĐÚNG ràng buộc chặn. */
const chanBoi = (p: Promise<unknown>) =>
  p.then(() => "KHÔNG BỊ CHẶN").catch((e: unknown) => String((e as Error).message));

function actorCoSo(centerId: string): Actor {
  return {
    userId: USER, isSuperAdmin: false, isHoLevel: false, orgRoles: [],
    permissions: [{ action: "entitlements:view", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_MANAGER", centerScope: [centerId] }],
    visibleCenterIds: [centerId], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}
function actorHo(): Actor {
  return {
    userId: USER, isSuperAdmin: false, isHoLevel: true, orgRoles: [],
    permissions: [{ action: "entitlements:view", scopeType: "GLOBAL", orgUnitId: "ou-ho", roleCode: "HO_ACCOUNTANT", centerScope: "ALL" }],
    visibleCenterIds: [CS1, CS2], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe.skipIf(!RUN_DB_TESTS)("[QHN-DB-01] bản ghi hợp lệ và mặc định cột", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("tạo tối thiểu ⇒ AWAITING_PLACEMENT, đã tiêu thụ 0, bỏ qua 0, NEW, PAYMENT, có VAT, không bài/lớp", async () => {
    const e = await tao({ startLessonOrder: null, endLessonOrder: null });
    expect(e).toMatchObject({
      status: "AWAITING_PLACEMENT", consumedSessions: 0, skippedSessions: 0, customerKind: "NEW", origin: "PAYMENT",
      priceIncludesVat: true, graceSessionsGranted: 0, graceSessionsUsed: 0, purchaseOrdinal: 1, courseOrdinal: 1,
      startLessonOrder: null, endLessonOrder: null, enrollmentId: null, classId: null,
    });
    expect(e.createdAt).toBeInstanceOf(Date);
  });

  it("đối chứng dương cho cả nhóm CHECK: bản ghi 24 buổi bài 13–36 hợp lệ tạo được", async () => {
    expect(await loi(tao())).toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHN-DB-02] CHECK — mỗi bất biến của BA bị DB chặn, kể cả khi mã quên", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("số buổi mua < 1 bị chặn bởi purchase_chk", async () => {
    expect(await chanBoi(tao({ purchaseSessions: 0, startLessonOrder: null, endLessonOrder: null }))).toMatch(/StudyEntitlement_purchase_chk/);
  });

  it("đã học + bỏ qua > số mua bị chặn bởi consumed_chk; bằng đúng số mua thì được", async () => {
    expect(await chanBoi(tao({ consumedSessions: 20, skippedSessions: 5 }))).toMatch(/StudyEntitlement_consumed_chk/);
    expect(await loi(tao({ consumedSessions: 20, skippedSessions: 4 }))).toBeNull();
  });

  it("cột âm bị chặn bởi consumed_chk", async () => {
    expect(await chanBoi(tao({ consumedSessions: -1 }))).toMatch(/StudyEntitlement_consumed_chk/);
  });

  it("phạm vi bài: end − start + 1 ≠ số mua bị chặn; chỉ có một đầu bị chặn; cả hai rỗng thì được", async () => {
    expect(await chanBoi(tao({ startLessonOrder: 13, endLessonOrder: 35 }))).toMatch(/StudyEntitlement_scope_chk/);
    expect(await chanBoi(tao({ startLessonOrder: 13, endLessonOrder: null }))).toMatch(/StudyEntitlement_scope_chk/);
    expect(await chanBoi(tao({ startLessonOrder: null, endLessonOrder: 36 }))).toMatch(/StudyEntitlement_scope_chk/);
    expect(await loi(tao({ startLessonOrder: null, endLessonOrder: null }))).toBeNull();
  });

  it("tiền: niêm yết − giảm ≠ thực thu bị chặn; số âm bị chặn", async () => {
    expect(await chanBoi(tao({ netAmount: 5_016_001 }))).toMatch(/StudyEntitlement_amount_chk/);
    expect(await chanBoi(tao({ listAmount: -1, discountAmount: 0, netAmount: -1 }))).toMatch(/StudyEntitlement_amount_chk/);
  });

  it("nguồn PAYMENT bắt buộc có đơn và dòng đơn; MANUAL/LEGACY_BACKFILL thì không", async () => {
    expect(await chanBoi(tao({ orderId: null }))).toMatch(/StudyEntitlement_origin_chk/);
    expect(await chanBoi(tao({ orderItemId: null }))).toMatch(/StudyEntitlement_origin_chk/);
    expect(await loi(tao({ origin: "MANUAL", orderId: null, orderItemId: null }))).toBeNull();
    expect(await loi(tao({ origin: "LEGACY_BACKFILL", orderId: null, orderItemId: null }))).toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHN-DB-03] một lần mua = một quyền học (chỉ mục duy nhất TỪNG PHẦN)", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("hai quyền học cùng orderItemId đang mở ⇒ P2002", async () => {
    await tao({ orderItemId: `${T}dong-a` });
    expect(await loi(tao({ orderItemId: `${T}dong-a` }))).toBe("P2002");
  });

  it("quyền học cũ đã VOIDED thì cấp lại được (đối chứng dương: chỉ mục chỉ chặn dòng chưa VOIDED)", async () => {
    await tao({ orderItemId: `${T}dong-b`, status: "VOIDED" });
    expect(await loi(tao({ orderItemId: `${T}dong-b` }))).toBeNull();
  });

  it("nhiều dòng KHÔNG có orderItemId (MANUAL/LEGACY) không đụng nhau", async () => {
    await tao({ origin: "MANUAL", orderId: null, orderItemId: null });
    expect(await loi(tao({ origin: "MANUAL", orderId: null, orderItemId: null }))).toBeNull();
  });

  it("orderItemId khác nhau thì song song", async () => {
    await tao({ orderItemId: `${T}dong-c` });
    expect(await loi(tao({ orderItemId: `${T}dong-d` }))).toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHN-DB-04] sổ cái từng bài", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("một bài chỉ có MỘT dòng trên mỗi quyền học (bật/tắt voidedAt, không chèn dòng thứ hai) ⇒ P2002", async () => {
    const e = await tao();
    await db.studyEntitlementUsage.create({ data: { entitlementId: e.id, studentId: e.studentId, lessonOrder: 14, source: "CLASS" } });
    expect(
      await loi(db.studyEntitlementUsage.create({ data: { entitlementId: e.id, studentId: e.studentId, lessonOrder: 14, source: "MAKEUP" } })),
    ).toBe("P2002");
  });

  it("cùng bài trên quyền học KHÁC thì được (đối chứng dương)", async () => {
    const a = await tao();
    const b = await tao();
    await db.studyEntitlementUsage.create({ data: { entitlementId: a.id, studentId: a.studentId, lessonOrder: 14, source: "CLASS" } });
    expect(
      await loi(db.studyEntitlementUsage.create({ data: { entitlementId: b.id, studentId: b.studentId, lessonOrder: 14, source: "CLASS" } })),
    ).toBeNull();
  });

  it("bài số < 1 bị chặn bởi lesson_chk", async () => {
    const e = await tao();
    expect(
      await chanBoi(db.studyEntitlementUsage.create({ data: { entitlementId: e.id, studentId: e.studentId, lessonOrder: 0, source: "CLASS" } })),
    ).toMatch(/StudyEntitlementUsage_lesson_chk/);
  });

  it("xoá quyền học thì sổ cái đi theo (cascade); dòng vô hiệu vẫn nằm trong sổ", async () => {
    const e = await tao();
    await db.studyEntitlementUsage.create({
      data: { entitlementId: e.id, studentId: e.studentId, lessonOrder: 14, source: "CLASS", voidedAt: new Date(), voidReason: "sửa điểm danh" },
    });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id } })).toBe(1);
    await db.studyEntitlement.delete({ where: { id: e.id } });
    expect(await db.studyEntitlementUsage.count({ where: { entitlementId: e.id } })).toBe(0);
  });

  it("chuỗi nối tiếp: xoá quyền học trước thì con trỏ prev của quyền sau về NULL, quyền sau còn nguyên", async () => {
    const a = await tao();
    const b = await tao({ prevEntitlementId: a.id });
    await db.studyEntitlement.delete({ where: { id: a.id } });
    expect((await db.studyEntitlement.findUniqueOrThrow({ where: { id: b.id } })).prevEntitlementId).toBeNull();
  });

  it("RLS bật, không FORCE — cho cả hai bảng", async () => {
    for (const ten of ["StudyEntitlement", "StudyEntitlementUsage"]) {
      const r = await db.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ${ten}`;
      expect({ ten, ...r[0] }).toEqual({ ten, relrowsecurity: true, relforcerowsecurity: false });
    }
  });
});

describe.skipIf(!RUN_DB_TESTS)("[QHN-DB-05] cách ly cơ sở + ghi kép orgUnitId", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("actor neo CS1 CHỈ thấy quyền học CS1 — thấy quyền học CS1 (đối chứng dương); actor Hội sở thấy cả hai", async () => {
    const a = await tao({ centerId: CS1 });
    const b = await tao({ centerId: CS2 });
    const loc = { where: { id: { in: [a.id, b.id] } }, select: { id: true as const } };
    expect((await scopedDb(actorCoSo(CS1)).studyEntitlement.findMany(loc)).map((x) => x.id)).toEqual([a.id]);
    expect((await scopedDb(actorCoSo(CS2)).studyEntitlement.findMany(loc)).map((x) => x.id)).toEqual([b.id]);
    expect((await scopedDb(actorHo()).studyEntitlement.findMany(loc)).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("vai neo Hội sở nhưng quyền quyền-học chỉ ở CS1 ⇒ CHỈ thấy CS1 (prefix entitlements: có tác dụng); thiếu map thì rơi về ALL", async () => {
    const a = await tao({ centerId: CS1 });
    const b = await tao({ centerId: CS2 });
    const hoNhungChiCs1 = {
      ...actorHo(),
      permissions: [{ action: "entitlements:view", scopeType: "GLOBAL", orgUnitId: "ou-cs1", roleCode: "CENTER_MANAGER", centerScope: [CS1] }],
    } as unknown as Actor;
    const loc = { where: { id: { in: [a.id, b.id] } }, select: { id: true as const } };
    expect((await scopedDb(hoNhungChiCs1).studyEntitlement.findMany(loc)).map((x) => x.id)).toEqual([a.id]);
  });

  it("ghi kép: centerId có OrgUnit ⇒ orgUnitId tự điền; cơ sở chưa có OrgUnit ⇒ để trống, không ném", async () => {
    const a = await tao({ centerId: CS1 });
    expect((await db.studyEntitlement.findUniqueOrThrow({ where: { id: a.id } })).orgUnitId).toBe(OU1);
    const b = await tao({ centerId: CS2 });
    expect((await db.studyEntitlement.findUniqueOrThrow({ where: { id: b.id } })).orgUnitId).toBeNull();
  });
});
