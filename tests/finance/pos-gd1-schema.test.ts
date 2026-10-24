// Ca [POS1-MIG-02] · [POS1-SC-02] — bảng PHIẾU THU THẺ (`PosPaymentIntent`) trên POSTGRES THẬT.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
//
// Vì sao phải đo ở DB (F5 của docs/pos-gd1-thiet-ke.md): Prisma 5.22 `migrate diff` KHÔNG in chỉ
// mục từng phần lẫn CHECK ⇒ kiểm drift "0 dòng" không chứng minh chúng tồn tại; lưới ghim
// `[POS1-MIG-01]` chỉ chứng minh câu SQL còn nằm trong tệp. Một `WHERE` viết sai vẫn khớp regex
// mà không chặn gì — bộ này đo HÀNH VI.
//
// Luật "một phiếu POS ĐANG MỞ mỗi phiếu gộp" PHẢI do DB gác: sale bấm hai lần, hai tab, hoặc nút
// ‖ lượt đồng bộ import cùng lúc ⇒ kiểm-rồi-ghi ở tầng mã cùng thấy 0 và cùng tạo ⇒ hai mã sống
// cho cùng một phiếu gộp.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

if (!RUN_DB_TESTS) console.warn(`[POS1-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pos1sc-";
const USER = `${T}user`;
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU1 = `${T}ou1`;
const DON1 = `${T}don1`;
const DON2 = `${T}don2`;
const PHIEU1 = `${T}bill1`;
const PHIEU2 = `${T}bill2`;
const MAY = "FXPOS1SCMAY01";
const GD = `${T}bt`;

/** Đồng hồ ĐÓNG BĂNG (luật 19) — cũng là thứ app đặt vào `createdAt` (T18). */
const LUC = new Date("2026-10-06T03:15:00Z");
const HAN = new Date("2026-10-07T03:15:00Z");

async function don() {
  await db.posPaymentIntent.deleteMany({ where: { createdById: USER } });
  await db.bankTransaction.deleteMany({ where: { id: GD } });
  await db.posTerminal.deleteMany({ where: { maThietBi: MAY } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: [DON1, DON2] } } });
  await db.order.deleteMany({ where: { id: { in: [DON1, DON2] } } });
  await db.orgUnit.deleteMany({ where: { id: OU1 } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  await db.user.deleteMany({ where: { id: USER } });
}

async function dungFixture() {
  await don();
  await db.user.create({
    data: { id: USER, name: "Sale fixture POS1", email: `${USER}@test.local`, role: "SALES_CSM", roles: ["SALES_CSM"] },
  });
  for (const [id, ten] of [
    [CS1, "CS1 fixture POS1"],
    [CS2, "CS2 fixture POS1"],
  ] as const) {
    await db.center.create({ data: { id, name: ten, slug: id, address: "211 Nguyễn Hữu Thọ" } });
  }
  // CS1 có đơn vị ⇒ ghi kép phải tự điền orgUnitId; CS2 cố ý KHÔNG có ⇒ để trống, không ném.
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "Đơn vị fixture POS1", centerId: CS1 } });
  await db.posTerminal.create({ data: { maThietBi: MAY, maQuay: "Q1", centerId: CS1 } });
  for (const [id, cs, ma, sdt] of [
    [DON1, CS1, "ORD-269961-000001", "0328545229"],
    [DON2, CS2, "ORD-269961-000002", "0905123457"],
  ] as const) {
    await db.order.create({
      data: {
        id,
        code: ma,
        type: "COURSE",
        status: "PENDING_PAYMENT",
        customerName: "Phụ huynh fixture POS1",
        customerPhone: sdt,
        totalAmount: 6_732_000,
        centerId: cs,
      },
    });
  }
  await db.paymentBill.create({ data: { id: PHIEU1, orderId: DON1, centerId: CS1, amountDue: 3_168_000, matchKey: "K7M2N" } });
  await db.paymentBill.create({ data: { id: PHIEU2, orderId: DON2, centerId: CS2, amountDue: 3_564_000, matchKey: "Q4W8R" } });
}

type MoPhieu = Partial<Prisma.PosPaymentIntentUncheckedCreateInput>;
function phieuPos(o: MoPhieu = {}) {
  return db.posPaymentIntent.create({
    data: {
      paymentBillId: PHIEU1,
      code5: "K7M2N",
      amount: 3_168_000,
      centerId: CS1,
      createdById: USER,
      createdAt: LUC,
      expiresAt: HAN,
      ...o,
    },
  });
}

/** Mã lỗi Prisma — `null` nếu lời hứa KHÔNG bị từ chối. */
async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Prisma.PrismaClientKnownRequestError ? e.code : String(e);
  }
}

/** Toàn văn lỗi — để hỏi TÊN ràng buộc CHECK (Prisma không có mã riêng cho CHECK). */
async function loiDayDu(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Actor cấp CƠ SỞ — đúng hình dạng `resolveScope` đọc (quyền `payments:*` neo ở cơ sở). */
function saleCoSo(centerId: string): Actor {
  return {
    userId: USER,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [
      { action: "payments:pos-check", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_SALES_CSM", centerScope: [centerId] },
      { action: "payments:record", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "CENTER_SALES_CSM", centerScope: [centerId] },
    ],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as unknown as Actor;
}

describe.skipIf(!RUN_DB_TESTS)("[POS1-MIG-02] PosPaymentIntent — các khoá mà mã ứng dụng sẽ DỰA VÀO", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[POS1-MIG-02a] RLS BẬT, không FORCE", async () => {
    const r = await db.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = 'PosPaymentIntent' AND relkind = 'r'`;
    expect(r).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
  });

  it("[POS1-MIG-02b] chỉ mục từng phần TỒN TẠI và mang đúng điều kiện WHERE", async () => {
    const r = await db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'PosPaymentIntent' AND indexname = 'PosPaymentIntent_paymentBillId_mo_key'`;
    expect(r).toHaveLength(1);
    expect(r[0]!.indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(r[0]!.indexdef).toMatch(/WHERE/);
    expect(r[0]!.indexdef).toMatch(/'CHO_QUET'/);
    expect(r[0]!.indexdef).toMatch(/'THAT_BAI'/);
    expect(r[0]!.indexdef).not.toMatch(/'DA_THU'/);
  });

  it("[POS1-MIG-02c] HAI phiếu MỞ (CHO_QUET ‖ THAT_BAI) cùng phiếu gộp ⇒ DB từ chối P2002", async () => {
    await phieuPos();
    expect(await maLoi(phieuPos())).toBe("P2002");
    expect(await maLoi(phieuPos({ status: "THAT_BAI" }))).toBe("P2002");
    expect(await db.posPaymentIntent.count({ where: { paymentBillId: PHIEU1 } })).toBe(1);
  });

  it("[POS1-MIG-02d] đối chứng dương: phiếu ĐÃ ĐÓNG không giữ chỗ — mở phiếu mới được", async () => {
    for (const status of ["DA_THU", "LECH_TIEN", "CAN_XU_LY", "HET_HAN", "HUY"] as const) {
      await phieuPos({ status });
    }
    expect(await maLoi(phieuPos())).toBeNull();
    // Phiếu gộp KHÁC thì luôn độc lập.
    expect(await maLoi(phieuPos({ paymentBillId: PHIEU2, code5: "Q4W8R", centerId: CS2 }))).toBeNull();
  });

  it("[POS1-MIG-02e] CHECK: số tiền 0 / âm, mã khác 5 ký tự, hạn ≤ lúc tạo ⇒ bị chặn", async () => {
    expect(await loiDayDu(phieuPos({ amount: 0 }))).toMatch(/PosPaymentIntent_amount_check/);
    expect(await loiDayDu(phieuPos({ amount: -1 }))).toMatch(/PosPaymentIntent_amount_check/);
    expect(await loiDayDu(phieuPos({ code5: "K7M2" }))).toMatch(/PosPaymentIntent_code5_check/);
    expect(await loiDayDu(phieuPos({ code5: "K7M2NX" }))).toMatch(/PosPaymentIntent_code5_check/);
    expect(await loiDayDu(phieuPos({ expiresAt: LUC }))).toMatch(/PosPaymentIntent_expiresAt_check/);
    expect(await db.posPaymentIntent.count({ where: { createdById: USER } })).toBe(0);
  });

  it("[POS1-MIG-02f] một giao dịch thẻ cho tối đa MỘT phiếu POS (bankTransactionId unique)", async () => {
    await db.bankTransaction.create({
      data: { id: GD, provider: "CARD_POS", providerTxnId: `${T}txn`, amount: 3_168_000, transferredAt: LUC, centerId: CS1 },
    });
    await phieuPos({ status: "DA_THU", bankTransactionId: GD });
    expect(await maLoi(phieuPos({ status: "CAN_XU_LY", bankTransactionId: GD }))).toBe("P2002");
  });

  it("[POS1-MIG-02g] khoá ngoại RESTRICT: không xoá được phiếu gộp / máy / giao dịch còn phiếu POS trỏ tới", async () => {
    const may = await db.posTerminal.findUniqueOrThrow({ where: { maThietBi: MAY } });
    await db.bankTransaction.create({
      data: { id: GD, provider: "CARD_POS", providerTxnId: `${T}txn`, amount: 3_168_000, transferredAt: LUC, centerId: CS1 },
    });
    await phieuPos({ status: "DA_THU", posTerminalId: may.id, bankTransactionId: GD });
    // ON DELETE RESTRICT ném 23001 (restrict_violation) — Prisma 5.22 KHÔNG dịch thành P2003 (mã
    // đó là 23503 của NO ACTION), nên hỏi TÊN khoá ngoại trong thông điệp, không hỏi mã.
    expect(await loiDayDu(db.paymentBill.delete({ where: { id: PHIEU1 } }))).toMatch(/PosPaymentIntent_paymentBillId_fkey/);
    expect(await loiDayDu(db.posTerminal.delete({ where: { id: may.id } }))).toMatch(/PosPaymentIntent_posTerminalId_fkey/);
    expect(await loiDayDu(db.bankTransaction.delete({ where: { id: GD } }))).toMatch(/PosPaymentIntent_bankTransactionId_fkey/);
    expect(await db.paymentBill.count({ where: { id: PHIEU1 } })).toBe(1);
    // Khoá ngoại sang phiếu gộp KHÔNG tồn tại ⇒ cũng bị chặn.
    expect(await maLoi(phieuPos({ paymentBillId: `${T}khong-co` }))).toBe("P2003");
  });

  it("[POS1-MIG-02h] ghi kép centerId → orgUnitId tự chạy (CS1 có đơn vị), CS2 không đơn vị ⇒ để trống, không ném", async () => {
    const p1 = await phieuPos();
    expect(p1.orgUnitId).toBe(OU1);
    const p2 = await phieuPos({ paymentBillId: PHIEU2, code5: "Q4W8R", centerId: CS2 });
    expect(p2.orgUnitId).toBeNull();
  });

  it("[POS1-MIG-02i] createdAt là giá trị APP đặt (T18), không bị DB ghi đè", async () => {
    const p = await phieuPos();
    expect(p.createdAt.toISOString()).toBe(LUC.toISOString());
    expect(p.status).toBe("CHO_QUET");
    expect(p.provider).toBe("CARD_POS");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[POS1-SC-02] scopedDb cách ly phiếu POS theo cơ sở", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("sale CS1 KHÔNG thấy phiếu POS của CS2 — và THẤY của CS1 (đối chứng dương)", async () => {
    const p1 = await phieuPos();
    const p2 = await phieuPos({ paymentBillId: PHIEU2, code5: "Q4W8R", centerId: CS2 });

    const sdb1 = scopedDb(saleCoSo(CS1));
    const thay1 = await sdb1.posPaymentIntent.findMany({ where: { createdById: USER }, select: { id: true } });
    expect(thay1.map((x) => x.id)).toEqual([p1.id]);
    expect(await sdb1.posPaymentIntent.findFirst({ where: { id: p2.id } })).toBeNull();

    const sdb2 = scopedDb(saleCoSo(CS2));
    const thay2 = await sdb2.posPaymentIntent.findMany({ where: { createdById: USER }, select: { id: true } });
    expect(thay2.map((x) => x.id)).toEqual([p2.id]);
  });
});
