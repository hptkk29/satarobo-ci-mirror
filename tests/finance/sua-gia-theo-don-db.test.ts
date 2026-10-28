// tests/finance/sua-gia-theo-don-db.test.ts — [SGT-DB-*] «P7-A · chuẩn hoá giá ghi danh theo đơn (nhóm G1a), phạm vi SUY TỪ BẰNG CHỨNG» trên Postgres THẬT: đọc → kế hoạch → cổng Wave 1 → ghi → kiểm sau ghi.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/sua-gia-theo-don-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `SGT_`; KHÔNG `resetDb()`. Lệnh KHÔNG nhận mã đơn: nó quét MỌI đơn khoá học còn sống của DB, nên bộ này chỉ đứng vững trên DB test sạch (các bộ
// `finance-db` khác dọn fixture của chúng ở `afterAll`) — mọi khẳng định về phạm vi lọc theo tiền tố `SGT_`.
// Fixture «hình dạng thật» (đo PROD 26/10/2026), 4 đơn đóng ĐỦ giá giảm, ghi danh còn giá niêm yết, khoản thu đã gắn ghi danh:
//   #0 dòng đơn ĐÃ trỏ ghi danh, nguồn ITEM 15% · #1 dòng đơn CHƯA trỏ ghi danh (đơn lập tay trước #980: Order.studentId + OrderItem.studentId, enrollmentId NULL) · #2 dòng đã trỏ, nguồn ORDER 25% ·
//   #3 ghi danh STUDYING mang CẢ NĂM cột giá NULL (Course.price = giá, Course.updatedAt TRƯỚC đơn). #0 có một dòng hoa hồng cũ (phải đứng yên).
//
// Ánh xạ yêu cầu P7-A → ca:
//   phạm vi suy từ bằng chứng, đơn lệch bị LOẠI không bị sửa ⇒ [00] [04]   |   gắn dòng đơn một cột, đúng bốn cột giá ⇒ [01] [13]   |   không đụng Order/Payment/bank/Receipt/hoa hồng ⇒ [01] [08]   |   idempotent ⇒ [02]
//   cổng ký (workflow RIÊNG, không dùng chéo artifact Wave C-B) ⇒ [03] [09]   |   rollback toàn lô ⇒ [05]   |   trôi giữa kế hoạch và ghi ⇒ [06]   |   không lấn Wave C-B ⇒ [14]   |   kiểm sau ghi ⇒ [10]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  ACTOR_SUA_GIA_THEO_DON,
  anhChupBatBienSuaGiaTheoDon,
  docKeHoachSuaGiaTheoDon,
  ghiSuaGiaTheoDon,
  ghiSuaGiaTheoDonTrongTx,
  kiemSauGhiSuaGiaTheoDon,
  type DauVaoGhiSuaGiaTheoDon,
} from "@/lib/nguon/sua-gia-theo-don-db";
import { MA_DON_WAVE_C_B, giaDichWaveCB } from "@/lib/nguon/wave-c-sua-gia-ghi-danh";
import type { KeHoachSuaGiaTheoDon } from "@/lib/nguon/sua-gia-theo-don";

if (!RUN_DB_TESTS) console.warn(`[SGT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "SGT_";
const CS1 = `${P}cs1`;
const KHOA3 = `${P}khoa3`;
const KHOA4 = `${P}khoa4`;
const LOP3 = `${P}lop3`;
const LOP4 = `${P}lop4`;
const N = 4;
const CHUA_TRO = 1;
const NHOM_25 = 2;
const DAC_BIET = 3;
const MA = Array.from({ length: N }, (_, i) => `${P}ORD-${i}`);
const id = (k: string, i: number) => `${P}${k}${i}`;
const NIEM_YET = [10_560_000, 10_560_000, 11_520_000, 10_560_000];
const PT = [15, 15, 25, 15];
const DICH = NIEM_YET.map((l, i) => giaDichWaveCB(l, PT[i]!));
const LEGACY = (l: number) => ({ listPrice: l, discountType: null, discountAmount: 0, tuition: l, finalPrice: l });
const TRONG = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
const MOC = new Date("2026-10-26T03:00:00.000Z");
const NGAY_THU = new Date("2026-09-20T03:00:00.000Z");
const NGAY_DON = new Date("2026-10-10T03:00:00.000Z");
const NGAY_GIA = new Date("2026-08-04T03:00:00.000Z");
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9820001", runAttempt: "1" } } as const;
const nonceDaDung: string[] = [];
const DB_LOT = "luot:9820001";

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: DB_LOT } }] } });
  for (const t of ["boom", "leak", "leaki"]) {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sgt_${t}_trg ON "Enrollment"`);
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sgt_${t}_trg ON "OrderItem"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sgt_${t}()`);
  }
  await db.commissionLine.deleteMany({ where: { id: { startsWith: P } } });
  await db.commissionStatement.deleteMany({ where: { id: { startsWith: P } } });
  await db.paymentAllocation.deleteMany({ where: { OR: [{ paymentRequest: { orderId: { startsWith: P } } }, { bankTransactionId: { startsWith: P } }] } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: P } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.payment.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.order.deleteMany({ where: { id: { startsWith: P } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: P } } });
  await db.student.deleteMany({ where: { id: { startsWith: P } } });
  await db.leadChild.deleteMany({ where: { id: { startsWith: P } } });
  await db.lead.deleteMany({ where: { id: { startsWith: P } } });
  await db.class.deleteMany({ where: { id: { in: [LOP3, LOP4] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA3, KHOA4] } } });
  await db.center.deleteMany({ where: { id: CS1 } });
}

/** Một đơn fixture số `i`. `ma` mặc định `SGT_ORD-i`; `dongTro=false`: dòng đơn chưa trỏ ghi danh (khoản thu vẫn gắn). */
async function taoDon(i: number, o: { ma?: string; dongTro?: boolean } = {}) {
  const phone = `098700000${i}`;
  const nhom25 = i === NHOM_25;
  const khoa = nhom25 ? KHOA4 : KHOA3;
  const dich = i < N ? DICH[i]! : DICH[0]!;
  const niemYet = i < N ? NIEM_YET[i]! : NIEM_YET[0]!;
  const pt = i < N ? PT[i]! : PT[0]!;
  const final = dich.finalPrice!;
  const gia = i === DAC_BIET ? TRONG : LEGACY(niemYet);
  const ordKieu = i === 0 || nhom25;
  const tro = o.dongTro ?? i !== CHUA_TRO;
  await db.lead.create({ data: { id: id("l", i), parentName: `PH SGT ${i}`, phone, status: "DA_DANG_KY", centerId: CS1 } });
  await db.leadChild.create({ data: { id: id("be", i), leadId: id("l", i), fullName: `Bé SGT ${i}` } });
  await db.student.create({ data: { id: id("s", i), name: `Bé SGT ${i}`, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, parentPhone: phone } });
  await db.enrollment.create({
    data: {
      id: id("e", i), studentId: id("s", i), classId: nhom25 ? LOP4 : LOP3, courseId: khoa, status: i === DAC_BIET ? "STUDYING" : "ACTIVE", leadChildId: id("be", i), centerId: CS1,
      listPrice: gia.listPrice, discountType: gia.discountType, discountAmount: gia.discountAmount, tuition: gia.tuition, finalPrice: gia.finalPrice, notes: `ghi chú ${i}`,
    },
  });
  await db.order.create({
    data: {
      id: id("o", i), code: o.ma ?? `${P}ORD-${i}`, type: "COURSE", status: "COMPLETED", customerName: `PH SGT ${i}`, customerPhone: phone, subtotal: niemYet, discountAmount: dich.discountAmount!,
      discountPercent: ordKieu ? pt : null, discountApprovalStatus: ordKieu ? "APPROVED" : null, totalAmount: final, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1,
      studentId: id("s", i), createdAt: NGAY_DON,
    },
  });
  await db.orderItem.create({
    data: {
      id: id("it", i), orderId: id("o", i), type: "COURSE_ENROLLMENT", itemName: "Khoá SGT", quantity: 1, unitPrice: niemYet, totalPrice: niemYet, metadata: { courseId: khoa, leadChildId: id("be", i) },
      studentId: id("s", i), enrollmentId: tro ? id("e", i) : null,
      ...(ordKieu ? {} : { discountAmount: dich.discountAmount!, discountPercent: pt, discounts: [{ kieu: "PHAN_TRAM", phanTram: pt, giam: dich.discountAmount!, vuotTran: false, lyDo: "CS đóng full" }] }),
    },
  });
  await db.paymentRequest.create({ data: { id: id("pr", i), orderId: id("o", i), centerId: CS1, installmentNo: 0, amountDue: final } });
  await db.payment.create({
    data: { id: id("p", i), orderId: id("o", i), orderItemId: id("it", i), amount: final, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, enrollmentId: id("e", i) },
  });
  await db.bankTransaction.create({ data: { id: id("bt", i), provider: "SEPAY", providerTxnId: `${P}txn${i}`, amount: final, transferredAt: NGAY_THU, status: "MATCHED", centerId: CS1 } });
  await db.paymentAllocation.create({ data: { bankTransactionId: id("bt", i), paymentRequestId: id("pr", i), amount: final } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở SGT 1", slug: `${P}cs-1`, address: "x" } });
  await db.course.create({ data: { id: KHOA3, name: "Sata3 SGT", slug: `${P}sata3`, totalSessions: 48, price: 10_560_000, updatedAt: NGAY_GIA } });
  await db.course.create({ data: { id: KHOA4, name: "Sata4 SGT", slug: `${P}sata4`, totalSessions: 48, price: 11_520_000, updatedAt: NGAY_GIA } });
  await db.class.create({ data: { id: LOP3, name: "Lớp 3 SGT", courseId: KHOA3 } });
  await db.class.create({ data: { id: LOP4, name: "Lớp 4 SGT", courseId: KHOA4 } });
  for (let i = 0; i < N; i++) await taoDon(i);
  // Một dòng hoa hồng cũ của lead #0 — PHẢI đứng yên.
  await db.commissionStatement.create({ data: { id: id("st", 0), period: `${P}2026-10` } });
  await db.commissionLine.create({ data: { id: id("cl", 0), statementId: id("st", 0), recipientId: `${P}nguoi`, tier: "SALE", amount: 123_456, leadId: id("l", 0) } });
}

let demNonce = 0;
const CG = (kh: KeHoachSuaGiaTheoDon, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => {
  const nonce = o.nonce ?? `9d71${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(nonce);
  return dungCongGhiThu(WORKFLOW_WAVE1.suaGiaTheoDon, [...kh.dongDauRa], { now: MOC, ...o, nonce }).cong;
};
const nhap = (kh: KeHoachSuaGiaTheoDon, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiSuaGiaTheoDon> = {}): DauVaoGhiSuaGiaTheoDon => ({
  soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_SUA_GIA_THEO_DON, luotChay: LUOT, congGhi, ...o,
});
const kehoach = () => docKeHoachSuaGiaTheoDon(db);
const giaHienTai = async (i: number) =>
  db.enrollment.findUniqueOrThrow({ where: { id: id("e", i) }, select: { listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true } });
const khongGhiGi = async () => {
  for (let i = 0; i < N; i++) expect(await giaHienTai(i), `ghi danh ${i}`).toEqual(i === DAC_BIET ? TRONG : LEGACY(NIEM_YET[i]!));
  expect((await db.orderItem.findUniqueOrThrow({ where: { id: id("it", CHUA_TRO) } })).enrollmentId, "dòng đơn #1 phải còn chưa trỏ").toBeNull();
};
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: DB_LOT } }] } });
const thuLoi = (p: Promise<unknown>) => p.then(() => null, (x: unknown) => x);
const cuaFixture = (kh: KeHoachSuaGiaTheoDon) => kh.ghi.filter((g) => g.code.startsWith(P));

describe.skipIf(!RUN_DB_TESTS)("[SGT-DB] chuẩn hoá giá ghi danh theo đơn, phạm vi suy từ bằng chứng — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[SGT-DB-00] ĐỐI CHỨNG DƯƠNG fixture: phạm vi suy ra ĐÚNG 4 đơn không cần bảng mã; không lỗi; chỉ đơn #1 cần gắn dòng; nợ dự kiến sau = 0", async () => {
    await khongGhiGi();
    const kh = await kehoach();
    expect(kh.keHoach.loi).toEqual([]);
    expect(cuaFixture(kh).map((g) => g.code).sort()).toEqual([...MA].sort());
    expect(Object.keys(kh.ketQuaBang.gan).filter((c) => c.startsWith(P))).toEqual([MA[CHUA_TRO]]);
    expect(kh.ghi.find((g) => g.code === MA[DAC_BIET])?.ghiListPrice).toBe(true);
    expect(kh.keHoach.muc.filter((m) => m.code.startsWith(P)).every((m) => m.noDuKien === 0)).toBe(true);
    const muc = (c: string) => kh.keHoach.muc.find((m) => m.code === c)!;
    // Nợ hiển thị TRƯỚC: ghi danh còn giá niêm yết ⇒ nợ ảo = phần giảm; ghi danh cả-NULL ⇒ finalPrice NULL nên hàm công nợ coi giá 0 (màn công nợ mặc định ẩn hàng này). SAU: 0 hết.
    for (let i = 0; i < N; i++) {
      expect(muc(MA[i]!).noSauSua, `nợ sau #${i}`).toBe(0);
      expect(muc(MA[i]!).noHienTai, `nợ trước #${i}`).toBe(i === DAC_BIET ? 0 : DICH[i]!.discountAmount);
    }
  });

  it("[SGT-DB-01] GHI: ĐÚNG 4 cột giá (5 cột cho ngoại lệ listPrice) + MỘT cột dòng đơn #1; Order, Payment, bank, Receipt, hoa hồng cũ y nguyên; audit từng ghi danh + dòng gắn + lượt + claim", async () => {
    const orderTruoc = await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
    const payTruoc = await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } });
    const btTruoc = await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const hhTruoc = await db.commissionLine.findMany({ where: { id: { startsWith: P } } });
    const enrTruoc = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const kh = await kehoach();
    const r = await ghiSuaGiaTheoDon(db, nhap(kh, CG(kh)));
    expect(r).toMatchObject({ daGhi: kh.ghi.length, daGan: 1, daSuaHet: true, keHoachSha: kh.sha });

    for (let i = 0; i < N; i++) expect(await giaHienTai(i), `ghi danh ${i}`).toEqual(DICH[i]);
    const enrNay = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const bo = (r2: Record<string, unknown>) => Object.fromEntries(Object.entries(r2).filter(([k]) => !["discountType", "discountAmount", "finalPrice", "tuition", "updatedAt", "listPrice"].includes(k)));
    expect(enrNay.map(bo)).toEqual(enrTruoc.map(bo));
    expect(enrNay.map((e) => e.listPrice)).toEqual(enrTruoc.map((e, i) => (i === DAC_BIET ? NIEM_YET[i] : e.listPrice)));

    // Dòng đơn: CHỈ `enrollmentId` của #1 đổi (NULL → ghi danh); mọi cột khác của mọi dòng y nguyên.
    const orderNay = await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
    const boItem = (it: Record<string, unknown>) => Object.fromEntries(Object.entries(it).filter(([k]) => !["enrollmentId", "updatedAt"].includes(k)));
    expect(orderNay.map((o) => ({ ...o, items: o.items.map(boItem) }))).toEqual(orderTruoc.map((o) => ({ ...o, items: o.items.map(boItem) })));
    expect(orderNay.flatMap((o) => o.items).map((it) => it.enrollmentId)).toEqual(MA.map((_, i) => id("e", i)));
    expect(orderTruoc.flatMap((o) => o.items).map((it) => it.enrollmentId)).toEqual(MA.map((_, i) => (i === CHUA_TRO ? null : id("e", i))));

    expect(await db.payment.findMany({ where: { orderId: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(payTruoc);
    expect(await db.bankTransaction.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } })).toEqual(btTruoc);
    expect(await db.commissionLine.findMany({ where: { id: { startsWith: P } } })).toEqual(hhTruoc);
    expect(await db.commissionTransaction.count({ where: { orderId: { startsWith: P } } })).toBe(0);
    expect(await db.receipt.count({ where: { paymentId: { startsWith: P } } })).toBe(0);

    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_THEO_DON")).toBe(N);
    expect(await soAudit("GAN_DONG_DON_GHI_DANH_THEO_DON")).toBe(1);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_THEO_DON_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "CHUAN_HOA_GIA_GHI_DANH_THEO_DON", entityId: id("e", DAC_BIET) } });
    expect(a.oldValues).toEqual(TRONG);
    expect(a.changedFields).toEqual(["listPrice", "discountType", "discountAmount", "finalPrice", "tuition"]);
    const g = await db.auditLog.findFirstOrThrow({ where: { action: "GAN_DONG_DON_GHI_DANH_THEO_DON" } });
    expect(g).toMatchObject({ entityType: "OrderItem", entityId: id("it", CHUA_TRO), changedFields: ["enrollmentId"] });
    expect(g.oldValues).toEqual({ enrollmentId: null });
    const luot = await db.auditLog.findFirstOrThrow({ where: { action: "CHUAN_HOA_GIA_GHI_DANH_THEO_DON_LUOT_CHAY" } });
    expect(luot.newValues).toMatchObject({ expectedCount: kh.ghi.length, actualCount: kh.ghi.length, khop: true, keHoachSha: kh.sha, soGanDong: 1, soGhiListPrice: 1 });
  });

  it("[SGT-DB-02] IDEMPOTENT: chạy lại sau khi ghi ⇒ 0 dòng ghi, KHÔNG qua cổng, KHÔNG claim, KHÔNG audit thêm — kể cả khi không có artifact", async () => {
    const kh = await kehoach();
    await ghiSuaGiaTheoDon(db, nhap(kh, CG(kh)));
    const truocAudit = await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: DB_LOT } }] } });
    const claim = await soClaim();
    const ky2 = await kehoach();
    expect(cuaFixture(ky2)).toEqual([]);
    expect(ky2.ketQuaBang.daDung.filter((c) => c.startsWith(P)).sort()).toEqual([...MA].sort());
    const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };
    const r = await ghiSuaGiaTheoDon(db, nhap(ky2, congRong, { soDuyet: 0 }));
    expect(r).toMatchObject({ daGhi: 0, daGan: 0 });
    expect(await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: DB_LOT } }] } })).toBe(truocAudit);
    expect(await soClaim()).toBe(claim);
  });

  it("[SGT-DB-03] CỔNG KÝ: thiếu artifact / ký cho workflow KHÁC (Wave C-B · C-A · C-C · PHASE B.1) / dòng khác / sai môi trường / khoá không ghim ⇒ từ chối TRƯỚC phép ghi đầu tiên, không đổi gì, 0 claim", async () => {
    const kh = await kehoach();
    const cong0 = CG(kh);
    const CASES: Array<[string, DauVaoCongGhi, string]> = [
      ["thiếu artifact", { ...cong0, artifact: null }, "THIEU_ARTIFACT"],
      ["workflow Wave C-B", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCSuaGia }), "SAI_WORKFLOW"],
      ["workflow C-A", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCGanDanhTinh }), "SAI_WORKFLOW"],
      ["workflow C-C", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCGanPayment }), "SAI_WORKFLOW"],
      ["workflow B.1", CG(kh, { workflowKy: WORKFLOW_WAVE1.suaGiaGhiDanh }), "SAI_WORKFLOW"],
      ["dòng khác (plan SHA lệch)", CG(kh, { rowsKy: kh.dongDauRa.slice(0, kh.ghi.length - 1) }), "LECH_DIGEST"],
      ["môi trường", CG(kh, { moiTruongKy: "prod" }), "SAI_MOI_TRUONG"],
      ["chưa ghim khoá", { ...cong0, keyIdTinCay: "" }, "KHOA_KHONG_KHOP"],
    ];
    for (const [ten, cong, ma] of CASES) {
      const e = await thuLoi(ghiSuaGiaTheoDon(db, nhap(kh, cong)));
      expect(e, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((e as CongGhiTuChoi).ma, ten).toBe(ma);
      await khongGhiGi();
    }
    expect(await soClaim()).toBe(0);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_THEO_DON")).toBe(0);
    expect(await soAudit("GAN_DONG_DON_GHI_DANH_THEO_DON")).toBe(0);
  });

  it.each([
    ["học bổng: ghi danh mang SCHOLARSHIP", 0, async () => { await db.enrollment.update({ where: { id: id("e", 0) }, data: { discountType: "SCHOLARSHIP", discountAmount: NIEM_YET[0]!, tuition: 0, finalPrice: 0 } }); }, "GIA_KHONG_PHAI_LEGACY"],
    ["giá ghi danh bị chỉnh tay (finalPrice −1)", 1, async () => { await db.enrollment.update({ where: { id: id("e", 1) }, data: { finalPrice: NIEM_YET[1]! - 1 } }); }, "GIA_KHONG_PHAI_LEGACY"],
    ["listPrice ghi danh KHÁC niêm yết của đơn (mua theo số buổi / khoá đổi giá)", 1, async () => { await db.enrollment.update({ where: { id: id("e", 1) }, data: { listPrice: NIEM_YET[1]! + 1 } }); }, "GIA_KHONG_PHAI_LEGACY"],
    ["chưa đóng ĐỦ (Payment thiếu 1đ) — nhóm G1b", 0, async () => { await db.payment.update({ where: { id: id("p", 0) }, data: { amount: DICH[0]!.finalPrice! - 1 } }); }, "TIEN_PAYMENT_LECH"],
    ["Payment chưa CONFIRMED", 1, async () => { await db.payment.update({ where: { id: id("p", 1) }, data: { accountantStatus: "PENDING" } }); }, "PAYMENT_KHONG_HOP_LE"],
    ["thêm một Payment bị TỪ CHỐI còn sống trên đơn", 0, async () => { await db.payment.create({ data: { id: id("px", 0), orderId: id("o", 0), amount: 100, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "REJECTED", centerId: CS1 } }); }, "PAYMENT_KHONG_HOP_LE"],
    ["khoản gắn ghi danh của HỌC VIÊN KHÁC", 0, async () => { await db.payment.update({ where: { id: id("p", 0) }, data: { enrollmentId: id("e", 1) } }); }, "PAYMENT_GAN_SAI_GHI_DANH"],
    ["phân bổ ngân hàng bị gỡ (tiền mặt / nhập lịch sử)", 1, async () => { await db.paymentAllocation.deleteMany({ where: { bankTransactionId: id("bt", 1) } }); }, "TIEN_PHAN_BO_LECH"],
    ["giao dịch ngân hàng không còn MATCHED", 0, async () => { await db.bankTransaction.update({ where: { id: id("bt", 0) }, data: { status: "UNMATCHED" } }); }, "TIEN_PHAN_BO_LECH"],
    ["mức giảm 14% (số liệu tự mâu thuẫn)", 0, async () => { await db.order.update({ where: { id: id("o", 0) }, data: { discountPercent: 14 } }); }, "PHAN_TRAM_NGOAI_CHINH_SACH"],
    ["giảm giá nguồn ORDER chưa APPROVED", NHOM_25, async () => { await db.order.update({ where: { id: id("o", NHOM_25) }, data: { discountApprovalStatus: "PENDING_APPROVAL" } }); }, "KHONG_CO_BANG_CHUNG_GIAM"],
    ["bản ghi OrderItem.discounts mức 10% (giảm có điều kiện)", 1, async () => { await db.orderItem.update({ where: { id: id("it", 1) }, data: { discounts: [{ kieu: "PHAN_TRAM", phanTram: 10, giam: DICH[1]!.discountAmount, vuotTran: false }] } }); }, "PHAN_TRAM_NGOAI_CHINH_SACH"],
    ["tổng đơn trôi 1đ", 0, async () => { await db.order.update({ where: { id: id("o", 0) }, data: { totalAmount: DICH[0]!.finalPrice! + 1 } }); }, "TONG_DON_LECH"],
    ["NGOẠI LỆ: Course.price đổi", DAC_BIET, async () => { await db.course.update({ where: { id: KHOA3 }, data: { price: 10_560_001, updatedAt: NGAY_GIA } }); }, "NGUON_NIEM_YET_KHONG_DU"],
    ["NGOẠI LỆ: Course.updatedAt SAU khi tạo đơn", DAC_BIET, async () => { await db.course.update({ where: { id: KHOA3 }, data: { updatedAt: new Date("2026-10-11T00:00:00Z") } }); }, "NGUON_NIEM_YET_KHONG_DU"],
    ["ghi danh đã đóng (WITHDREW) khi dòng đơn đã trỏ", 0, async () => { await db.enrollment.update({ where: { id: id("e", 0) }, data: { status: "WITHDREW" } }); }, "GHI_DANH_KHONG_HIEU_LUC"],
    ["đơn #1 (chưa trỏ): học viên có HAI ghi danh còn hiệu lực cùng khoá + cơ sở", CHUA_TRO, async () => { await db.enrollment.create({ data: { id: id("e", 91), studentId: id("s", CHUA_TRO), classId: LOP4, courseId: KHOA3, status: "ACTIVE", centerId: CS1 } }); }, "KHONG_SUY_RA_GHI_DANH"],
    ["đơn #1 (chưa trỏ): ghi danh đã bị dòng đơn KHÁC trỏ tới (đơn #0 cũng bị loại vì dòng trỏ sai học viên)", CHUA_TRO, async () => { await db.orderItem.update({ where: { id: id("it", 0) }, data: { enrollmentId: id("e", CHUA_TRO) } }); }, "KHONG_SUY_RA_GHI_DANH", [0]],
    ["đơn #1 (chưa trỏ): khoản thu không gắn ghi danh nào", CHUA_TRO, async () => { await db.payment.update({ where: { id: id("p", CHUA_TRO) }, data: { enrollmentId: null } }); }, "KHONG_SUY_RA_GHI_DANH"],
    ["đơn #1 (chưa trỏ): khoản thu gắn ghi danh của học viên KHÁC", CHUA_TRO, async () => { await db.payment.update({ where: { id: id("p", CHUA_TRO) }, data: { enrollmentId: id("e", 0) } }); }, "KHONG_SUY_RA_GHI_DANH"],
    ["đơn #1 (chưa trỏ): OrderItem.studentId khác Order.studentId", CHUA_TRO, async () => { await db.orderItem.update({ where: { id: id("it", CHUA_TRO) }, data: { studentId: id("s", 0) } }); }, "KHONG_SUY_RA_GHI_DANH"],
  ] as [string, number, () => Promise<void>, string, number[]?][])(
    "[SGT-DB-04] ĐƠN LỆCH BỊ LOẠI (không bị sửa): %s",
    async (_ten, lech, lamHong, ma, khac) => {
      await lamHong();
      const kh = await kehoach();
      const loai = kh.ketQuaBang.loai.filter((l) => l.code === MA[lech]);
      expect(loai.map((l) => l.ma), "đơn lệch phải có lý do bị loại").toContain(ma);
      expect(cuaFixture(kh).map((g) => g.code)).not.toContain(MA[lech]);
      const biLoaiThem = khac ?? [];
      expect(cuaFixture(kh)).toHaveLength(N - 1 - biLoaiThem.length);
      const truoc = await giaHienTai(lech);
      const r = await ghiSuaGiaTheoDon(db, nhap(kh, CG(kh)));
      expect(r.daGhi).toBe(kh.ghi.length);
      expect(await giaHienTai(lech), "đơn lệch KHÔNG bị sửa").toEqual(truoc);
      for (let i = 0; i < N; i++) if (i !== lech && !biLoaiThem.includes(i)) expect(await giaHienTai(i), `ghi danh ${i}`).toEqual(DICH[i]);
      if (lech === CHUA_TRO) expect((await db.orderItem.findUniqueOrThrow({ where: { id: id("it", CHUA_TRO) } })).enrollmentId, "dòng đơn lệch KHÔNG bị gắn").toBeNull();
    },
  );

  it("[SGT-DB-05] TRANSACTION TOÀN LÔ: lỗi ở ghi danh cuối (trigger ném khi UPDATE ghi danh #3) ⇒ ba ghi danh đã ghi + dòng đơn đã gắn cũng LÙI; claim lùi theo", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION sgt_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'SGT_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER sgt_boom_trg BEFORE UPDATE ON "Enrollment" FOR EACH ROW WHEN (NEW.id = '${id("e", 3)}') EXECUTE FUNCTION sgt_boom()`);
    const kh = await kehoach();
    const e = await thuLoi(ghiSuaGiaTheoDon(db, nhap(kh, CG(kh))));
    expect(String(e)).toMatch(/SGT_BOOM/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_THEO_DON")).toBe(0);
    expect(await soAudit("GAN_DONG_DON_GHI_DANH_THEO_DON")).toBe(0);
    expect(await soAudit("CHUAN_HOA_GIA_GHI_DANH_THEO_DON_LUOT_CHAY")).toBe(0);
  });

  it("[SGT-DB-06] TRÔI giữa kế hoạch và ghi (ai đó vừa sửa giá ghi danh #2 sau khi đã ký) ⇒ kế hoạch lập lại TRONG tx ra số khác ⇒ cả lô lùi, không claim", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.enrollment.update({ where: { id: id("e", 2) }, data: { finalPrice: NIEM_YET[2]! - 1000 } });
    const e = await thuLoi(db.$transaction((tx) => ghiSuaGiaTheoDonTrongTx(tx, nhap(kh, cong))));
    expect(String(e)).toMatch(/≠ kế hoạch/);
    await db.enrollment.update({ where: { id: id("e", 2) }, data: { finalPrice: NIEM_YET[2]! } });
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[SGT-DB-07] SAI --expect / thiếu --expect / thiếu quyền ghi ⇒ từ chối TRƯỚC khi mở transaction ghi", async () => {
    const kh = await kehoach();
    await expect(ghiSuaGiaTheoDon(db, nhap(kh, CG(kh), { soDuyet: kh.ghi.length - 1 }))).rejects.toThrow(/≠ kế hoạch/);
    await expect(ghiSuaGiaTheoDon(db, nhap(kh, CG(kh), { soDuyet: null }))).rejects.toThrow(/đòi --expect/);
    await expect(ghiSuaGiaTheoDon(db, nhap(kh, CG(kh), { ghiDuoc: false }))).rejects.toThrow(/không có quyền UPDATE/);
    await expect(ghiSuaGiaTheoDon(db, nhap(kh, CG(kh), { ghiDuoc: null }))).rejects.toThrow(/Không kiểm được/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[SGT-DB-08] BẤT BIẾN: nếu phép ghi VÔ TÌNH kéo theo (a) đổi Payment.note (b) đổi hoa hồng cũ (c) đổi cột KHÁC của dòng đơn được gắn ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    const LAN: Array<[string, string, "Enrollment" | "OrderItem"]> = [
      ["Payment.note", `UPDATE "Payment" SET note = COALESCE(note, '') || ' sửa' WHERE id = '${id("p", 0)}'`, "Enrollment"],
      ["CommissionLine.amount", `UPDATE "CommissionLine" SET amount = amount + 1 WHERE id = '${id("cl", 0)}'`, "Enrollment"],
      ["OrderItem.itemName của dòng được gắn", `UPDATE "OrderItem" SET "itemName" = "itemName" || ' sửa' WHERE id = '${id("it", CHUA_TRO)}'`, "OrderItem"],
    ];
    for (const [ten, thaan, bang] of LAN) {
      await db.$executeRawUnsafe(`CREATE FUNCTION sgt_leak() RETURNS trigger AS $f$ BEGIN ${thaan}; RETURN NEW; END $f$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe(`CREATE TRIGGER sgt_leak_trg AFTER UPDATE ON "${bang}" FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION sgt_leak()`);
      const kh = await kehoach();
      const e = await thuLoi(ghiSuaGiaTheoDon(db, nhap(kh, CG(kh))));
      expect(String(e), ten).toMatch(/Ảnh chụp bất biến/);
      await khongGhiGi();
      expect(await soClaim(), ten).toBe(0);
      await db.$executeRawUnsafe(`DROP TRIGGER sgt_leak_trg ON "${bang}"`);
      await db.$executeRawUnsafe(`DROP FUNCTION sgt_leak()`);
    }
    expect((await db.commissionLine.findUniqueOrThrow({ where: { id: id("cl", 0) } })).amount).toBe(123_456);
  });

  it("[SGT-DB-09] REPLAY nonce: dùng lại ĐÚNG artifact đã dùng (đưa dữ liệu về xuất phát) ⇒ DA_DUNG, không sửa lần hai", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await ghiSuaGiaTheoDon(db, nhap(kh, cong));
    for (let i = 0; i < N; i++) await db.enrollment.update({ where: { id: id("e", i) }, data: i === DAC_BIET ? TRONG : LEGACY(NIEM_YET[i]!) });
    await db.orderItem.update({ where: { id: id("it", CHUA_TRO) }, data: { enrollmentId: null } });
    const kh2 = await kehoach();
    expect(kh2.dongDauRa).toEqual(kh.dongDauRa);
    const e = await thuLoi(ghiSuaGiaTheoDon(db, nhap(kh2, cong)));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((e as CongGhiTuChoi).ma).toBe("DA_DUNG");
    await khongGhiGi();
  });

  it("[SGT-DB-10] KIỂM SAU GHI: trước ghi ⇒ chưa có lượt; sau ghi ⇒ mọi đơn của lượt ở giá đích, 0 dòng còn SẼ GHI, khoản chưa gắn = 0", async () => {
    const truoc = await kiemSauGhiSuaGiaTheoDon(db);
    expect(truoc.luotCuoi).toBeNull();
    const kh = await kehoach();
    await ghiSuaGiaTheoDon(db, nhap(kh, CG(kh)));
    const sau = await kiemSauGhiSuaGiaTheoDon(db);
    expect(sau.keHoach.dung).toBe(false);
    expect(sau.luotCuoi?.donDaSua.filter((c) => c.startsWith(P)).sort()).toEqual([...MA].sort());
    expect(sau.chuaDung).toEqual([]);
    expect(sau.conSeGhi).toBe(0);
    expect(sau.khoanChuaGanGhiDanh).toBe(0);
    // làm hỏng một ghi danh SAU khi ghi ⇒ kiểm sau ghi phải thấy
    await db.enrollment.update({ where: { id: id("e", 0) }, data: LEGACY(NIEM_YET[0]!) });
    const hong = await kiemSauGhiSuaGiaTheoDon(db);
    expect(hong.chuaDung, "ghi danh vừa bị đưa về giá cũ phải hiện ở chuaDung").toContain(MA[0]);
    expect(hong.conSeGhi).toBeGreaterThan(0);
  });

  it("[SGT-DB-11] ẢNH CHỤP BẤT BIẾN nhạy: đổi cột ngoài các cột được ghi (Enrollment.notes) làm đổi ảnh chụp; đổi đúng các cột giá thì KHÔNG; listPrice ghi danh thường nằm TRONG ảnh chụp", async () => {
    const kh = await kehoach();
    const a = await anhChupBatBienSuaGiaTheoDon(db, kh);
    await db.enrollment.update({ where: { id: id("e", 1) }, data: { finalPrice: 1, tuition: 2, discountAmount: 3, discountType: "X" } });
    expect(await anhChupBatBienSuaGiaTheoDon(db, kh)).toBe(a);
    await db.enrollment.update({ where: { id: id("e", 1) }, data: { notes: "đã bị sửa" } });
    expect(await anhChupBatBienSuaGiaTheoDon(db, kh)).not.toBe(a);
    await db.enrollment.update({ where: { id: id("e", 1) }, data: { notes: "ghi chú 1" } });
    expect(await anhChupBatBienSuaGiaTheoDon(db, kh)).toBe(a);
    await db.enrollment.update({ where: { id: id("e", 0) }, data: { listPrice: NIEM_YET[0]! + 1 } });
    expect(await anhChupBatBienSuaGiaTheoDon(db, kh), "listPrice của ghi danh thường nằm TRONG ảnh chụp").not.toBe(a);
  });

  it("[SGT-DB-12] ẢNH CHỤP: cột enrollmentId của dòng đơn ĐƯỢC GẮN được miễn, nhưng enrollmentId của dòng KHÁC (#0) và cột khác của dòng được gắn thì KHÔNG", async () => {
    const kh = await kehoach();
    const a = await anhChupBatBienSuaGiaTheoDon(db, kh);
    await db.orderItem.update({ where: { id: id("it", CHUA_TRO) }, data: { enrollmentId: id("e", CHUA_TRO) } });
    expect(await anhChupBatBienSuaGiaTheoDon(db, kh), "dòng được gắn: enrollmentId được miễn").toBe(a);
    await db.orderItem.update({ where: { id: id("it", 0) }, data: { enrollmentId: id("e", 2) } });
    expect(await anhChupBatBienSuaGiaTheoDon(db, kh), "dòng khác: enrollmentId nằm trong ảnh chụp").not.toBe(a);
    await db.orderItem.update({ where: { id: id("it", 0) }, data: { enrollmentId: id("e", 0) } });
    await db.orderItem.update({ where: { id: id("it", CHUA_TRO) }, data: { itemName: "đổi tên" } });
    expect(await anhChupBatBienSuaGiaTheoDon(db, kh), "cột khác của dòng được gắn nằm trong ảnh chụp").not.toBe(a);
  });

  it("[SGT-DB-13] ĐỌC LẠI SAU GHI: nếu dòng đơn sau khi gắn KHÔNG ở đúng ghi danh đã chứng minh (trigger đổi giá trị lúc ghi) ⇒ kế hoạch «sau» không sạch ⇒ cả lô lùi, không claim", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    // Trigger: ngay TRƯỚC khi lệnh ghi dòng #1, ai đó gắn nó vào ghi danh KHÁC — mô phỏng bằng trigger BEFORE UPDATE trên OrderItem đổi giá trị NEW.
    await db.$executeRawUnsafe(`CREATE FUNCTION sgt_leaki() RETURNS trigger AS $f$ BEGIN NEW."enrollmentId" := '${id("e", 2)}'; RETURN NEW; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER sgt_leaki_trg BEFORE UPDATE ON "OrderItem" FOR EACH ROW WHEN (NEW.id = '${id("it", CHUA_TRO)}') EXECUTE FUNCTION sgt_leaki()`);
    const e = await thuLoi(ghiSuaGiaTheoDon(db, nhap(kh, cong)));
    expect(e).not.toBeNull();
    await db.$executeRawUnsafe(`DROP TRIGGER sgt_leaki_trg ON "OrderItem"`);
    await db.$executeRawUnsafe(`DROP FUNCTION sgt_leaki()`);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[SGT-DB-14] KHÔNG LẤN Wave C-B: một đơn mang mã thuộc Wave C-B, dữ liệu hợp lệ ⇒ bị loại THUOC_WAVE_C_B và KHÔNG bị sửa", async () => {
    const maWaveC = MA_DON_WAVE_C_B[0]!;
    // đơn #4 dựng như #0 nhưng mã là mã Wave C-B
    await taoDon(4, { ma: maWaveC });
    const kh = await kehoach();
    expect(kh.ketQuaBang.loai.find((l) => l.code === maWaveC)?.ma).toBe("THUOC_WAVE_C_B");
    expect(kh.ghi.map((g) => g.code)).not.toContain(maWaveC);
    await ghiSuaGiaTheoDon(db, nhap(kh, CG(kh)));
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: id("e", 4) } })).finalPrice, "ghi danh của đơn mang mã Wave C-B KHÔNG bị sửa").toBe(NIEM_YET[0]);
  });
});
