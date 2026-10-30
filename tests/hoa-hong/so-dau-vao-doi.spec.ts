// @vitest-environment node
/**
 * [NHH-GATE-*] — MỖI bảng đầu vào của tập Q phải được HAI nơi nhìn thấy khi nó đổi sau lần Tính / lần so gần nhất của ô:
 *   · [NHH-GATE-01] cổng KHOÁ (b)  — `dauVaoMoiNhat` (ky-service.ts): mốc đầu vào mới nhất của kỳ;
 *   · [NHH-GATE-02] tập quét Q4    — `docTapQuet` (quet-ky.ts): khoản có ô mà đầu vào đổi sau `lastCheckedAt`.
 *
 * Vì sao có tệp này — cấy lỗi 08/10: bỏ TỪNG bảng khỏi SQL của hai nơi trên (Payment · Order · OrderItem · Student · CenterCommissionAssignee · Employee ·
 * LeadAttribution) ⇒ 0 ca đỏ. Q2 (09/10): thêm hàng thứ chín — DÒNG NGUỒN (`LeadSourceGroup`): `commissionEnabled` được engine đọc SỐNG nên đổi nó phải làm kỳ đã tính thấy; hàng này chạm
 * `updatedAt` của nguồn bằng SQL thô, ca đi đường ghi THẬT (`suaNguon`) nằm ở `nguon-dong-dau-vao-tien.spec.ts`. Bộ cũ chỉ đo `Lead` (qua `convertedById`) ở cổng khoá, và ở Q4 đo KHÔNG bảng nào: ca `PER-10b` phát hiện trôi bằng Q5
 * (cửa sổ N tháng) chứ không bằng Q4. Header ky-service.ts hứa "kể cả đầu vào KHÔNG chạm Payment.updatedAt (Lead, OrderItem, Student, người phụ trách,
 * nhân sự, nguồn)"; lời hứa ấy chỉ có bằng chứng cho MỘT trong tám.
 *
 * Cách đo: chạm `updatedAt` của đúng MỘT bảng bằng SQL (`clock_timestamp()` của DB — không đồng hồ Node, luật 19), so với mốc T đo cũng từ DB.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { dauVaoMoiNhat } from "../../lib/hoa-hong/ky-service";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docTapQuet } from "../../lib/hoa-hong/quet-ky";
import { boiCanh, D, datMocCutover, donKichBan, dungBe, dungKichBan, ganNguon, lamNhanVien, tienVe, type Be, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-GATE] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

type Ctx = { k: KichBan; be: Be; paymentId: string; employeeId: string };
const DAU_VAO: { ten: string; cham: (c: Ctx) => Promise<unknown> }[] = [
  { ten: "Payment", cham: (c) => db.$executeRaw`UPDATE "Payment" SET "updatedAt" = clock_timestamp() WHERE "id" = ${c.paymentId}` },
  { ten: "Order", cham: (c) => db.$executeRaw`UPDATE "Order" SET "updatedAt" = clock_timestamp() WHERE "id" = ${c.be.orderId}` },
  { ten: "OrderItem", cham: (c) => db.$executeRaw`UPDATE "OrderItem" SET "updatedAt" = clock_timestamp() WHERE "id" = ${c.be.orderItemId}` },
  { ten: "Student", cham: (c) => db.$executeRaw`UPDATE "Student" SET "updatedAt" = clock_timestamp() WHERE "id" = ${c.be.studentId}` },
  { ten: "Lead", cham: (c) => db.$executeRaw`UPDATE "Lead" SET "updatedAt" = clock_timestamp() WHERE "id" = ${c.k.lead!.id}` },
  { ten: "CenterCommissionAssignee", cham: (c) => db.$executeRaw`UPDATE "CenterCommissionAssignee" SET "updatedAt" = clock_timestamp() WHERE "centerId" = ${c.k.centerId}` },
  { ten: "Employee", cham: (c) => db.$executeRaw`UPDATE "Employee" SET "updatedAt" = clock_timestamp() WHERE "id" = ${c.employeeId}` },
  { ten: "LeadAttribution", cham: (c) => db.$executeRaw`UPDATE "LeadAttribution" SET "updatedAt" = clock_timestamp() WHERE "leadId" = ${c.k.lead!.id}` },
  { ten: "LeadSourceGroup", cham: (c) => db.$executeRaw`UPDATE "LeadSourceGroup" SET "updatedAt" = clock_timestamp() WHERE "id" = (SELECT "groupId" FROM "LeadAttribution" WHERE "leadId" = ${c.k.lead!.id})` },
];

const cuaToi: KichBan[] = [];
const nghi = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const dongHoDb = async (): Promise<Date> => (await db.$queryRaw<{ t: Date }[]>`SELECT clock_timestamp() AS t`)[0]!.t;

async function dung(ten: string) {
  const k = await dungKichBan(`gt${ten.toLowerCase().slice(0, 6)}`, { rules: [{ vai: "SALE", rate: 0.03 }] });
  cuaToi.push(k);
  const employeeId = await lamNhanVien(k.sale.id, k.ma); // Sale là NHÂN VIÊN ⇒ chân Employee của SQL có dòng để nối
  await ganNguon(k, "PAID_ADS"); // lead có nguồn ⇒ chân LeadAttribution có dòng
  const be = await dungBe(k, "a");
  const paymentId = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-05") });
  const bc = await boiCanh(k, new Date());
  expect((await quetKhoan(db, bc, paymentId)).loai).toBe("DA_GHI");
  return { k, be, paymentId, employeeId, bc } satisfies Ctx & { bc: typeof bc };
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-GATE] đầu vào đổi ⇒ cổng khoá và tập quét Q4 đều thấy", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it.each(DAU_VAO)("[NHH-GATE-01] $ten đổi SAU lần Tính ⇒ `dauVaoMoiNhat` của kỳ mới hơn mốc (cổng khoá (b) thấy); trước khi đổi thì KHÔNG", async ({ ten, cham }) => {
    const c = await dung(ten);
    const ky = await db.commissionPeriod.findFirstOrThrow({ where: { period: "2026-10", centerId: c.k.centerId } });
    await nghi(25);
    const T = await dongHoDb();
    await nghi(25);
    expect((await dauVaoMoiNhat(db, ky))!.getTime(), "trước khi đổi").toBeLessThanOrEqual(T.getTime());
    await cham(c);
    expect((await dauVaoMoiNhat(db, ky))!.getTime(), `sau khi đổi ${ten}`).toBeGreaterThan(T.getTime());
  });

  it.each(DAU_VAO)("[NHH-GATE-02] $ten đổi SAU lần so gần nhất của ô ⇒ khoản vào tập quét Q4 (kỳ quét là tháng SAU, không có cửa sổ Q5); trước khi đổi thì KHÔNG", async ({ ten, cham }) => {
    const c = await dung(ten);
    const tap = () => docTapQuet(db, c.bc, { thang: "2026-12", centerId: c.k.centerId, soThangDoiSoat: 0 });
    expect(await tap(), "trước khi đổi").not.toContain(c.paymentId);
    await cham(c);
    expect(await tap(), `sau khi đổi ${ten}`).toContain(c.paymentId);
  });
});
