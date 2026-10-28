// tests/finance/chuyen-khoan-hoan-tac-db.test.ts — [CKH-DB-*] HOÀN TÁC sau COMMIT của P7-B v2 trên Postgres THẬT: chuyển → hoàn tác → trạng thái trước lượt chuyển, có kiểm trạng thái hiện tại, cổng ký RIÊNG, nhật ký.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/chuyen-khoan-hoan-tac-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Fixture tiền tố `CKH_` (tách khỏi `CKG_` để hai bộ không giẫm nhau); khoá EPHEMERAL; môi trường `test`; KHÔNG `resetDb()`.
// Ánh xạ yêu cầu → ca:
//   hoàn tác đưa ĐÚNG về trước lượt chuyển, phần khác y nguyên ⇒ [00]   |   chuyển → hoàn tác → chuyển lại → hoàn tác lại ⇒ [01]   |   idempotent / không hoàn tác hai lần ⇒ [02]
//   trạng thái hiện tại đổi sau lượt chuyển ⇒ dừng, không sửa nửa vời ⇒ [03]   |   cổng ký RIÊNG ⇒ [04]   |   rollback toàn lô khi lỗi giữa chừng ⇒ [05]   |   không nhật ký ⇒ không hoàn tác ⇒ [06]
//   hai phiên cùng hoàn tác ⇒ [07]   |   bằng chứng bất biến ⇒ [08]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { ACTOR_CHUYEN_KHOAN, docKeHoachChuyenKhoan, ghiChuyenKhoan } from "@/lib/nguon/chuyen-khoan-ghi-danh-db";
import type { CapYeuCau } from "@/lib/nguon/chuyen-khoan-ghi-danh";
import { ACTOR_HOAN_TAC, docKeHoachHoanTac, ghiHoanTac, type DauVaoGhiHoanTac } from "@/lib/nguon/chuyen-khoan-hoan-tac-db";
import type { CapHoanTac, KeHoachHoanTac } from "@/lib/nguon/chuyen-khoan-hoan-tac";
import { giaDichWaveCB } from "@/lib/nguon/wave-c-sua-gia-ghi-danh";

if (!RUN_DB_TESTS) console.warn(`[CKH-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "CKH_";
const CS1 = `${P}cs1`;
const KHOA = `${P}khoa`;
const LOP_CU = `${P}lopcu`;
const LOP_MOI = `${P}lopmoi`;
const N = 2;
const id = (k: string, i: number) => `${P}${k}${i}`;
const CU = (i: number) => id("ecu", i);
const MOI = (i: number) => id("emoi", i);
const GIA = { listPrice: 10_560_000, discountType: null, discountAmount: 0, tuition: 10_560_000, finalPrice: 10_560_000 };
const TRONG = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
const TIEN = [[8_976_000], [2_508_000, 2_508_000]] as const;
const GOI = [giaDichWaveCB(10_560_000, 15), giaDichWaveCB(5_280_000, 5)] as const;
const capChuyen = (i: number): CapYeuCau => ({ cuId: CU(i), moiId: MOI(i), giaMoi: GOI[i]! });
const CAP_CHUYEN: readonly CapYeuCau[] = [capChuyen(0), capChuyen(1)];
const capHT = (i: number): CapHoanTac => ({ cuId: CU(i), moiId: MOI(i) });
const CAP_HT: readonly CapHoanTac[] = [capHT(0), capHT(1)];
const MOC = new Date("2026-10-26T03:00:00.000Z");
const NGAY_THU = new Date("2026-09-20T03:00:00.000Z");
const nonceDaDung: string[] = [];
let demNonce = 0;
let demLuot = 0;
const luot = () => ({ batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: `98400${String(++demLuot).padStart(2, "0")}`, runAttempt: "1" } });

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: "luot:98400" } }] } });
  for (const t of ["boom"]) {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ckh_${t}_trg ON "Enrollment"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ckh_${t}()`);
  }
  await db.receipt.deleteMany({ where: { id: { startsWith: P } } });
  await db.commissionLine.deleteMany({ where: { id: { startsWith: P } } });
  await db.commissionStatement.deleteMany({ where: { id: { startsWith: P } } });
  await db.payment.deleteMany({ where: { id: { startsWith: P } } });
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.order.deleteMany({ where: { id: { startsWith: P } } });
  await db.enrollment.updateMany({ where: { id: { startsWith: P } }, data: { transferredToId: null } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: P } } });
  await db.student.deleteMany({ where: { id: { startsWith: P } } });
  await db.leadChild.deleteMany({ where: { id: { startsWith: P } } });
  await db.lead.deleteMany({ where: { id: { startsWith: P } } });
  await db.class.deleteMany({ where: { id: { in: [LOP_CU, LOP_MOI] } } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.center.deleteMany({ where: { id: CS1 } });
}

async function taoCap(i: number) {
  const phone = `098900000${i}`;
  await db.lead.create({ data: { id: id("l", i), parentName: `PH CKH ${i}`, phone, status: "DA_DANG_KY", centerId: CS1 } });
  await db.leadChild.create({ data: { id: id("be", i), leadId: id("l", i), fullName: `Bé CKH ${i}` } });
  await db.student.create({ data: { id: id("s", i), name: `Bé CKH ${i}`, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, parentPhone: phone } });
  await db.enrollment.create({ data: { id: MOI(i), studentId: id("s", i), classId: LOP_MOI, courseId: KHOA, status: "STUDYING", centerId: CS1, notes: `moi ${i}` } });
  await db.enrollment.create({
    data: {
      id: CU(i), studentId: id("s", i), classId: LOP_CU, courseId: KHOA, status: i === 0 ? "WITHDREW" : "TRANSFERRED", centerId: CS1, transferredToId: i === 1 ? MOI(i) : null,
      ...GIA, notes: `cu ${i}`,
    },
  });
  const tong = TIEN[i]!.reduce((s, x) => s + x, 0);
  await db.order.create({
    data: { id: id("o", i), code: `${P}ORD-${i}`, type: "COURSE", status: i === 0 ? "CONFIRMED" : "PENDING_PAYMENT", customerName: `PH CKH ${i}`, customerPhone: phone, subtotal: GIA.listPrice, discountAmount: GIA.listPrice - tong, totalAmount: tong, leadId: id("l", i), centerId: CS1, createdAt: new Date("2026-09-17T03:00:00Z") },
  });
  await db.orderItem.create({
    data: { id: id("it", i), orderId: id("o", i), type: "COURSE_ENROLLMENT", itemName: "Khoá CKH", quantity: 1, unitPrice: GIA.listPrice, totalPrice: GIA.listPrice, metadata: { courseId: KHOA }, enrollmentId: i === 0 ? MOI(i) : null },
  });
  for (let k = 0; k < TIEN[i]!.length; k++) {
    await db.payment.create({
      data: { id: id(`p${k}_`, i), orderId: id("o", i), ...(i === 1 ? { orderItemId: id("it", i) } : {}), amount: TIEN[i]![k]!, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, enrollmentId: CU(i) },
    });
  }
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở CKH 1", slug: `${P}cs-1`, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Sata3 CKH", slug: `${P}sata3`, totalSessions: 48, price: GIA.listPrice } });
  await db.class.create({ data: { id: LOP_CU, name: "Lớp cũ CKH", courseId: KHOA } });
  await db.class.create({ data: { id: LOP_MOI, name: "Lớp mới CKH", courseId: KHOA } });
  for (let i = 0; i < N; i++) await taoCap(i);
  await db.receipt.create({ data: { id: id("rc", 0), code: `${P}RCP-0`, enrollmentId: CU(0), paymentId: id("p0_", 0) } });
  await db.commissionStatement.create({ data: { id: id("st", 1), period: `${P}2026-10` } });
  await db.commissionLine.create({ data: { id: id("cl", 1), statementId: id("st", 1), recipientId: `${P}nguoi`, tier: "TRIAL_TEACHER", amount: 105_600, leadId: id("l", 1), enrollmentId: CU(1) } });
}

const nonce = () => {
  const n = `8c42${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(n);
  return n;
};
const congChuyen = (rows: readonly string[], o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => dungCongGhiThu(WORKFLOW_WAVE1.chuyenKhoanGhiDanh, [...rows], { now: MOC, ...o, nonce: nonce() }).cong;
const congHT = (kh: KeHoachHoanTac, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => dungCongGhiThu(WORKFLOW_WAVE1.chuyenKhoanGhiDanhHoanTac, [...kh.dongDauRa], { now: MOC, ...o, nonce: nonce() }).cong;
const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };

/** Chuyển các cặp (qua CHÍNH lệnh chuyển, để nhật ký sinh ra đúng như thật). */
async function chuyen(cap: readonly CapYeuCau[] = CAP_CHUYEN) {
  const kh = await docKeHoachChuyenKhoan(db, cap);
  expect(kh.dung, JSON.stringify(kh.loiLo)).toBe(false);
  return ghiChuyenKhoan(db, { cap, soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_CHUYEN_KHOAN, luotChay: luot(), congGhi: congChuyen(kh.dongDauRa) });
}
const khHT = (cap: readonly CapHoanTac[] = CAP_HT) => docKeHoachHoanTac(db, cap);
const nhapHT = (kh: KeHoachHoanTac, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiHoanTac> = {}): DauVaoGhiHoanTac => ({
  cap: CAP_HT, soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_HOAN_TAC, luotChay: luot(), congGhi, ...o,
});
const gia = (eid: string) => db.enrollment.findUniqueOrThrow({ where: { id: eid }, select: { listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true } });
const khoanCua = (eid: string) => db.payment.count({ where: { enrollmentId: eid, deletedAt: null } });
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: "luot:98400" } }] } });
const thuLoi = (p: Promise<unknown>) => p.then(() => null, (x: unknown) => x);
const trangThaiChuyen = async (chi: readonly number[] = [0, 1]) => {
  for (const i of chi) {
    expect(await gia(MOI(i)), `moi ${i} giá gói`).toEqual(GOI[i]);
    expect(await gia(CU(i)), `cu ${i} NULL`).toEqual(TRONG);
    expect(await khoanCua(MOI(i)), `khoản moi ${i}`).toBe(TIEN[i]!.length);
    expect(await khoanCua(CU(i)), `khoản cu ${i}`).toBe(0);
  }
};
const trangThaiGoc = async (chi: readonly number[] = [0, 1]) => {
  for (const i of chi) {
    expect(await gia(MOI(i)), `moi ${i} NULL`).toEqual(TRONG);
    expect(await gia(CU(i)), `cu ${i} giá cũ`).toEqual(GIA);
    expect(await khoanCua(MOI(i)), `khoản moi ${i}`).toBe(0);
    expect(await khoanCua(CU(i)), `khoản cu ${i}`).toBe(TIEN[i]!.length);
  }
};
const bo = (o: Record<string, unknown>, ...k: string[]) => Object.fromEntries(Object.entries(o).filter(([key]) => !k.includes(key)));

describe.skipIf(!RUN_DB_TESTS)("[CKH-DB] hoàn tác sau COMMIT của P7-B v2 — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[CKH-DB-00] ĐỐI CHỨNG DƯƠNG: chuyển rồi hoàn tác cặp #0 ⇒ cặp #0 về ĐÚNG như trước khi chuyển (giá cũ, khoản ở ghi danh cũ), cặp #1 vẫn ở trạng thái đã chuyển; phần khác y nguyên; audit + claim đủ", async () => {
    const payTruoc = await db.payment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const enrTruoc = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const orderTruoc = await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
    const rcTruoc = await db.receipt.findMany({ where: { id: { startsWith: P } } });
    const hhTruoc = await db.commissionLine.findMany({ where: { id: { startsWith: P } } });
    await chuyen();
    await trangThaiChuyen();
    const cap0 = [capHT(0)];
    const kh = await khHT(cap0);
    expect(kh.dung, JSON.stringify(kh.loiLo)).toBe(false);
    expect(kh.ghi.map((g) => g.cuId)).toEqual([CU(0)]);
    expect(kh.ghi[0]).toMatchObject({ giaMoiHienTai: GOI[0], giaCuKhoiPhuc: GIA, tongTien: 8_976_000 });
    const r = await ghiHoanTac(db, nhapHT(kh, congHT(kh), { cap: cap0 }));
    expect(r).toMatchObject({ soCap: 1, soKhoan: 1, keHoachSha: kh.sha });
    await trangThaiGoc([0]);
    await trangThaiChuyen([1]);
    // cặp #0: mọi cột (trừ updatedAt) y như trước khi chuyển
    const enrNay = await db.enrollment.findMany({ where: { id: { in: [CU(0), MOI(0)] } }, orderBy: { id: "asc" } });
    expect(enrNay.map((e) => bo(e, "updatedAt"))).toEqual(enrTruoc.filter((e) => [CU(0), MOI(0)].includes(e.id)).map((e) => bo(e, "updatedAt")));
    const payNay = await db.payment.findMany({ where: { orderId: id("o", 0) }, orderBy: { id: "asc" } });
    expect(payNay.map((p) => bo(p, "updatedAt"))).toEqual(payTruoc.filter((p) => p.orderId === id("o", 0)).map((p) => bo(p, "updatedAt")));
    expect(await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } })).toEqual(orderTruoc);
    expect(await db.receipt.findMany({ where: { id: { startsWith: P } } })).toEqual(rcTruoc);
    expect(await db.commissionLine.findMany({ where: { id: { startsWith: P } } })).toEqual(hhTruoc);
    expect(await soAudit("HOAN_TAC_CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC")).toBe(1);
    expect(await soAudit("HOAN_TAC_CHUYEN_GIA_SANG_GHI_DANH_DANG_HOC")).toBe(2);
    expect(await soAudit("HOAN_TAC_CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(2); // một claim cho lượt chuyển + một claim cho lượt hoàn tác
  });

  it("[CKH-DB-01] CHUYỂN → HOÀN TÁC → CHUYỂN LẠI → HOÀN TÁC LẠI: mỗi vòng đúng trạng thái, không nhân đôi khoản/giá, hoàn tác cặp ĐÃ chuyển lại không bị coi là «đã hoàn tác»", async () => {
    await chuyen();
    const kh1 = await khHT();
    await ghiHoanTac(db, nhapHT(kh1, congHT(kh1)));
    await trangThaiGoc();
    await chuyen();
    await trangThaiChuyen();
    const kh2 = await khHT();
    expect(kh2.dung, JSON.stringify(kh2.loiLo)).toBe(false);
    expect(kh2.ghi.length).toBe(2);
    await ghiHoanTac(db, nhapHT(kh2, congHT(kh2)));
    await trangThaiGoc();
    expect(await soAudit("CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC_LUOT_CHAY")).toBe(2);
    expect(await soAudit("HOAN_TAC_CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC_LUOT_CHAY")).toBe(2);
  });

  it("[CKH-DB-02] KHÔNG HOÀN TÁC HAI LẦN: sau khi hoàn tác, kế hoạch hoàn tác lại ra DA_HOAN_TAC (dừng), không ghi gì, không claim thêm", async () => {
    await chuyen();
    const kh = await khHT();
    await ghiHoanTac(db, nhapHT(kh, congHT(kh)));
    const claim = await soClaim();
    const lai = await khHT();
    expect(lai.dung).toBe(true);
    expect(lai.loiLo.map((l) => l.ma)).toEqual(["DA_HOAN_TAC", "DA_HOAN_TAC"]);
    const e = await thuLoi(ghiHoanTac(db, nhapHT(lai, congRong, { soDuyet: 0 })));
    expect(String(e)).toMatch(/DỪNG/);
    expect(await soClaim()).toBe(claim);
    await trangThaiGoc();
  });

  it.each([
    ["sửa giá ghi danh mới sau lượt chuyển", async () => { await db.enrollment.update({ where: { id: MOI(1) }, data: { finalPrice: 5_016_001 } }); }, "GIA_DA_BI_SUA"],
    ["đặt giá lại cho ghi danh cũ", async () => { await db.enrollment.update({ where: { id: CU(1) }, data: { finalPrice: 1 } }); }, "GIA_DA_BI_SUA"],
    ["gắn thêm một khoản vào ghi danh mới", async () => { await db.payment.create({ data: { id: id("px", 1), orderId: id("o", 1), amount: 1_000, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, enrollmentId: MOI(1) } }); }, "TAP_KHOAN_DA_DOI"],
    ["một khoản đã chuyển bị đổi sang chờ xác nhận", async () => { await db.payment.update({ where: { id: id("p0_", 1) }, data: { accountantStatus: "PENDING" } }); }, "KHOAN_DA_DOI_TRANG_THAI"],
    ["khoản bị xoá mềm khỏi ghi danh mới", async () => { await db.payment.update({ where: { id: id("p1_", 1) }, data: { deletedAt: new Date("2026-10-27T00:00:00Z") } }); }, "TAP_KHOAN_DA_DOI"],
    ["ghi danh cũ lại có một khoản", async () => { await db.payment.create({ data: { id: id("py", 1), orderId: id("o", 1), amount: 1_000, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, enrollmentId: CU(1) } }); }, "TAP_KHOAN_DA_DOI"],
    ["biên lai phát hành cho ghi danh mới", async () => { await db.receipt.create({ data: { id: id("rc", 9), code: `${P}RCP-9`, enrollmentId: MOI(1), paymentId: id("p0_", 1) } }); }, "GHI_DANH_MOI_DA_CO_CHUNG_TU"],
    ["ghi danh mới đã bị rút", async () => { await db.enrollment.update({ where: { id: MOI(1) }, data: { status: "WITHDREW" } }); }, "TRANG_THAI_GHI_DANH_DOI"],
    ["ghi danh cũ được mở lại", async () => { await db.enrollment.update({ where: { id: CU(1) }, data: { status: "ACTIVE" } }); }, "TRANG_THAI_GHI_DANH_DOI"],
  ] as [string, () => Promise<void>, string][])("[CKH-DB-03] TRẠNG THÁI HIỆN TẠI ĐÃ ĐỔI ⇒ DỪNG CẢ LÔ, KHÔNG sửa nửa vời, 0 claim hoàn tác: %s", async (_t, lamDoi, ma) => {
    await chuyen();
    const claimTruoc = await soClaim();
    await lamDoi();
    const anh = async () => JSON.stringify(await Promise.all([gia(CU(0)), gia(MOI(0)), gia(CU(1)), gia(MOI(1)), khoanCua(CU(0)), khoanCua(MOI(0)), khoanCua(CU(1)), khoanCua(MOI(1))]));
    const truoc = await anh();
    const kh = await khHT();
    expect(kh.dung).toBe(true);
    expect(kh.loiLo.filter((l) => l.cuId === CU(1)).map((l) => l.ma)).toContain(ma);
    expect(kh.ghi, "cặp #0 còn tốt nhưng cặp #1 lệch ⇒ không hoàn tác cặp nào").toEqual([]);
    const e = await thuLoi(ghiHoanTac(db, nhapHT(kh, congRong, { soDuyet: 0 })));
    expect(String(e)).toMatch(/DỪNG/);
    expect(await anh(), "không đổi gì").toBe(truoc);
    expect(await soClaim()).toBe(claimTruoc);
  });

  it("[CKH-DB-04] CỔNG KÝ RIÊNG: artifact ký cho lệnh CHUYỂN không hoàn tác được; thiếu artifact / dòng khác / môi trường khác / khoá không ghim ⇒ từ chối TRƯỚC phép ghi đầu tiên, không đổi gì", async () => {
    await chuyen();
    const kh = await khHT();
    const cong0 = congHT(kh);
    const CASES: Array<[string, DauVaoCongGhi, string]> = [
      ["thiếu artifact", { ...cong0, artifact: null }, "THIEU_ARTIFACT"],
      ["workflow CHUYỂN (chữ ký cho việc chuyển)", congHT(kh, { workflowKy: WORKFLOW_WAVE1.chuyenKhoanGhiDanh }), "SAI_WORKFLOW"],
      ["workflow PHASE X (xử lý đơn backfill sai)", congHT(kh, { workflowKy: WORKFLOW_WAVE1.xuLyDonBackfillSai }), "SAI_WORKFLOW"],
      ["dòng khác (PLAN_SHA lệch)", congHT(kh, { rowsKy: kh.dongDauRa.slice(0, 1) }), "LECH_DIGEST"],
      ["môi trường", congHT(kh, { moiTruongKy: "prod" }), "SAI_MOI_TRUONG"],
      ["chưa ghim khoá", { ...cong0, keyIdTinCay: "" }, "KHOA_KHONG_KHOP"],
    ];
    const claim = await soClaim();
    for (const [ten, cong, ma] of CASES) {
      const e = await thuLoi(ghiHoanTac(db, nhapHT(kh, cong)));
      expect(e, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((e as CongGhiTuChoi).ma, ten).toBe(ma);
      await trangThaiChuyen();
    }
    expect(await soClaim()).toBe(claim);
    expect(await soAudit("HOAN_TAC_CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC")).toBe(0);
  });

  it("[CKH-DB-04b] ĐỐI NGƯỢC: artifact ký cho HOÀN TÁC không dùng để CHUYỂN (SAI_WORKFLOW)", async () => {
    const kh = await docKeHoachChuyenKhoan(db, CAP_CHUYEN);
    const sai = dungCongGhiThu(WORKFLOW_WAVE1.chuyenKhoanGhiDanhHoanTac, [...kh.dongDauRa], { now: MOC, nonce: nonce() }).cong;
    const e = await thuLoi(ghiChuyenKhoan(db, { cap: CAP_CHUYEN, soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_CHUYEN_KHOAN, luotChay: luot(), congGhi: sai }));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((e as CongGhiTuChoi).ma).toBe("SAI_WORKFLOW");
    await trangThaiGoc();
  });

  it("[CKH-DB-05] TRANSACTION TOÀN LÔ: lỗi khi khôi phục giá ghi danh cũ của cặp #1 (trigger ném) ⇒ cặp #0 đã hoàn tác trước đó cũng LÙI; claim lùi theo", async () => {
    await chuyen();
    const claim = await soClaim();
    await db.$executeRawUnsafe(`CREATE FUNCTION ckh_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'CKH_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ckh_boom_trg BEFORE UPDATE ON "Enrollment" FOR EACH ROW WHEN (NEW.id = '${CU(1)}') EXECUTE FUNCTION ckh_boom()`);
    const kh = await khHT();
    const e = await thuLoi(ghiHoanTac(db, nhapHT(kh, congHT(kh))));
    expect(String(e)).toMatch(/CKH_BOOM/);
    await trangThaiChuyen();
    expect(await soClaim()).toBe(claim);
    expect(await soAudit("HOAN_TAC_CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC")).toBe(0);
    expect(await soAudit("HOAN_TAC_CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC_LUOT_CHAY")).toBe(0);
  });

  it("[CKH-DB-06] KHÔNG CÓ NHẬT KÝ ⇒ KHÔNG HOÀN TÁC: cặp bị dời bằng tay (không qua lệnh P7-B) — không có giá/khoản gốc đáng tin để khôi phục", async () => {
    await db.payment.updateMany({ where: { orderId: id("o", 0) }, data: { enrollmentId: MOI(0) } });
    await db.enrollment.update({ where: { id: MOI(0) }, data: GOI[0]! });
    await db.enrollment.update({ where: { id: CU(0) }, data: TRONG });
    const kh = await khHT([capHT(0)]);
    expect(kh.dung).toBe(true);
    expect(kh.loiLo.map((l) => l.ma)).toEqual(["KHONG_CO_NHAT_KY_GHI"]);
    const e = await thuLoi(ghiHoanTac(db, nhapHT(kh, congRong, { cap: [capHT(0)], soDuyet: 0 })));
    expect(String(e)).toMatch(/DỪNG/);
    expect(await khoanCua(MOI(0))).toBe(1);
  });

  it("[CKH-DB-07] HAI PHIÊN CÙNG HOÀN TÁC MỘT CẶP (hai artifact khác nonce): đúng MỘT phiên hoàn tác; không nhân đôi, không đảo hai lần", async () => {
    await chuyen();
    const cap0 = [capHT(0)];
    const kh = await khHT(cap0);
    const kq = await Promise.allSettled([
      ghiHoanTac(db, nhapHT(kh, congHT(kh), { cap: cap0 })),
      ghiHoanTac(db, nhapHT(kh, congHT(kh), { cap: cap0 })),
    ]);
    const ok = kq.filter((k) => k.status === "fulfilled" && (k.value as { soCap: number }).soCap === 1);
    expect(ok.length, JSON.stringify(kq.map((k) => (k.status === "rejected" ? String(k.reason).slice(0, 80) : k.value)))).toBe(1);
    await trangThaiGoc([0]);
    await trangThaiChuyen([1]);
    expect(await soAudit("HOAN_TAC_CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC")).toBe(1);
    expect(await soAudit("HOAN_TAC_CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC_LUOT_CHAY")).toBe(1);
  });

  it("[CKH-DB-08] BẤT BIẾN: nếu phép hoàn tác VÔ TÌNH kéo theo đổi hoa hồng cũ / biên lai ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    await chuyen();
    const claim = await soClaim();
    const LAN: Array<[string, string, "Enrollment" | "Payment"]> = [
      ["CommissionLine.amount", `UPDATE "CommissionLine" SET amount = amount + 1 WHERE id = '${id("cl", 1)}'`, "Enrollment"],
      ["Receipt.status", `UPDATE "Receipt" SET status = 'VOID' WHERE id = '${id("rc", 0)}'`, "Payment"],
    ];
    for (const [ten, thaan, bang] of LAN) {
      await db.$executeRawUnsafe(`CREATE FUNCTION ckh_boom() RETURNS trigger AS $f$ BEGIN ${thaan}; RETURN NEW; END $f$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe(`CREATE TRIGGER ckh_boom_trg AFTER UPDATE ON "${bang}" FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION ckh_boom()`);
      const kh = await khHT();
      const e = await thuLoi(ghiHoanTac(db, nhapHT(kh, congHT(kh))));
      expect(String(e), ten).toMatch(/Ảnh chụp bất biến/);
      await trangThaiChuyen();
      await db.$executeRawUnsafe(`DROP TRIGGER ckh_boom_trg ON "${bang}"`);
      await db.$executeRawUnsafe(`DROP FUNCTION ckh_boom()`);
    }
    expect(await soClaim()).toBe(claim);
    expect((await db.commissionLine.findUniqueOrThrow({ where: { id: id("cl", 1) } })).amount).toBe(105_600);
  });
});
