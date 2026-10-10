// Ca [POS2-MIG-02] · [POS2-MIG-03] · [POS2-SC-02] — bảng NHẬT KÝ KIỂM phiếu thu thẻ (`PosCheckLog`)
// trên POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// Vì sao phải đo ở DB (F5 GĐ1): Prisma 5.22 `migrate diff` KHÔNG in CHECK ⇒ kiểm drift "0 dòng"
// không chứng minh chúng tồn tại; lưới `[POS2-MIG-01]` chỉ chứng minh câu SQL còn nằm trong tệp. Một
// biểu thức CHECK viết sai vẫn khớp regex mà không chặn gì — bộ này đo HÀNH VI.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

if (!RUN_DB_TESTS) console.warn(`[POS2-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos2sc-";
const USER = `${T}user`;
const USER_XOA = `${T}user-xoa`;
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU1 = `${T}ou1`;
const DON1 = `${T}don1`;
const DON2 = `${T}don2`;
const PHIEU1 = `${T}bill1`;
const PHIEU2 = `${T}bill2`;
const PHIEU_POS1 = `${T}intent1`;
const PHIEU_POS2 = `${T}intent2`;

/** Đồng hồ ĐÓNG BĂNG (luật 19). */
const LUC = new Date("2026-10-06T03:15:00Z");
const HAN = new Date("2026-10-07T03:15:00Z");

async function don() {
  await db.posCheckLog.deleteMany({ where: { intentId: { in: [PHIEU_POS1, PHIEU_POS2] } } });
  await db.posPaymentIntent.deleteMany({ where: { id: { in: [PHIEU_POS1, PHIEU_POS2] } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: [DON1, DON2] } } });
  await db.order.deleteMany({ where: { id: { in: [DON1, DON2] } } });
  await db.orgUnit.deleteMany({ where: { id: OU1 } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  await db.user.deleteMany({ where: { id: { in: [USER, USER_XOA] } } });
}

async function dungFixture() {
  await don();
  for (const id of [USER, USER_XOA]) {
    await db.user.create({ data: { id, name: "Sale fixture POS2", email: `${id}@test.local`, role: "SALES_CSM", roles: ["SALES_CSM"] } });
  }
  for (const [id, ten] of [
    [CS1, "CS1 fixture POS2"],
    [CS2, "CS2 fixture POS2"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "211 Nguyễn Hữu Thọ" } });
  }
  // CS1 có đơn vị ⇒ ghi kép phải tự điền orgUnitId; CS2 cố ý KHÔNG có ⇒ để trống, không ném.
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "Đơn vị fixture POS2", centerId: CS1 } });
  for (const [id, cs, ma, sdt] of [
    [DON1, CS1, "ORD-269962-000001", "0328545239"],
    [DON2, CS2, "ORD-269962-000002", "0905123467"],
  ] as const) {
    await db.order.create({
      data: { id, code: ma, type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH fixture POS2", customerPhone: sdt, totalAmount: 6_732_000, centerId: cs },
    });
  }
  await db.paymentBill.create({ data: { id: PHIEU1, orderId: DON1, centerId: CS1, amountDue: 3_168_000, matchKey: "K7M2N" } });
  await db.paymentBill.create({ data: { id: PHIEU2, orderId: DON2, centerId: CS2, amountDue: 3_564_000, matchKey: "Q4W8R" } });
  await db.posPaymentIntent.create({
    data: { id: PHIEU_POS1, paymentBillId: PHIEU1, code5: "K7M2N", amount: 3_168_000, centerId: CS1, createdById: USER, createdAt: LUC, expiresAt: HAN },
  });
  await db.posPaymentIntent.create({
    data: { id: PHIEU_POS2, paymentBillId: PHIEU2, code5: "Q4W8R", amount: 3_564_000, centerId: CS2, createdById: USER, createdAt: LUC, expiresAt: HAN },
  });
}

type DongLog = Partial<Prisma.PosCheckLogUncheckedCreateInput>;
function ghiLog(o: DongLog = {}) {
  return db.posCheckLog.create({
    data: {
      intentId: PHIEU_POS1,
      centerId: CS1,
      triggeredBy: "SALE",
      kind: "NOT_FOUND",
      durationMs: 12,
      statusSau: "CHO_QUET",
      createdById: USER,
      createdAt: LUC,
      ...o,
    },
  });
}

/** Toàn văn lỗi — để hỏi TÊN ràng buộc (Prisma không có mã riêng cho CHECK / RESTRICT 23001). */
async function loiDayDu(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function actorCoSo(centerId: string): Actor {
  return {
    userId: USER,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [
      { action: "payments:import-pos", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_ACCOUNTANT", centerScope: [centerId] },
    ],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

function actorHo(): Actor {
  return {
    userId: USER,
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [],
    permissions: [
      { action: "payments:import-pos", scopeType: "GLOBAL", orgUnitId: "ou-ho", roleCode: "HO_ACCOUNTANT", centerScope: "ALL" },
    ],
    visibleCenterIds: [CS1, CS2],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe.skipIf(!RUN_DB_TESTS)("[POS2-MIG-02] PosCheckLog — các khoá mã ứng dụng DỰA VÀO", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS2-MIG-02a] RLS BẬT, không FORCE", async () => {
    const r = await db.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = 'PosCheckLog' AND relkind = 'r'`;
    expect(r).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
  });

  it("[POS2-MIG-02b] ba CHECK tồn tại trong pg_constraint", async () => {
    const r = await db.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"PosCheckLog"'::regclass AND contype = 'c' ORDER BY conname`;
    expect(r.map((x) => x.conname)).toEqual([
      "PosCheckLog_cache_check",
      "PosCheckLog_durationMs_check",
      "PosCheckLog_errorCode_check",
    ]);
  });

  it("[POS2-MIG-02c] CHECK chặn thật: CACHE có thời lượng / có mã GD, thời lượng âm, mã lỗi 65 ký tự", async () => {
    expect(await loiDayDu(ghiLog({ kind: "CACHE", durationMs: 1 }))).toMatch(/PosCheckLog_cache_check/);
    expect(await loiDayDu(ghiLog({ kind: "CACHE", durationMs: 0, providerTxnId: "FT2610060001" }))).toMatch(
      /PosCheckLog_cache_check/,
    );
    expect(await loiDayDu(ghiLog({ durationMs: -1 }))).toMatch(/PosCheckLog_durationMs_check/);
    expect(await loiDayDu(ghiLog({ errorCode: "X".repeat(65) }))).toMatch(/PosCheckLog_errorCode_check/);
    expect(await db.posCheckLog.count({ where: { intentId: PHIEU_POS1 } })).toBe(0);
    // Đối chứng dương: đúng biên vẫn ghi được.
    expect(await loiDayDu(ghiLog({ kind: "CACHE", durationMs: 0 }))).toBeNull();
    expect(await loiDayDu(ghiLog({ errorCode: "X".repeat(64) }))).toBeNull();
    expect(await loiDayDu(ghiLog({ kind: "PAID", durationMs: 0, providerTxnId: "FT2610060001" }))).toBeNull();
    expect(await db.posCheckLog.count({ where: { intentId: PHIEU_POS1 } })).toBe(3);
  });

  it("[POS2-MIG-02d] pg_enum: QUET_SACH nằm CUỐI PosCheckTrigger; PosCheckLogKind đủ 7 giá trị đúng thứ tự", async () => {
    const r = await db.$queryRaw<{ typname: string; enumlabel: string }[]>`
      SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname IN ('PosCheckTrigger', 'PosCheckLogKind') ORDER BY t.typname, e.enumsortorder`;
    const theo = (ten: string) => r.filter((x) => x.typname === ten).map((x) => x.enumlabel);
    expect(theo("PosCheckTrigger")).toEqual(["SALE", "POLLER", "AGENT", "IMPORT", "QUET_SACH"]);
    expect(theo("PosCheckLogKind")).toEqual([
      "PAID",
      "PAID_AMOUNT_MISMATCH",
      "FAILED",
      "NOT_FOUND",
      "CANCELLED_AFTER_PAID",
      "PROVIDER_ERROR",
      "CACHE",
    ]);
  });

  it("[POS2-MIG-02e] ba cột mới của PosTerminal: TEXT, NULLABLE, không DEFAULT", async () => {
    const r = await db.$queryRaw<{ column_name: string; is_nullable: string; data_type: string; column_default: string | null }[]>`
      SELECT column_name, is_nullable, data_type, column_default FROM information_schema.columns
      WHERE table_name = 'PosTerminal' AND column_name IN ('maCuaHang', 'maNhaCungCap', 'maTcbQuay')
      ORDER BY column_name`;
    expect(r).toEqual([
      { column_name: "maCuaHang", is_nullable: "YES", data_type: "text", column_default: null },
      { column_name: "maNhaCungCap", is_nullable: "YES", data_type: "text", column_default: null },
      { column_name: "maTcbQuay", is_nullable: "YES", data_type: "text", column_default: null },
    ]);
  });

  it("[POS2-MIG-02f] createdAt là giá trị APP đặt; ghi kép centerId → orgUnitId tự chạy (CS1 có đơn vị, CS2 không ⇒ trống)", async () => {
    const a = await ghiLog();
    expect(a.createdAt.toISOString()).toBe(LUC.toISOString());
    expect(a.orgUnitId).toBe(OU1);
    const b = await ghiLog({ intentId: PHIEU_POS2, centerId: CS2 });
    expect(b.orgUnitId).toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS2-MIG-03] khoá ngoại: nhật ký giữ dấu phiếu, không giữ chân tài khoản", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("xoá phiếu POS còn nhật ký ⇒ bị chặn (RESTRICT); nhật ký còn nguyên", async () => {
    await ghiLog();
    expect(await loiDayDu(db.posPaymentIntent.delete({ where: { id: PHIEU_POS1 } }))).toMatch(/PosCheckLog_intentId_fkey/);
    expect(await db.posPaymentIntent.count({ where: { id: PHIEU_POS1 } })).toBe(1);
    expect(await db.posCheckLog.count({ where: { intentId: PHIEU_POS1 } })).toBe(1);
  });

  it("xoá cứng tài khoản người bấm ⇒ createdById về NULL, dòng nhật ký CÒN", async () => {
    const d = await ghiLog({ createdById: USER_XOA });
    await db.user.delete({ where: { id: USER_XOA } });
    const sau = await db.posCheckLog.findUniqueOrThrow({ where: { id: d.id } });
    expect(sau.createdById).toBeNull();
    expect(sau.kind).toBe("NOT_FOUND");
  });

  it("khoá ngoại sang phiếu POS KHÔNG tồn tại ⇒ bị chặn P2003", async () => {
    const loi = await ghiLog({ intentId: `${T}khong-co` })
      .then(() => null)
      .catch((e: unknown) => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e)));
    expect(loi).toBe("P2003");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS2-SC-02] scopedDb cách ly nhật ký theo cơ sở", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("actor neo CS1 KHÔNG thấy dòng CS2 — THẤY dòng CS1 (đối chứng dương); actor HO thấy cả hai", async () => {
    const a = await ghiLog();
    const b = await ghiLog({ intentId: PHIEU_POS2, centerId: CS2 });
    const loc = { where: { intentId: { in: [PHIEU_POS1, PHIEU_POS2] } }, select: { id: true as const } };

    const thay1 = await scopedDb(actorCoSo(CS1)).posCheckLog.findMany(loc);
    expect(thay1.map((x) => x.id)).toEqual([a.id]);
    const thay2 = await scopedDb(actorCoSo(CS2)).posCheckLog.findMany(loc);
    expect(thay2.map((x) => x.id)).toEqual([b.id]);
    const ho = await scopedDb(actorHo()).posCheckLog.findMany(loc);
    expect(ho.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    // groupBy cũng được scope (màn tra cứu đếm theo kết quả bằng groupBy).
    const nhom = await scopedDb(actorCoSo(CS1)).posCheckLog.groupBy({
      by: ["kind"],
      where: { intentId: { in: [PHIEU_POS1, PHIEU_POS2] } },
      _count: { _all: true },
    });
    expect(nhom.map((x) => x._count._all)).toEqual([1]);
  });
});
