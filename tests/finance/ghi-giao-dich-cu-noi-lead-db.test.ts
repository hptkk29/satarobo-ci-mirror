// tests/finance/ghi-giao-dich-cu-noi-lead-db.test.ts — [GDCL-*] đường O2 (nhập giao dịch cũ) NỐI `Order.leadId` trên Postgres THẬT (PR0b, doc 03 §5.4).
// Chạy: pnpm test:finance-db (hoặc `vitest run -c vitest.db.config.ts <tệp này>`). `pnpm test:unit` trần SKIP. Fixture tiền tố `GDCL_`; không resetDb; dữ liệu tổng hợp.
// Chạm `lib/finance/**` ⇒ luật R7: chạy thêm hai shard R7 (CLAUDE.md «Luật R7»).
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { ghiGiaoDichCuChoHocVienInTx } from "@/lib/finance/ghi-giao-dich-cu";
import type { GiaoDichSheet } from "@/lib/finance/nhap-giao-dich-sheet";

if (!RUN_DB_TESTS) console.warn(`[GDCL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const db = new PrismaClient();
const P = "GDCL_";
const CS = `${P}cs`;
const ACTOR = { id: null, name: "GDCL" } as const;
const SDT = "0977000123";

async function don() {
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: P } } });
  const orders = await db.order.findMany({ where: { OR: [{ studentId: { startsWith: P } }, { id: { startsWith: P } }] }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  if (ids.length) {
    await db.payment.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await db.order.deleteMany({ where: { id: { in: ids } } });
  }
  await db.student.deleteMany({ where: { id: { startsWith: P } } });
  await db.lead.deleteMany({ where: { id: { startsWith: P } } });
  await db.center.deleteMany({ where: { id: { in: [CS, `${CS}2`] } } }); // CS2 chỉ có ở [GDCL-03] — dọn ở ĐÂY để ca đỏ giữa chừng không để rác làm đỏ ca sau (luật 18)
}

async function lead(key: string, phone: string, o: { deletedAt?: Date; convertedAt?: Date | null } = {}) {
  await db.lead.create({ data: { id: `${P}l-${key}`, parentName: `PH ${key}`, phone, status: "DA_DANG_KY", centerId: CS, deletedAt: o.deletedAt ?? null, convertedAt: o.convertedAt === undefined ? new Date() : o.convertedAt } });
}
async function hocVien(key: string, o: { leadId?: string | null; parentPhone?: string | null } = {}) {
  await db.student.create({ data: { id: `${P}hv-${key}`, name: `Bé ${key}`, centerId: CS, leadId: o.leadId ?? null, parentPhone: o.parentPhone ?? null, parentName: `PH ${key}` } });
  return `${P}hv-${key}`;
}
let dong = 0;
const gd = (): GiaoDichSheet[] => [
  { sheet: `GDCL-T${++dong}`, dong: 1, maHV: null, hoTen: null, sdt: null, hocPhi: 1_000_000, ngay: new Date("2026-05-02T00:00:00Z"), khoa: "Sata 1", coSo: null, tinhTrang: "", ghiChu: "", sale: null },
];
const ghi = (hv: string, g = gd()) => db.$transaction((tx) => ghiGiaoDichCuChoHocVienInTx(tx, { actor: ACTOR, hocVienId: hv, giaoDich: g, saleUserId: null }));
const orderOf = async (r: Awaited<ReturnType<typeof ghi>>) => {
  if ("loi" in r) throw new Error(r.loi);
  return db.order.findUniqueOrThrow({ where: { id: r.orderId! }, select: { leadId: true } });
};

describe.skipIf(!RUN_DB_TESTS)("[GDCL] nhập giao dịch cũ nối Order.leadId (Postgres thật)", () => {
  beforeEach(async () => {
    await don();
    dong = 0;
    await db.center.create({ data: { id: CS, name: "CS GDCL", slug: `${P}cs`, address: "x" } });
  });
  afterAll(async () => {
    await don();
    await db.$disconnect();
  });

  it("[GDCL-01] học viên có Student.leadId còn sống ⇒ đơn mang leadId đó; audit ghi nguồn nối", async () => {
    await lead("a", SDT);
    const hv = await hocVien("a", { leadId: `${P}l-a`, parentPhone: "0900000009" });
    const r = await ghi(hv);
    expect(r).toMatchObject({ leadNoi: "MOT" });
    expect((await orderOf(r)).leadId).toBe(`${P}l-a`);
    const au = await db.auditLog.findFirstOrThrow({ where: { action: "CREATE", entityId: (r as { orderId: string }).orderId } });
    expect(au.newValues).toMatchObject({ leadNoi: "MOT", leadId: `${P}l-a` });
  });

  it("[GDCL-02] CA LỖI HIGH CỦA REVIEW ĐỘC LẬP: học viên KHÔNG có Student.leadId mà SĐT phụ huynh khớp đúng MỘT lead (bé khác của cùng phụ huynh) ⇒ KHÔNG nối theo SĐT: leadId null, leadNoi KHONG", async () => {
    await lead("b", "84977000123");
    const hv = await hocVien("b", { parentPhone: SDT });
    const r = await ghi(hv);
    expect(r).toMatchObject({ leadNoi: "KHONG" });
    expect((await orderOf(r)).leadId).toBeNull();
  });

  it("[GDCL-03] CÁCH LY CƠ SỞ: Student.leadId trỏ lead của cơ sở KHÁC ⇒ KHÔNG nối (không chảy hoa hồng sang cơ sở khác)", async () => {
    await db.center.create({ data: { id: `${CS}2`, name: "CS GDCL 2", slug: `${P}cs2`, address: "y" } });
    await db.lead.create({ data: { id: `${P}l-c`, parentName: "PH c", phone: SDT, status: "DA_DANG_KY", centerId: `${CS}2`, convertedAt: new Date() } });
    const hv = await hocVien("c", { leadId: `${P}l-c` });
    const r = await ghi(hv);
    expect(r).toMatchObject({ leadNoi: "KHONG" });
    expect((await orderOf(r)).leadId).toBeNull();
    await db.lead.deleteMany({ where: { id: `${P}l-c` } });
    await db.center.deleteMany({ where: { id: `${CS}2` } });
  });

  it("[GDCL-04] Student.leadId trỏ lead ĐÃ XOÁ ⇒ KHONG: leadId null, đơn vẫn tạo", async () => {
    await lead("d", SDT, { deletedAt: new Date() });
    const hv = await hocVien("d", { leadId: `${P}l-d`, parentPhone: SDT });
    const r = await ghi(hv);
    expect(r).toMatchObject({ leadNoi: "KHONG" });
    expect((await orderOf(r)).leadId).toBeNull();
  });

  it("[GDCL-05] Student.leadId đã xoá VÀ SĐT khớp một lead sống khác ⇒ vẫn KHONG (không lùi về SĐT)", async () => {
    await lead("e-cu", "0900000011", { deletedAt: new Date() });
    await lead("e", SDT);
    const hv = await hocVien("e", { leadId: `${P}l-e-cu`, parentPhone: SDT });
    const r = await ghi(hv);
    expect(r).toMatchObject({ leadNoi: "KHONG" });
    expect((await orderOf(r)).leadId).toBeNull();
  });
  it("[GDCL-06] chạy lại cùng dòng sheet ⇒ không đơn mới, leadNoi null", async () => {
    await lead("f", SDT);
    const hv = await hocVien("f", { leadId: `${P}l-f` });
    const g = gd();
    await ghi(hv, g);
    const lan2 = await ghi(hv, g);
    expect(lan2).toMatchObject({ daGhi: 0, orderId: null, leadNoi: null });
  });

  it("[GDCL-07] Student.leadId trỏ lead CHƯA convert ⇒ KHONG (convert sau đó sẽ gom khoản của học viên này về ghi danh của bé khác); đối chứng dương: ca đầu tiên của bộ này (lead đã convert ⇒ nối)", async () => {
    await lead("g", SDT, { convertedAt: null });
    const hv = await hocVien("g", { leadId: `${P}l-g` });
    const r = await ghi(hv);
    expect(r).toMatchObject({ leadNoi: "KHONG" });
    expect((await orderOf(r)).leadId).toBeNull();
  });
});