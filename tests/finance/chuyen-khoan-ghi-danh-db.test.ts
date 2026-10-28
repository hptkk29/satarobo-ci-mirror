// tests/finance/chuyen-khoan-ghi-danh-db.test.ts — [CKG-DB-*] «P7-B · khoản thu và giá đi theo ghi danh đang học» trên Postgres THẬT: đọc → kế hoạch → cổng Wave 1 → ghi → kiểm sau ghi.
//
// Chạy:  pnpm test:finance-db   (hoặc `vitest run -c vitest.db.config.ts tests/finance/chuyen-khoan-ghi-danh-db.test.ts`). `pnpm test:unit` trần SKIP — log «SKIP» nghĩa là CHƯA kiểm gì.
// Khoá EPHEMERAL sinh lúc chạy; môi trường `test`. Fixture tiền tố `CKG_`; KHÔNG `resetDb()`. Lệnh KHÔNG nhận id: nó quét MỌI ghi danh đã đóng còn giữ khoản thu của DB, nên mọi khẳng định lọc theo tiền tố `CKG_`.
// Fixture «hình dạng thật» (đo PROD 26/10/2026), hai cặp (ghi danh đóng → ghi danh đang học):
//   #0 add nhầm rồi gỡ (WITHDREW), dòng đơn đã trỏ ghi danh MỚI (dây R1), 1 khoản 8.976.000 không gắn dòng, có biên lai trỏ ghi danh cũ ·
//   #1 chuyển lớp (TRANSFERRED, transferredToId = mới — dây R2), dòng đơn chưa trỏ, 2 khoản gắn dòng, có một dòng hoa hồng cũ trỏ ghi danh cũ. Ghi danh mới của cả hai CẢ NĂM cột giá NULL.
//
// Ánh xạ yêu cầu P7-B/B → ca:
//   chuyển khoản + giá, tổng không đổi ⇒ [00] [01] [14]   |   idempotent ⇒ [02]   |   cổng ký riêng (không dùng chéo artifact P7-A / Wave C) ⇒ [03] [09]   |   chống gắn trùng ⇒ [06] [07]
//   cặp lệch bị LOẠI, không bị sửa ⇒ [04]   |   rollback toàn lô ⇒ [05]   |   bất biến ⇒ [08] [11] [12]   |   kiểm sau ghi ⇒ [10]
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dungCongGhiThu, type TuyChinhCongGhi } from "@/tests/_helpers/cong-ghi-wave1";
import { CongGhiTuChoi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  ACTOR_CHUYEN_KHOAN,
  anhChupBatBienChuyenKhoan,
  docKeHoachChuyenKhoan,
  ghiChuyenKhoan,
  ghiChuyenKhoanTrongTx,
  kiemSauGhiChuyenKhoan,
  type DauVaoGhiChuyenKhoan,
} from "@/lib/nguon/chuyen-khoan-ghi-danh-db";
import type { KeHoachChuyenKhoan } from "@/lib/nguon/chuyen-khoan-ghi-danh";

if (!RUN_DB_TESTS) console.warn(`[CKG-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "CKG_";
const CS1 = `${P}cs1`;
const KHOA = `${P}khoa`;
const LOP_CU = `${P}lopcu`;
const LOP_MOI = `${P}lopmoi`;
const LOP_X = `${P}lopx`;
const N = 2;
const id = (k: string, i: number) => `${P}${k}${i}`;
const CU = (i: number) => id("ecu", i);
const MOI = (i: number) => id("emoi", i);
const GIA = { listPrice: 10_560_000, discountType: null, discountAmount: 0, tuition: 10_560_000, finalPrice: 10_560_000 };
const TRONG = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
const TIEN = [[8_976_000], [2_508_000, 2_508_000]] as const;
const MOC = new Date("2026-10-26T03:00:00.000Z");
const NGAY_THU = new Date("2026-09-20T03:00:00.000Z");
const LUOT = { batDauLuc: MOC, nguonChay: { actor: "a", triggeringActor: "b", runId: "9830001", runAttempt: "1" } } as const;
const nonceDaDung: string[] = [];
const DB_LOT = "luot:9830001";

async function don() {
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: P } }, { id: { in: nonceDaDung.map((n) => `wg:${n}`) } }, { entityId: { startsWith: DB_LOT } }] } });
  for (const t of ["boom", "leak", "leakp"]) {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ckg_${t}_trg ON "Enrollment"`);
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ckg_${t}_trg ON "Payment"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ckg_${t}()`);
  }
  await db.receipt.deleteMany({ where: { id: { startsWith: P } } });
  await db.commissionLine.deleteMany({ where: { id: { startsWith: P } } });
  await db.commissionStatement.deleteMany({ where: { id: { startsWith: P } } });
  await db.studentReserve.deleteMany({ where: { id: { startsWith: P } } });
  await db.payment.deleteMany({ where: { id: { startsWith: P } } });
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: P } } });
  await db.order.deleteMany({ where: { id: { startsWith: P } } });
  await db.enrollment.updateMany({ where: { id: { startsWith: P } }, data: { transferredToId: null } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: P } } });
  await db.student.deleteMany({ where: { id: { startsWith: P } } });
  await db.leadChild.deleteMany({ where: { id: { startsWith: P } } });
  await db.lead.deleteMany({ where: { id: { startsWith: P } } });
  await db.class.deleteMany({ where: { id: { in: [LOP_CU, LOP_MOI, LOP_X] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, `${KHOA}2`] } } });
  await db.center.deleteMany({ where: { id: CS1 } });
}

async function taoCap(i: number) {
  const phone = `098800000${i}`;
  await db.lead.create({ data: { id: id("l", i), parentName: `PH CKG ${i}`, phone, status: "DA_DANG_KY", centerId: CS1 } });
  await db.leadChild.create({ data: { id: id("be", i), leadId: id("l", i), fullName: `Bé CKG ${i}` } });
  await db.student.create({ data: { id: id("s", i), name: `Bé CKG ${i}`, leadId: id("l", i), leadChildId: id("be", i), centerId: CS1, parentPhone: phone } });
  await db.enrollment.create({ data: { id: MOI(i), studentId: id("s", i), classId: LOP_MOI, courseId: KHOA, status: "STUDYING", centerId: CS1, notes: `moi ${i}` } });
  await db.enrollment.create({
    data: {
      id: CU(i), studentId: id("s", i), classId: LOP_CU, courseId: KHOA, status: i === 0 ? "WITHDREW" : "TRANSFERRED", centerId: CS1, transferredToId: i === 1 ? MOI(i) : null,
      listPrice: GIA.listPrice, discountType: GIA.discountType, discountAmount: GIA.discountAmount, tuition: GIA.tuition, finalPrice: GIA.finalPrice, notes: `cu ${i}`,
    },
  });
  const tong = TIEN[i]!.reduce((s, x) => s + x, 0);
  await db.order.create({
    data: { id: id("o", i), code: `${P}ORD-${i}`, type: "COURSE", status: i === 0 ? "CONFIRMED" : "PENDING_PAYMENT", customerName: `PH CKG ${i}`, customerPhone: phone, subtotal: GIA.listPrice, discountAmount: GIA.listPrice - tong, totalAmount: tong, leadId: id("l", i), centerId: CS1, createdAt: new Date("2026-09-17T03:00:00Z") },
  });
  await db.orderItem.create({
    data: { id: id("it", i), orderId: id("o", i), type: "COURSE_ENROLLMENT", itemName: "Khoá CKG", quantity: 1, unitPrice: GIA.listPrice, totalPrice: GIA.listPrice, metadata: { courseId: KHOA }, enrollmentId: i === 0 ? MOI(i) : null },
  });
  for (let k = 0; k < TIEN[i]!.length; k++) {
    await db.payment.create({
      data: {
        id: id(`p${k}_`, i), orderId: id("o", i), ...(i === 1 ? { orderItemId: id("it", i) } : {}), amount: TIEN[i]![k]!, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED",
        centerId: CS1, enrollmentId: CU(i),
      },
    });
  }
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS1, name: "Cơ sở CKG 1", slug: `${P}cs-1`, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Sata3 CKG", slug: `${P}sata3`, totalSessions: 48, price: GIA.listPrice } });
  await db.class.create({ data: { id: LOP_CU, name: "Lớp cũ CKG", courseId: KHOA } });
  await db.class.create({ data: { id: LOP_MOI, name: "Lớp mới CKG", courseId: KHOA } });
  await db.class.create({ data: { id: LOP_X, name: "Lớp X CKG", courseId: KHOA } });
  for (let i = 0; i < N; i++) await taoCap(i);
  // Biên lai trỏ ghi danh CŨ của cặp #0 và một dòng hoa hồng cũ trỏ ghi danh CŨ của cặp #1 — PHẢI đứng yên.
  await db.receipt.create({ data: { id: id("rc", 0), code: `${P}RCP-0`, enrollmentId: CU(0), paymentId: id("p0_", 0) } });
  await db.commissionStatement.create({ data: { id: id("st", 1), period: `${P}2026-10` } });
  await db.commissionLine.create({ data: { id: id("cl", 1), statementId: id("st", 1), recipientId: `${P}nguoi`, tier: "TRIAL_TEACHER", amount: 105_600, leadId: id("l", 1), enrollmentId: CU(1) } });
}

let demNonce = 0;
const CG = (kh: KeHoachChuyenKhoan, o: Partial<TuyChinhCongGhi> = {}): DauVaoCongGhi => {
  const nonce = o.nonce ?? `9e71${String(++demNonce).padStart(28, "0")}`;
  nonceDaDung.push(nonce);
  return dungCongGhiThu(WORKFLOW_WAVE1.chuyenKhoanGhiDanh, [...kh.dongDauRa], { now: MOC, ...o, nonce }).cong;
};
const nhap = (kh: KeHoachChuyenKhoan, congGhi: DauVaoCongGhi, o: Partial<DauVaoGhiChuyenKhoan> = {}): DauVaoGhiChuyenKhoan => ({
  soDuyet: kh.ghi.length, ghiDuoc: true, actor: ACTOR_CHUYEN_KHOAN, luotChay: LUOT, congGhi, ...o,
});
const kehoach = () => docKeHoachChuyenKhoan(db);
const gia = (eid: string) => db.enrollment.findUniqueOrThrow({ where: { id: eid }, select: { listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true } });
const khoanCua = (eid: string) => db.payment.count({ where: { enrollmentId: eid, deletedAt: null } });
const khongGhiGi = async () => {
  for (let i = 0; i < N; i++) {
    expect(await gia(CU(i)), `cu ${i}`).toEqual(GIA);
    expect(await gia(MOI(i)), `moi ${i}`).toEqual(TRONG);
    expect(await khoanCua(CU(i)), `khoản cu ${i}`).toBe(TIEN[i]!.length);
    expect(await khoanCua(MOI(i)), `khoản moi ${i}`).toBe(0);
  }
};
const soClaim = () => db.auditLog.count({ where: { id: { in: nonceDaDung.map((n) => `wg:${n}`) } } });
const soAudit = (action: string) => db.auditLog.count({ where: { action, OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: DB_LOT } }] } });
const thuLoi = (p: Promise<unknown>) => p.then(() => null, (x: unknown) => x);
const cuaFixture = (kh: KeHoachChuyenKhoan) => kh.ghi.filter((g) => g.cuId.startsWith(P));

describe.skipIf(!RUN_DB_TESTS)("[CKG-DB] khoản thu và giá đi theo ghi danh đang học — Postgres thật", () => {
  beforeEach(async () => {
    await dung();
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[CKG-DB-00] ĐỐI CHỨNG DƯƠNG fixture: kế hoạch ra ĐÚNG 2 cặp không cần id; cặp #0 dây R1, cặp #1 dây R2; biên lai / hoa hồng còn trỏ cũ được BÁO, không chặn", async () => {
    await khongGhiGi();
    const kh = await kehoach();
    expect(kh.loiLo).toEqual([]);
    const g = cuaFixture(kh);
    expect(g.map((x) => [x.cuId, x.moiId, x.dayLienKet, x.khoanIds.length, x.tongTien])).toEqual([
      [CU(0), MOI(0), "R1", 1, 8_976_000],
      [CU(1), MOI(1), "R2", 2, 5_016_000],
    ]);
    expect(g[0]).toMatchObject({ bienLaiConTroCu: 1, hoaHongConTroCu: 0 });
    expect(g[1]).toMatchObject({ bienLaiConTroCu: 0, hoaHongConTroCu: 1 });
  });

  it("[CKG-DB-01] GHI: khoản chuyển sang ghi danh mới, giá đi theo, tổng KHÔNG đổi; số tiền/trạng thái/ngày thu y nguyên; Order, dòng đơn, biên lai, hoa hồng y nguyên; audit đủ + claim", async () => {
    const tongTruoc = await db.payment.aggregate({ where: { id: { startsWith: P } }, _sum: { amount: true } });
    const payTruoc = await db.payment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const orderTruoc = await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } });
    const rcTruoc = await db.receipt.findMany({ where: { id: { startsWith: P } } });
    const hhTruoc = await db.commissionLine.findMany({ where: { id: { startsWith: P } } });
    const enrTruoc = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const kh = await kehoach();
    const r = await ghiChuyenKhoan(db, nhap(kh, CG(kh)));
    expect(r).toMatchObject({ soCap: kh.ghi.length, keHoachSha: kh.sha });

    for (let i = 0; i < N; i++) {
      expect(await gia(MOI(i)), `moi ${i}`).toEqual(GIA);
      expect(await gia(CU(i)), `cu ${i}`).toEqual(TRONG);
      expect(await khoanCua(MOI(i))).toBe(TIEN[i]!.length);
      expect(await khoanCua(CU(i))).toBe(0);
    }
    const bo = (o: Record<string, unknown>, ...k: string[]) => Object.fromEntries(Object.entries(o).filter(([key]) => !k.includes(key)));
    const payNay = await db.payment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    expect(payNay.map((p) => bo(p, "enrollmentId", "updatedAt"))).toEqual(payTruoc.map((p) => bo(p, "enrollmentId", "updatedAt")));
    expect(payNay.map((p) => p.enrollmentId)).toEqual(payTruoc.map((p) => (p.orderId === id("o", 0) ? MOI(0) : MOI(1))));
    expect((await db.payment.aggregate({ where: { id: { startsWith: P } }, _sum: { amount: true } }))._sum.amount).toBe(tongTruoc._sum.amount);
    const enrNay = await db.enrollment.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" } });
    const giaCot = ["listPrice", "discountType", "discountAmount", "tuition", "finalPrice", "updatedAt"];
    expect(enrNay.map((e) => bo(e, ...giaCot))).toEqual(enrTruoc.map((e) => bo(e, ...giaCot)));
    expect(await db.order.findMany({ where: { id: { startsWith: P } }, orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } })).toEqual(orderTruoc);
    expect(await db.receipt.findMany({ where: { id: { startsWith: P } } })).toEqual(rcTruoc);
    expect(await db.commissionLine.findMany({ where: { id: { startsWith: P } } })).toEqual(hhTruoc);

    expect(await soAudit("CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC")).toBe(3);
    expect(await soAudit("CHUYEN_GIA_SANG_GHI_DANH_DANG_HOC")).toBe(4);
    expect(await soAudit("CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC_LUOT_CHAY")).toBe(1);
    expect(await soClaim()).toBe(1);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC", entityId: id("p0_", 0) } });
    expect(a).toMatchObject({ entityType: "Payment", changedFields: ["enrollmentId"] });
    expect(a.oldValues).toEqual({ enrollmentId: CU(0) });
    const luot = await db.auditLog.findFirstOrThrow({ where: { action: "CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC_LUOT_CHAY" } });
    expect(luot.newValues).toMatchObject({ expectedCount: kh.ghi.length, actualCount: kh.ghi.length, khop: true, keHoachSha: kh.sha });
  });

  it("[CKG-DB-02] IDEMPOTENT: chạy lại sau khi chuyển ⇒ 0 cặp, KHÔNG qua cổng, KHÔNG claim, KHÔNG audit thêm — kể cả khi không có artifact", async () => {
    const kh = await kehoach();
    await ghiChuyenKhoan(db, nhap(kh, CG(kh)));
    const truocAudit = await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: DB_LOT } }] } });
    const claim = await soClaim();
    const ky2 = await kehoach();
    expect(cuaFixture(ky2)).toEqual([]);
    const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };
    const r = await ghiChuyenKhoan(db, nhap(ky2, congRong, { soDuyet: 0 }));
    expect(r).toMatchObject({ soCap: 0, soKhoan: 0 });
    expect(await db.auditLog.count({ where: { OR: [{ entityId: { startsWith: P } }, { entityId: { startsWith: DB_LOT } }] } })).toBe(truocAudit);
    expect(await soClaim()).toBe(claim);
    // KHÔNG nhân đôi: mỗi ghi danh mới vẫn giữ đúng số khoản và đúng MỘT bộ giá
    for (let i = 0; i < N; i++) {
      expect(await khoanCua(MOI(i))).toBe(TIEN[i]!.length);
      expect(await gia(MOI(i))).toEqual(GIA);
    }
  });

  it("[CKG-DB-03] CỔNG KÝ: thiếu artifact / ký cho workflow KHÁC (P7-A · Wave C-B · C-A · C-C · B.2) / dòng khác / sai môi trường / khoá không ghim ⇒ từ chối TRƯỚC phép ghi đầu tiên, không đổi gì, 0 claim", async () => {
    const kh = await kehoach();
    const cong0 = CG(kh);
    const CASES: Array<[string, DauVaoCongGhi, string]> = [
      ["thiếu artifact", { ...cong0, artifact: null }, "THIEU_ARTIFACT"],
      ["workflow P7-A", CG(kh, { workflowKy: WORKFLOW_WAVE1.suaGiaTheoDon }), "SAI_WORKFLOW"],
      ["workflow Wave C-B", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCSuaGia }), "SAI_WORKFLOW"],
      ["workflow C-A", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCGanDanhTinh }), "SAI_WORKFLOW"],
      ["workflow C-C", CG(kh, { workflowKy: WORKFLOW_WAVE1.waveCGanPayment }), "SAI_WORKFLOW"],
      ["workflow B.2", CG(kh, { workflowKy: WORKFLOW_WAVE1.ganPaymentGhiDanh }), "SAI_WORKFLOW"],
      ["dòng khác (plan SHA lệch)", CG(kh, { rowsKy: kh.dongDauRa.slice(0, kh.ghi.length - 1) }), "LECH_DIGEST"],
      ["môi trường", CG(kh, { moiTruongKy: "prod" }), "SAI_MOI_TRUONG"],
      ["chưa ghim khoá", { ...cong0, keyIdTinCay: "" }, "KHOA_KHONG_KHOP"],
    ];
    for (const [ten, cong, ma] of CASES) {
      const e = await thuLoi(ghiChuyenKhoan(db, nhap(kh, cong)));
      expect(e, ten).toBeInstanceOf(CongGhiTuChoi);
      expect((e as CongGhiTuChoi).ma, ten).toBe(ma);
      await khongGhiGi();
    }
    expect(await soClaim()).toBe(0);
    expect(await soAudit("CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC")).toBe(0);
  });

  it.each([
    ["ghi danh mới ĐÃ CÓ giá", 1, async () => { await db.enrollment.update({ where: { id: MOI(1) }, data: { finalPrice: 1 } }); }, "GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN"],
    ["ghi danh mới ĐÃ CÓ khoản thu sống (chống trộn tiền hai nơi)", 0, async () => { await db.payment.create({ data: { id: id("px", 0), orderId: id("o", 0), amount: 1, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, enrollmentId: MOI(0) } }); }, "GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN"],
    ["một khoản chờ xác nhận (PENDING)", 1, async () => { await db.payment.update({ where: { id: id("p1_", 1) }, data: { accountantStatus: "PENDING" } }); }, "KHOAN_KHONG_HOP_LE"],
    ["một khoản bị từ chối còn sống", 0, async () => { await db.payment.create({ data: { id: id("px", 0), orderId: id("o", 0), amount: 100, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "REJECTED", centerId: CS1, enrollmentId: CU(0) } }); }, "KHOAN_KHONG_HOP_LE"],
    ["tiền vượt giá ghi danh cũ", 0, async () => { await db.payment.update({ where: { id: id("p0_", 0) }, data: { amount: 10_560_001 } }); }, "TIEN_VUOT_GIA"],
    ["ghi danh cũ không giá", 1, async () => { await db.enrollment.update({ where: { id: CU(1) }, data: TRONG }); }, "GHI_DANH_CU_KHONG_CO_GIA"],
    ["biên lai trỏ ghi danh MỚI", 0, async () => { await db.receipt.create({ data: { id: id("rc", 9), code: `${P}RCP-9`, enrollmentId: MOI(0), paymentId: id("p0_", 0) } }); }, "CO_RANG_BUOC_CHAN"],
    ["bảo lưu trên ghi danh cũ", 1, async () => { await db.studentReserve.create({ data: { id: id("br", 1), studentId: id("s", 1), enrollmentId: CU(1), reason: "x", createdByName: "t" } }); }, "CO_RANG_BUOC_CHAN"],
    ["dòng đơn của khoản trỏ một ghi danh đóng KHÁC (dây R1 ≠ R2)", 1, async () => { await db.orderItem.update({ where: { id: id("it", 1) }, data: { enrollmentId: CU(0) } }); }, "HAI_DAY_LIEN_KET_LECH"],
    ["hai dây liên kết trỏ hai ghi danh khác nhau (R1 ≠ R2)", 1, async () => { await db.orderItem.update({ where: { id: id("it", 1) }, data: { enrollmentId: MOI(0) } }); }, "HAI_DAY_LIEN_KET_LECH"],
    ["khoản có ngày thu NGOÀI cửa sổ T9–T10 (dữ liệu lịch sử T6 «Nhập liệu ban đầu»)", 1, async () => { await db.payment.update({ where: { id: id("p0_", 1) }, data: { paidDate: new Date("2026-06-10T03:00:00Z") } }); }, "NGOAI_CUA_SO_NGAY_THU"],
    ["khoản có ngày thu từ 23/10 (sau mốc cắt)", 0, async () => { await db.payment.update({ where: { id: id("p0_", 0) }, data: { paidDate: new Date("2026-10-22T17:00:00.000Z") } }); }, "NGOAI_CUA_SO_NGAY_THU"],
    ["ghi danh mới khác khoá", 0, async () => { await db.course.create({ data: { id: `${KHOA}2`, name: "K2", slug: `${P}k2`, totalSessions: 48, price: 1 } }); await db.enrollment.update({ where: { id: MOI(0) }, data: { courseId: `${KHOA}2` } }); }, "LECH_HOC_VIEN_KHOA_CO_SO"],
  ] as [string, number, () => Promise<void>, string][])("[CKG-DB-04] CẶP LỆCH BỊ LOẠI (không bị sửa): %s", async (_ten, lech, lamHong, ma) => {
    await lamHong();
    const kh = await kehoach();
    const loai = kh.loai.filter((l) => l.cuId === CU(lech));
    expect(loai.map((l) => l.ma), "cặp lệch phải có lý do bị loại").toContain(ma);
    expect(cuaFixture(kh).map((g) => g.cuId)).not.toContain(CU(lech));
    const giaTruoc = await Promise.all([gia(CU(lech)), gia(MOI(lech)), khoanCua(CU(lech)), khoanCua(MOI(lech))]);
    if (cuaFixture(kh).length > 0) {
      const r = await ghiChuyenKhoan(db, nhap(kh, CG(kh)));
      expect(r.soCap).toBe(kh.ghi.length);
    }
    expect(await Promise.all([gia(CU(lech)), gia(MOI(lech)), khoanCua(CU(lech)), khoanCua(MOI(lech))]), "cặp lệch KHÔNG bị sửa").toEqual(giaTruoc);
  });

  it("[CKG-DB-04b] ghi danh cũ CÒN HIỆU LỰC (ACTIVE) không bao giờ là ứng viên: khoản của nó đứng yên, không có dòng loại, không có dòng ghi", async () => {
    await db.enrollment.update({ where: { id: CU(0) }, data: { status: "ACTIVE" } });
    const kh = await kehoach();
    expect(kh.ghi.map((g) => g.cuId)).not.toContain(CU(0));
    expect(kh.loai.map((l) => l.cuId)).not.toContain(CU(0));
    await ghiChuyenKhoan(db, nhap(kh, CG(kh)));
    expect(await khoanCua(CU(0))).toBe(1);
    expect(await khoanCua(MOI(0))).toBe(0);
    expect(await gia(CU(0))).toEqual(GIA);
  });

  it("[CKG-DB-05] TRANSACTION TOÀN LÔ: lỗi ở ghi danh mới của cặp #1 (trigger ném) ⇒ khoản và giá của cặp #0 đã chuyển trước đó cũng LÙI; claim lùi theo", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION ckg_boom() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'CKG_BOOM'; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ckg_boom_trg BEFORE UPDATE ON "Enrollment" FOR EACH ROW WHEN (NEW.id = '${MOI(1)}') EXECUTE FUNCTION ckg_boom()`);
    const kh = await kehoach();
    const e = await thuLoi(ghiChuyenKhoan(db, nhap(kh, CG(kh))));
    expect(String(e)).toMatch(/CKG_BOOM/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
    expect(await soAudit("CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC")).toBe(0);
    expect(await soAudit("CHUYEN_GIA_SANG_GHI_DANH_DANG_HOC")).toBe(0);
    expect(await soAudit("CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC_LUOT_CHAY")).toBe(0);
  });

  it("[CKG-DB-06] CHỐNG GẮN TRÙNG ở cấp lô: thêm một ghi danh đóng thứ hai cùng trỏ ghi danh mới #1 ⇒ TRUNG_DICH ⇒ DỪNG CẢ LÔ, không khoản nào đổi chỗ", async () => {
    await db.enrollment.create({ data: { id: id("ecu", 7), studentId: id("s", 1), classId: LOP_X, courseId: KHOA, status: "WITHDREW", centerId: CS1, transferredToId: MOI(1), ...GIA } });
    await db.payment.create({ data: { id: id("pz", 7), orderId: id("o", 1), orderItemId: id("it", 1), amount: 1000, method: "sepay", paidDate: NGAY_THU, saleStatus: "RECORDED", accountantStatus: "CONFIRMED", centerId: CS1, enrollmentId: id("ecu", 7) } });
    const kh = await kehoach();
    expect(kh.dung).toBe(true);
    expect(kh.loiLo.map((l) => l.ma)).toContain("TRUNG_DICH");
    expect(kh.ghi).toEqual([]);
    // kế hoạch dừng ⇒ không có dòng nào để ký; cổng số duyệt chặn TRƯỚC khi chạm tới cổng ký
    const congRong: DauVaoCongGhi = { artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, now: MOC, runRef: "x" };
    const e = await thuLoi(ghiChuyenKhoan(db, nhap(kh, congRong, { soDuyet: 0 })));
    expect(String(e)).toMatch(/DỪNG/);
    expect(await khoanCua(MOI(0))).toBe(0);
    expect(await khoanCua(MOI(1))).toBe(0);
    expect(await soClaim()).toBe(0);
  });

  it("[CKG-DB-07] TRÔI giữa kế hoạch và ghi (ai đó vừa đổi một khoản sang PENDING sau khi đã ký) ⇒ kế hoạch lập lại TRONG tx ra số khác ⇒ cả lô lùi, không claim", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await db.payment.update({ where: { id: id("p1_", 1) }, data: { accountantStatus: "PENDING" } });
    const e = await thuLoi(db.$transaction((tx) => ghiChuyenKhoanTrongTx(tx, nhap(kh, cong))));
    expect(String(e)).toMatch(/≠ kế hoạch/);
    await db.payment.update({ where: { id: id("p1_", 1) }, data: { accountantStatus: "CONFIRMED" } });
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[CKG-DB-07b] SAI --expect / thiếu --expect / thiếu quyền ghi ⇒ từ chối TRƯỚC khi mở transaction ghi", async () => {
    const kh = await kehoach();
    await expect(ghiChuyenKhoan(db, nhap(kh, CG(kh), { soDuyet: kh.ghi.length - 1 }))).rejects.toThrow(/≠ kế hoạch/);
    await expect(ghiChuyenKhoan(db, nhap(kh, CG(kh), { soDuyet: null }))).rejects.toThrow(/đòi --expect/);
    await expect(ghiChuyenKhoan(db, nhap(kh, CG(kh), { ghiDuoc: false }))).rejects.toThrow(/không có quyền UPDATE/);
    await expect(ghiChuyenKhoan(db, nhap(kh, CG(kh), { ghiDuoc: null }))).rejects.toThrow(/Không kiểm được/);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[CKG-DB-08] BẤT BIẾN: nếu phép ghi VÔ TÌNH kéo theo (a) đổi Payment.note (b) đổi hoa hồng cũ (c) đổi biên lai ⇒ ảnh chụp sau ≠ trước ⇒ throw, cả lô lùi", async () => {
    const LAN: Array<[string, string, "Enrollment" | "Payment"]> = [
      ["Payment.note", `UPDATE "Payment" SET note = COALESCE(note, '') || ' sửa' WHERE id = '${id("p0_", 0)}'`, "Enrollment"],
      ["CommissionLine.amount", `UPDATE "CommissionLine" SET amount = amount + 1 WHERE id = '${id("cl", 1)}'`, "Enrollment"],
      ["Receipt.status", `UPDATE "Receipt" SET status = 'VOID' WHERE id = '${id("rc", 0)}'`, "Payment"],
    ];
    for (const [ten, thaan, bang] of LAN) {
      await db.$executeRawUnsafe(`CREATE FUNCTION ckg_leak() RETURNS trigger AS $f$ BEGIN ${thaan}; RETURN NEW; END $f$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe(`CREATE TRIGGER ckg_leak_trg AFTER UPDATE ON "${bang}" FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION ckg_leak()`);
      const kh = await kehoach();
      const e = await thuLoi(ghiChuyenKhoan(db, nhap(kh, CG(kh))));
      expect(String(e), ten).toMatch(/Ảnh chụp bất biến/);
      await khongGhiGi();
      expect(await soClaim(), ten).toBe(0);
      await db.$executeRawUnsafe(`DROP TRIGGER ckg_leak_trg ON "${bang}"`);
      await db.$executeRawUnsafe(`DROP FUNCTION ckg_leak()`);
    }
    expect((await db.commissionLine.findUniqueOrThrow({ where: { id: id("cl", 1) } })).amount).toBe(105_600);
  });

  it("[CKG-DB-09] REPLAY nonce: dùng lại ĐÚNG artifact đã dùng (đưa dữ liệu về xuất phát) ⇒ DA_DUNG, không chuyển lần hai", async () => {
    const kh = await kehoach();
    const cong = CG(kh);
    await ghiChuyenKhoan(db, nhap(kh, cong));
    for (let i = 0; i < N; i++) {
      await db.enrollment.update({ where: { id: CU(i) }, data: GIA });
      await db.enrollment.update({ where: { id: MOI(i) }, data: TRONG });
      await db.payment.updateMany({ where: { orderId: id("o", i) }, data: { enrollmentId: CU(i) } });
    }
    const kh2 = await kehoach();
    expect(kh2.dongDauRa).toEqual(kh.dongDauRa);
    const e = await thuLoi(ghiChuyenKhoan(db, nhap(kh2, cong)));
    expect(e).toBeInstanceOf(CongGhiTuChoi);
    expect((e as CongGhiTuChoi).ma).toBe("DA_DUNG");
    await khongGhiGi();
  });

  it("[CKG-DB-10] KIỂM SAU GHI: trước ghi ⇒ chưa có lượt; sau ghi ⇒ mọi cặp ở trạng thái đích, 0 cặp còn SẼ CHUYỂN; làm hỏng một cặp SAU khi ghi ⇒ bị bắt", async () => {
    const truoc = await kiemSauGhiChuyenKhoan(db);
    expect(truoc.luotCuoi).toBeNull();
    const kh = await kehoach();
    await ghiChuyenKhoan(db, nhap(kh, CG(kh)));
    const sau = await kiemSauGhiChuyenKhoan(db);
    expect(sau.keHoach.dung).toBe(false);
    expect(sau.luotCuoi?.soCap).toBe(kh.ghi.length);
    expect(sau.capSai).toEqual([]);
    expect(sau.conSeChuyen).toBe(0);
    await db.enrollment.update({ where: { id: MOI(0) }, data: { finalPrice: 1 } });
    const hong = await kiemSauGhiChuyenKhoan(db);
    expect(hong.capSai.join(",")).toContain(`${CU(0)}→${MOI(0)}`);
  });

  it("[CKG-DB-11] ẢNH CHỤP BẤT BIẾN nhạy: đổi cột ngoài các cột được ghi (Enrollment.notes, Payment.note) làm đổi ảnh chụp; đổi đúng cột giá / Payment.enrollmentId thì KHÔNG", async () => {
    const kh = await kehoach();
    const a = await anhChupBatBienChuyenKhoan(db, kh);
    await db.enrollment.update({ where: { id: MOI(1) }, data: { finalPrice: 1, tuition: 2, discountAmount: 3, discountType: "X", listPrice: 4 } });
    await db.payment.update({ where: { id: id("p0_", 1) }, data: { enrollmentId: MOI(1) } });
    expect(await anhChupBatBienChuyenKhoan(db, kh)).toBe(a);
    await db.enrollment.update({ where: { id: MOI(1) }, data: { ...TRONG, notes: "đã bị sửa" } });
    expect(await anhChupBatBienChuyenKhoan(db, kh)).not.toBe(a);
    await db.enrollment.update({ where: { id: MOI(1) }, data: { notes: "moi 1" } });
    expect(await anhChupBatBienChuyenKhoan(db, kh)).toBe(a);
    await db.payment.update({ where: { id: id("p0_", 1) }, data: { note: "đổi" } });
    expect(await anhChupBatBienChuyenKhoan(db, kh), "Payment.note nằm TRONG ảnh chụp").not.toBe(a);
  });

  it("[CKG-DB-12] BIÊN LAI VÀ HOA HỒNG ĐỨNG YÊN: sau khi chuyển, biên lai vẫn trỏ ghi danh cũ và dòng hoa hồng vẫn trỏ ghi danh cũ — lệnh chỉ BÁO, không sửa chứng từ", async () => {
    const kh = await kehoach();
    await ghiChuyenKhoan(db, nhap(kh, CG(kh)));
    expect((await db.receipt.findUniqueOrThrow({ where: { id: id("rc", 0) } })).enrollmentId).toBe(CU(0));
    expect((await db.commissionLine.findUniqueOrThrow({ where: { id: id("cl", 1) } })).enrollmentId).toBe(CU(1));
  });

  it("[CKG-DB-13] ĐÚNG TRẠNG THÁI ĐÍCH: nếu sau phép ghi giá của ghi danh MỚI không còn bằng giá mang đi (trigger làm lệch 1đ) ⇒ kiểm hậu điều kiện bắt, cả lô lùi, không claim", async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION ckg_leak() RETURNS trigger AS $f$ BEGIN UPDATE "Enrollment" SET "finalPrice" = "finalPrice" + 1 WHERE id = '${MOI(0)}'; RETURN NEW; END $f$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ckg_leak_trg AFTER UPDATE ON "Enrollment" FOR EACH ROW WHEN (pg_trigger_depth() = 0 AND NEW.id = '${MOI(0)}' AND NEW."finalPrice" IS NOT NULL) EXECUTE FUNCTION ckg_leak()`);
    const kh = await kehoach();
    const e = await thuLoi(ghiChuyenKhoan(db, nhap(kh, CG(kh))));
    expect(String(e)).toMatch(/chưa đúng trạng thái đích/);
    await db.$executeRawUnsafe(`DROP TRIGGER ckg_leak_trg ON "Enrollment"`);
    await db.$executeRawUnsafe(`DROP FUNCTION ckg_leak()`);
    await khongGhiGi();
    expect(await soClaim()).toBe(0);
  });

  it("[CKG-DB-14] TỔNG KHÔNG ĐỔI theo học viên: Σ giá (finalPrice) và Σ khoản thu của từng học viên y nguyên trước/sau; chỉ đổi CHỖ ĐỨNG", async () => {
    const tong = async () => {
      const out: Record<string, { gia: number; tien: number }> = {};
      for (let i = 0; i < N; i++) {
        const es = await db.enrollment.findMany({ where: { studentId: id("s", i) }, select: { finalPrice: true } });
        const ps = await db.payment.aggregate({ where: { orderId: id("o", i), deletedAt: null }, _sum: { amount: true } });
        out[`s${i}`] = { gia: es.reduce((s, e) => s + (e.finalPrice ?? 0), 0), tien: ps._sum.amount ?? 0 };
      }
      return out;
    };
    const truoc = await tong();
    const kh = await kehoach();
    await ghiChuyenKhoan(db, nhap(kh, CG(kh)));
    expect(await tong()).toEqual(truoc);
  });
});
