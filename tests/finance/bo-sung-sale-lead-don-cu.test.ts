// tests/finance/bo-sung-sale-lead-don-cu.test.ts — [BSL-*] BỔ SUNG SALE PHỤ TRÁCH + LIÊN KẾT LEAD cho đơn đã chuyển đổi trước 21/10/2026, Postgres THẬT.
//
// Chạy:  pnpm test:finance-db   (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
//
// Gọi THẲNG `boSungSaleLeadDonCu` với `donIds` giới hạn vào fixture của chính ca này (không đụng đơn khác trong DB).
// KHÔNG gọi `resetDb()`: tự dựng, tự dọn theo tiền tố id. Mỗi ca tự dựng lại từ đầu (chạy MỘT MÌNH vẫn xanh — luật 18).
import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { boSungSaleLeadDonCu } from "@/lib/orders/bo-sung-sale-lead-don-cu";
import type { PrismaClient } from "@prisma/client";

if (!RUN_DB_TESTS) console.warn(`[BSL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const T = "fx-bsl-";
const CS = `${T}co-so`;
const KH = `${T}khoa`;
const LOP = `${T}lop`;
const LOP2 = `${T}lop-2`;
const SALE = `${T}sale`;
const SALE2 = `${T}sale-2`;
const L1 = `${T}lead-1`;
const L2 = `${T}lead-2`;
const L3 = `${T}lead-3`;
const C1 = `${T}con-1`;
const C3 = `${T}con-3`;
const DON = [1, 2, 3, 4, 5, 6].map((i) => `${T}don-${i}`);
const HV = [1, 2, 3, 4, 5].map((i) => `${T}hv-${i}`);
const GD = [1, 2, 3, 4, 5, 6].map((i) => `${T}gd-${i}`);
const DB = db as unknown as PrismaClient;

async function don() {
  await db.orderItem.deleteMany({ where: { orderId: { in: DON } } });
  await db.order.deleteMany({ where: { id: { in: DON } } });
  await db.enrollment.deleteMany({ where: { id: { in: GD } } });
  await db.student.deleteMany({ where: { id: { in: HV } } });
  await db.leadChild.deleteMany({ where: { leadId: { in: [L1, L2, L3] } } });
  await db.lead.deleteMany({ where: { id: { in: [L1, L2, L3] } } });
  await db.user.deleteMany({ where: { id: { in: [SALE, SALE2] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP2] } } });
  await db.course.deleteMany({ where: { id: KH } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function hocVien(i: number, leadId: string | null = null) {
  await db.student.create({
    data: { id: HV[i]!, name: `HV ${i}`, studentCode: `${HV[i]}-ma`, centerId: CS, parentName: "PH", parentPhone: "0905000111", leadId },
  });
}
async function ghiDanh(i: number, studentIdx: number, saleId: string | null = null, lop = LOP) {
  await db.enrollment.create({ data: { id: GD[i]!, studentId: HV[studentIdx]!, classId: lop, courseId: KH, centerId: CS, status: "STUDYING", saleId } });
}
async function donHang(i: number, leadId: string | null, studentIdx: number, gdIdx: number, leadChildId: string | null) {
  await db.order.create({
    data: {
      id: DON[i]!, code: `ORD-269926-00099${i}`, type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0905000111",
      totalAmount: 1_000_000, centerId: CS, leadId,
    },
  });
  await db.orderItem.create({
    data: {
      id: `${T}it-${i}`, orderId: DON[i]!, studentId: HV[studentIdx]!, enrollmentId: GD[gdIdx]!, type: "COURSE_ENROLLMENT", itemName: "Khoá fixture",
      quantity: 1, unitPrice: 1_000_000, totalPrice: 1_000_000, metadata: { courseId: KH, ...(leadChildId ? { leadChildId } : {}) },
    },
  });
}

/** 6 đơn: D0 bình thường · D1 lead chưa có người chăm · D2 đã có sale + HV đã có lead · D3 con khai KHÔNG thuộc lead · D4+D5 cùng một HV qua HAI lead khác nhau (mơ hồ). */
async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở BSL", slug: `${T}cs`, address: "211 Nguyễn Hữu Thọ" } });
  await db.course.create({ data: { id: KH, name: "Khoá BSL", slug: `${T}khoa` } });
  await db.class.create({ data: { id: LOP, name: "Lớp BSL", courseId: KH, centerId: CS } });
  await db.class.create({ data: { id: LOP2, name: "Lớp BSL 2", courseId: KH, centerId: CS } });
  await db.user.create({ data: { id: SALE, name: "Sale 1", email: "bsl-sale1@example.test", role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS } });
  await db.user.create({ data: { id: SALE2, name: "Sale 2", email: "bsl-sale2@example.test", role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS } });
  await db.lead.create({ data: { id: L1, parentName: "PH 1", phone: "0905111001", centerId: CS, assignedToId: SALE } });
  await db.lead.create({ data: { id: L2, parentName: "PH 2", phone: "0905111002", centerId: CS, assignedToId: null } });
  await db.lead.create({ data: { id: L3, parentName: "PH 3", phone: "0905111003", centerId: CS, assignedToId: SALE2 } });
  await db.leadChild.create({ data: { id: C1, leadId: L1, fullName: "Bé 1" } });
  await db.leadChild.create({ data: { id: C3, leadId: L3, fullName: "Bé 3" } });
  for (const i of [0, 1, 3, 4]) await hocVien(i);
  await hocVien(2, L1); // đã có lead
  await ghiDanh(0, 0); await donHang(0, L1, 0, 0, C1);
  await ghiDanh(1, 1); await donHang(1, L2, 1, 1, null);
  await ghiDanh(2, 2, SALE); await donHang(2, L3, 2, 2, C3);
  await ghiDanh(3, 3); await donHang(3, L1, 3, 3, C3); // C3 thuộc L3, không thuộc L1
  await ghiDanh(4, 4); await donHang(4, L1, 4, 4, null);
  await ghiDanh(5, 4, null, LOP2); await donHang(5, L3, 4, 5, null); // cùng HV[4] qua L1 và L3
}

const sale = async () => Object.fromEntries((await db.enrollment.findMany({ where: { id: { in: GD } }, select: { id: true, saleId: true } })).map((g) => [g.id, g.saleId]));
const hv = async () =>
  Object.fromEntries((await db.student.findMany({ where: { id: { in: HV } }, select: { id: true, leadId: true, leadChildId: true } })).map((s) => [s.id, [s.leadId, s.leadChildId]]));

describe.skipIf(!RUN_DB_TESTS)("[BSL-00..] bổ sung sale/lead cho đơn cũ — Postgres thật", () => {
  afterAll(don);

  it("[BSL-01] DRY-RUN: báo đúng số ứng viên / bỏ qua và KHÔNG ghi gì", async () => {
    await dung();
    const b = await boSungSaleLeadDonCu(DB, { commit: false, donIds: DON });
    expect(b.dongXet).toBe(6);
    expect(b.sale).toMatchObject({ ungVien: 4, daCoSale: 1, leadChuaCoNguoiCham: 1, daGhi: 0 }); // GD0, GD3, GD4, GD5 · GD2 · GD1
    expect(b.hocVien).toMatchObject({ ungVien: 3, noiDuocCon: 1, daCoLead: 1, moHo: 1, daGhi: 0 }); // HV0, HV1, HV3 · HV2 · HV4
    expect(Object.values(await sale()).every((x) => x === null || x === SALE)).toBe(true);
    expect((await sale())[GD[0]!]).toBeNull();
    expect((await hv())[HV[0]!]).toEqual([null, null]);
  });

  it("[BSL-02] COMMIT: sale = người chăm LEAD, học viên nối về lead (+ con khi thuộc đúng lead); Enrollment.leadChildId KHÔNG ghi", async () => {
    await dung();
    const b = await boSungSaleLeadDonCu(DB, { commit: true, donIds: DON });
    expect(b.sale.daGhi).toBe(4);
    expect(b.hocVien.daGhi).toBe(3);
    const s = await sale();
    expect([s[GD[0]!], s[GD[3]!], s[GD[4]!], s[GD[5]!]]).toEqual([SALE, SALE, SALE, SALE2]);
    const h = await hv();
    expect(h[HV[0]!]).toEqual([L1, C1]); // con khai thuộc đúng L1 ⇒ nối cả con
    expect(h[HV[1]!]).toEqual([L2, null]); // lead chưa có người chăm vẫn nối học viên về lead
    expect(h[HV[3]!]).toEqual([L1, null]); // con khai thuộc lead KHÁC ⇒ chỉ nối lead, không nối con
    expect(await db.enrollment.count({ where: { id: { in: GD }, leadChildId: { not: null } } })).toBe(0);
  });

  it("[BSL-03] KHÔNG ĐÈ: ghi danh đã có sale giữ nguyên; lead chưa có người chăm ⇒ saleId trống; học viên đã có lead giữ nguyên; HV qua hai lead khác nhau ⇒ bỏ qua", async () => {
    await dung();
    await boSungSaleLeadDonCu(DB, { commit: true, donIds: DON });
    const s = await sale();
    expect(s[GD[2]!]).toBe(SALE); // đã có SALE, lead là L3 (SALE2) ⇒ không đè
    expect(s[GD[1]!]).toBeNull(); // L2 chưa có người chăm ⇒ KHÔNG rơi về ai
    const h = await hv();
    expect(h[HV[2]!]).toEqual([L1, null]); // đã có lead L1, đơn nói L3 ⇒ giữ
    expect(h[HV[4]!]).toEqual([null, null]); // mơ hồ
  });

  it("[BSL-04] chạy lại lần hai: không ghi thêm gì (idempotent)", async () => {
    await dung();
    await boSungSaleLeadDonCu(DB, { commit: true, donIds: DON });
    const lai = await boSungSaleLeadDonCu(DB, { commit: true, donIds: DON });
    expect(lai.sale).toMatchObject({ ungVien: 0, daGhi: 0 });
    expect(lai.hocVien).toMatchObject({ ungVien: 0, daGhi: 0 });
  });
});
