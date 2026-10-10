// @vitest-environment node
/**
 * [NHH-SC-*] / [NHH-W11] — SỔ HOA HỒNG trên Postgres THẬT: trigger, CHECK, UNIQUE, RLS của migration
 * `20261014110000_hoa_hong_so_cai` (02 §9, §10.1, §10.2, §10.4).
 *
 * Prisma 5 KHÔNG đọc trigger / function / CHECK ⇒ kiểm drift `--from-url` không thấy chúng; đây là migration ĐẦU TIÊN
 * của repo có trigger trên bảng nghiệp vụ. Lưới duy nhất cho chúng là file này: có ai gỡ / DISABLE một trigger hay viết
 * sai một CHECK thì chỉ ca ở đây đỏ.
 *
 * Chạy: `pnpm test:hoa-hong-db`. `pnpm test:unit` trần sẽ SKIP.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE. Dữ liệu mang tiền tố `fx-sc-`; mỗi ca tự dựng nền riêng (luật 18)
 * và KHÔNG xoá dòng sổ (trigger cấm) — mỗi ca dùng id/khoá duy nhất theo bộ đếm nên chạy lại trên cùng DB không đụng nhau.
 * Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { donSoCai } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-SC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = `fx-sc-${Date.now().toString(36)}-`;
let seq = 0;
const NGAY = new Date("2026-11-10T03:00:00.000Z");

type Nen = {
  p: string;
  centerId: string;
  orgUnitId: string;
  userId: string;
  userId2: string;
  roleId: string;
  groupId: string;
  paymentId: string;
  orderId: string;
};

async function nen(): Promise<Nen> {
  const p = `${P}${(seq += 1)}-`;
  const centerId = `${p}cs`;
  await db.center.create({ data: { id: centerId, name: `CS ${p}`, slug: `${p}cs`, address: "x" } });
  const ou = await db.orgUnit.create({
    data: { id: `${p}ou`, code: `${p}OU`.toUpperCase(), name: `ĐV ${p}`, type: "CENTER", centerId, path: `/${p}ou/`, depth: 1 },
  });
  const userId = (await seedUser({ email: `${p}u1@ci.test`, role: "SALES_CSM", name: `NV ${p}1` })).id;
  const userId2 = (await seedUser({ email: `${p}u2@ci.test`, role: "SALES_CSM", name: `NV ${p}2` })).id;
  const role = await db.beneficiaryRole.findUniqueOrThrow({ where: { code: "SALE" } });
  const grp = await db.leadSourceGroup.findFirstOrThrow({ where: { code: "UNKNOWN" } });
  const orderId = `${p}don`;
  await db.order.create({
    data: { id: orderId, code: `${p}don`.toUpperCase(), type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0990000001", totalAmount: 10_000_000, centerId },
  });
  const pay = await db.payment.create({
    data: { id: `${p}pay`, orderId, amount: 10_000_000, method: "cash", paidDate: NGAY, accountantStatus: "CONFIRMED", centerId },
  });
  return { p, centerId, orgUnitId: ou.id, userId, userId2, roleId: role.id, groupId: grp.id, paymentId: pay.id, orderId };
}

const ky = (n: Nen, period: string, status: "OPEN" | "CALCULATED" | "REVIEWING" | "LOCKED" = "OPEN") =>
  db.commissionPeriod.create({ data: { period, centerId: n.centerId, orgUnitId: n.orgUnitId, status } });

const o = (n: Nen, key = "-") =>
  db.commissionCalcSlot.create({
    data: {
      paymentId: n.paymentId,
      orderItemKey: key,
      revenueComponent: "TUITION",
      netBase: 10_000_000,
      firstInputHash: "h",
      lastMatchedHash: "h",
      lastCheckedAt: NGAY,
      originalLineCount: 1,
      centerId: n.centerId,
      orgUnitId: n.orgUnitId,
    },
  });

/** Một dòng sổ đủ cột bắt buộc; `over` ghi đè. */
function dong(n: Nen, periodId: string, calcSlotId: string | null, over: Record<string, unknown> = {}) {
  seq += 1;
  return db.commissionTransaction.create({
    data: {
      idempotencyKey: `${n.p}k${seq}`,
      entryKind: "ORIGINAL",
      calcSlotId,
      periodId,
      naturalPeriod: "2026-11",
      rateDate: NGAY,
      paymentId: n.paymentId,
      orderId: n.orderId,
      transactionTypeCode: "NEW",
      revenueComponent: "TUITION",
      sourceGroupId: n.groupId,
      sourceGroupCode: "UNKNOWN",
      beneficiaryRoleId: n.roleId,
      roleCode: "SALE",
      beneficiaryKind: "USER",
      beneficiaryUserId: n.userId,
      beneficiaryName: "NV",
      resolverType: "TRANSACTION_ROLE",
      reason: "fixture",
      grossAmount: 10_000_000,
      vatRate: 0,
      netBase: 10_000_000,
      rate: 0.03,
      amount: 300_000,
      capRate: 0.09,
      equivalentRate: 0.03,
      inputHash: "h",
      centerId: n.centerId,
      orgUnitId: n.orgUnitId,
      ...over,
    } as never,
  });
}

const chan = (p: Promise<unknown>, mau: string | RegExp) => expect(p).rejects.toThrow(mau);

describe.skipIf(!RUN_DB_TESTS)("[NHH-SC] sổ hoa hồng — trigger · CHECK · UNIQUE · RLS", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
  }, 120_000);
  // Gỡ cơ sở của bộ khỏi cây (soft delete — sổ bất biến nên không xoá cứng được): guardrail kích hoạt của bộ chính-sách liệt kê MỌI cơ sở (luật 18).
  afterAll(async () => {
    await db.orgUnit.updateMany({ where: { id: { startsWith: P } }, data: { deletedAt: new Date() } });
    await donSoCai();
  }, 60_000);

  it("[NHH-SC-01] cả sáu bảng của migration bật RLS (bảng mới ra đời với RLS tắt — sự cố 09/08)", async () => {
    const r = await db.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity FROM pg_class c
      WHERE c.relname IN ('StudentTransaction','CommissionPeriod','CommissionPayoutBatch','CommissionCalcSlot','CommissionTransaction','CommissionHold')`;
    expect(r.map((x) => x.relname).sort()).toEqual(
      ["CommissionCalcSlot", "CommissionHold", "CommissionPayoutBatch", "CommissionPeriod", "CommissionTransaction", "StudentTransaction"],
    );
    expect(r.filter((x) => !x.relrowsecurity).map((x) => x.relname)).toEqual([]);
  });

  it("[NHH-W11] BA trigger của sổ còn tồn tại và ĐANG BẬT (kiểm drift không thấy trigger — 02 §10.1, §12.2)", async () => {
    const r = await db.$queryRaw<{ tgname: string; tgenabled: string }[]>`
      SELECT t.tgname, t.tgenabled::text AS tgenabled FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'CommissionTransaction' AND NOT t.tgisinternal`;
    expect(r.map((x) => x.tgname).sort()).toEqual([
      "CommissionTransaction_bat_bien_bud",
      "CommissionTransaction_ky_mo_bi",
      "CommissionTransaction_rong_khong_am_bi",
    ]);
    // 'O' = bật ở chế độ origin (mặc định). 'D' = ai đó đã DISABLE.
    expect(r.filter((x) => x.tgenabled !== "O")).toEqual([]);
  });

  it("[NHH-SC-02] SỔ BẤT BIẾN: sửa số tiền / xoá ⇒ ném; chỉ 3 cột chi trả đổi được, và payoutStatus chỉ TIẾN", async () => {
    const n = await nen();
    const k = await ky(n, "2026-11");
    const s = await o(n);
    const d = await dong(n, k.id, s.id);

    await chan(db.commissionTransaction.update({ where: { id: d.id }, data: { amount: 999 } }), /sổ bất biến/);
    await chan(db.commissionTransaction.update({ where: { id: d.id }, data: { beneficiaryUserId: n.userId2 } }), /sổ bất biến/);
    await chan(db.commissionTransaction.update({ where: { id: d.id }, data: { reason: "sửa lại cho đẹp" } }), /sổ bất biến/);
    await chan(db.commissionTransaction.delete({ where: { id: d.id } }), /xoá bị chặn/);
    await chan(db.$executeRaw`DELETE FROM "CommissionTransaction" WHERE "id" = ${d.id}`, /xoá bị chặn/);

    // đối chứng dương: tiến PENDING → APPROVED được
    await db.commissionTransaction.update({ where: { id: d.id }, data: { payoutStatus: "APPROVED", payoutStatusAt: NGAY } });
    // lùi ⇒ ném
    await chan(db.commissionTransaction.update({ where: { id: d.id }, data: { payoutStatus: "PENDING" } }), /chỉ tiến/);
    await db.commissionTransaction.update({ where: { id: d.id }, data: { payoutStatus: "PAID" } });
    await chan(db.commissionTransaction.update({ where: { id: d.id }, data: { payoutStatus: "APPROVED" } }), /chỉ tiến/);

    // số tiền không đổi sau cả chuỗi tấn công
    expect((await db.commissionTransaction.findUniqueOrThrow({ where: { id: d.id } })).amount).toBe(300_000);
  });

  it("[NHH-SC-02b] payoutBatchId chỉ ghi MỘT lần (NULL → giá trị), không đổi sang lô khác", async () => {
    const n = await nen();
    const k = await ky(n, "2026-11");
    const s = await o(n);
    const d = await dong(n, k.id, s.id);
    const b1 = await db.commissionPayoutBatch.create({ data: { kind: "PAYROLL", month: "2026-11", lineCount: 1, totalAmount: 300_000, createdById: n.userId } });
    const b2 = await db.commissionPayoutBatch.create({ data: { kind: "PAYROLL", month: "2026-11", lineCount: 1, totalAmount: 300_000, createdById: n.userId } });
    await db.commissionTransaction.update({ where: { id: d.id }, data: { payoutBatchId: b1.id } });
    await chan(db.commissionTransaction.update({ where: { id: d.id }, data: { payoutBatchId: b2.id } }), /chỉ ghi một lần/);
  });

  it("[NHH-SC-03] KỲ MỞ: INSERT vào kỳ LOCKED/REVIEWING ⇒ ném; OPEN và CALCULATED ⇒ qua (lớp dưới của cổng ghiSo)", async () => {
    const n = await nen();
    const s = await o(n);
    const kMo = await ky(n, "2026-11");
    const kTinh = await ky(n, "2026-12", "CALCULATED");
    const kXet = await ky(n, "2027-01", "REVIEWING");
    const kKhoa = await ky(n, "2027-02", "LOCKED");
    await dong(n, kMo.id, s.id);
    await dong(n, kTinh.id, s.id, { entryKind: "LATE_ARRIVAL", amount: 100 });
    await chan(dong(n, kXet.id, s.id), /không ghi thêm dòng sổ/);
    await chan(dong(n, kKhoa.id, s.id), /không ghi thêm dòng sổ/);
  });

  it("[NHH-SC-04] RÒNG KHÔNG ÂM: dòng âm làm Σ ròng (ô × vai × người) < 0 ⇒ ném; theo TỪNG người, không gộp", async () => {
    const n = await nen();
    const k = await ky(n, "2026-11");
    const s = await o(n);
    const goc = await dong(n, k.id, s.id); // +300.000 cho u1
    await dong(n, k.id, s.id, { beneficiaryUserId: n.userId2, amount: 300_000 }); // +300.000 cho u2 — KHÔNG được bù cho u1

    const dao = (userId: string, amount: number, ref: string) =>
      dong(n, k.id, s.id, { entryKind: "REVERSAL", refEntryId: ref, beneficiaryUserId: userId, amount });
    await dao(n.userId, -120_000, goc.id); // ròng u1 còn 180.000
    await chan(dao(n.userId, -200_000, goc.id), /không đảo quá số đã ghi/); // 180.000 − 200.000 < 0
    await dao(n.userId, -180_000, goc.id); // đảo sạch về đúng 0 — qua
    await chan(dao(n.userId, -1, goc.id), /không đảo quá số đã ghi/);
  });

  it("[NHH-SC-05] CHECK chặn dòng sai hình: amount=0 · ORIGINAL không ô · USER không userId · vatRate=1 · REVERSAL dương/thiếu gốc", async () => {
    const n = await nen();
    const k = await ky(n, "2026-11");
    const s = await o(n);
    const goc = await dong(n, k.id, s.id);
    // ORIGINAL amount=0 sẽ vướng `loai_dong_chk` trước (Postgres duyệt CHECK theo thứ tự tên) ⇒ dùng một kind không bị `loai_dong_chk` ràng.
    await chan(dong(n, k.id, s.id, { entryKind: "INPUT_CORRECTION", amount: 0 }), "CommissionTransaction_so_tien_chk");
    await chan(dong(n, k.id, s.id, { amount: 0 }), "CommissionTransaction_loai_dong_chk");
    await chan(dong(n, k.id, null), "CommissionTransaction_o_tinh_chk");
    await chan(dong(n, k.id, s.id, { beneficiaryUserId: null }), "CommissionTransaction_nguoi_huong_chk");
    await chan(dong(n, k.id, s.id, { beneficiaryKind: "AFFILIATE" }), "CommissionTransaction_nguoi_huong_chk");
    await chan(dong(n, k.id, s.id, { vatRate: 1 }), "CommissionTransaction_vat_chk");
    await chan(dong(n, k.id, s.id, { entryKind: "REVERSAL", refEntryId: goc.id, amount: 10 }), "CommissionTransaction_loai_dong_chk");
    await chan(dong(n, k.id, s.id, { entryKind: "REVERSAL", refEntryId: null, amount: -10 }), "CommissionTransaction_loai_dong_chk");
    await chan(dong(n, k.id, s.id, { entryKind: "ORIGINAL", amount: -5 }), "CommissionTransaction_loai_dong_chk");
    // LEGACY_REVERSAL không có ô
    await chan(dong(n, k.id, s.id, { entryKind: "LEGACY_REVERSAL", amount: -5 }), "CommissionTransaction_o_tinh_chk");
    await dong(n, k.id, null, { entryKind: "LEGACY_REVERSAL", amount: -5, legacyTier: "SALE" }); // đối chứng dương
  });

  it("[NHH-SC-06] UNIQUE: idempotencyKey và ô (khoản × dòng đơn × thành phần) — lượt thứ hai bị chặn ở DB", async () => {
    const n = await nen();
    const k = await ky(n, "2026-11");
    const s = await o(n);
    await expect(o(n)).rejects.toMatchObject({ code: "P2002" }); // cùng (payment, "-", TUITION)
    await o(n, "oi-khac"); // đối chứng: khoá dòng đơn khác ⇒ ô khác
    const d = await dong(n, k.id, s.id, { idempotencyKey: `${n.p}trung` });
    expect(d.id).toBeTruthy();
    await expect(dong(n, k.id, s.id, { idempotencyKey: `${n.p}trung` })).rejects.toMatchObject({ code: "P2002" });
  });

  it("[NHH-SC-07] kỳ UNIQUE (tháng × cơ sở) và (tháng × đơn vị); hàng chờ mềm KHÔNG được mang kỳ chặn (CHECK)", async () => {
    const n = await nen();
    const k = await ky(n, "2026-11");
    await expect(ky(n, "2026-11")).rejects.toMatchObject({ code: "P2002" });
    // Mỗi chỉ mục UNIQUE phải TỰ ĐỨNG ĐƯỢC. Bản trùng ở trên vi phạm CẢ HAI (cùng cơ sở lẫn cùng đơn vị) nên gỡ một trong hai chỉ mục vẫn bị cái còn lại chặn — cấy 08/10: DROP INDEX
    // "CommissionPeriod_period_centerId_key" ⇒ 0 ca đỏ. Hai ca dưới chỉ vi phạm MỘT chỉ mục mỗi ca (cơ sở/đơn vị còn lại thuộc nền thứ hai nên chưa có kỳ tháng 11).
    const n2 = await nen();
    await expect(db.commissionPeriod.create({ data: { period: "2026-11", centerId: n.centerId, orgUnitId: n2.orgUnitId, status: "OPEN" } })).rejects.toThrow(/period.*centerId/);
    await expect(db.commissionPeriod.create({ data: { period: "2026-11", centerId: n2.centerId, orgUnitId: n.orgUnitId, status: "OPEN" } })).rejects.toThrow(/period.*orgUnitId/);
    await ky(n, "2026-12"); // đối chứng: tháng khác qua
    const mem = (code: "UNRESOLVED_BENEFICIARY" | "CHUA_GAN_CON", blockingPeriodId: string | null) =>
      db.commissionHold.create({
        data: { holdKey: `${n.p}${code}`, code, severity: "SOFT", paymentId: n.paymentId, blockingPeriodId, detail: {}, centerId: n.centerId, orgUnitId: n.orgUnitId },
      });
    await chan(mem("UNRESOLVED_BENEFICIARY", k.id), "CommissionHold_khong_chan_chk");
    await mem("UNRESOLVED_BENEFICIARY", null);
    await mem("CHUA_GAN_CON", k.id); // đối chứng dương: hàng chờ mềm KHÁC được chặn khoá
  });

  it("[NHH-SC-08] StudentTransaction: CLASSIFIED ⇔ có mã loại giao dịch (CHECK)", async () => {
    const n = await nen();
    const dongDon = await db.orderItem.create({
      data: { id: `${n.p}oi`, orderId: n.orderId, type: "COURSE_ENROLLMENT", itemName: "x", quantity: 1, unitPrice: 1, totalPrice: 1 },
    });
    const base = { orderItemId: dongDon.id, orderId: n.orderId, revenueComponent: "TUITION" as const, reasonCode: "FIRST_PURCHASE", rulesetVersion: "t" };
    await chan(db.studentTransaction.create({ data: { ...base, status: "CLASSIFIED", transactionTypeCode: null } }), "StudentTransaction_loai_chk");
    await chan(db.studentTransaction.create({ data: { ...base, status: "MANUAL_REVIEW_REQUIRED", transactionTypeCode: "NEW" } }), "StudentTransaction_loai_chk");
    await db.studentTransaction.create({ data: { ...base, status: "CLASSIFIED", transactionTypeCode: "NEW" } });
  });
});
