// tests/finance/de-xuat-doi-chuong-trinh.test.ts — ĐỀ XUẤT ĐỔI CHƯƠNG TRÌNH GIẢM + QLCS DUYỆT, trên POSTGRES THẬT. `[DXC-DB-*]`.
//
// Chạy:  pnpm test:finance-db      (vitest.db.config.ts — nơi DUY NHẤT bật ALLOW_DB_RESET)
// Hoặc:  DATABASE_URL=…/satarobo_test_dxc DIRECT_URL=$DATABASE_URL pnpm exec vitest run -c vitest.db.config.ts tests/finance/de-xuat-doi-chuong-trinh.test.ts
//
// KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id. Mỗi ca tự dựng đơn của mình (chạy MỘT MÌNH vẫn xanh — luật 18).
// Đồng hồ truyền vào (luật 19): `NOW` tuyệt đối. Người dùng giả = `Actor` dựng tay (quyền là DỮ LIỆU của actor, không cần seed vai).
// Dịch vụ KHÔNG ĐƯỢC ghi Order / OrderItem / Payment — mọi ca ghi nhận chụp ba bảng đó trước/sau.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "@/lib/settings/service";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { goiYChuongTrinh, type NguCanhGoiY, type UngVienGiam } from "@/lib/pricing/goi-y-chuong-trinh";
import { coDeXuatDoiChuongTrinhDangCho } from "@/lib/orders/de-xuat-dang-cho";
import { taoQrSessionDuoiKhoa } from "@/lib/finance/tao-qr-session";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import {
  guiDeXuat,
  quyetDinhDeXuat,
  type GoiYDaTinh,
  type KetQuaDichVu,
  type TinhGoiY,
} from "@/lib/pricing/de-xuat-doi-chuong-trinh-db";

if (!RUN_DB_TESTS) console.warn(`[DXC-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

import { vi } from "vitest";
vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const T = "fx-dxc-";
const NOW = new Date("2026-10-12T03:00:00Z");
const TIEN = 5_016_000;
const LY_DO = "Khách có giấy xác nhận học bổng riêng";

let CS1 = "";
let CS2 = "";
let OU1 = "";
let OU2 = "";
let dem = 0;

// ── Gợi ý giả lập (máy chủ tính; ở đây là bộ tính cố định có thể bị đổi giữa chừng) ───────────────────────────────────────
const ct = (id: string, nhom: UngVienGiam["nhom"], phanTram: number, dk: Partial<UngVienGiam["dieuKien"]> = {}, phienBan = "v1"): UngVienGiam => ({
  id,
  ma: id.toUpperCase(),
  maVanBan: "SR.QD.233",
  ten: `Chương trình ${id}`,
  nhom,
  phanTram,
  dieuKien: { soBuoi: [], thuTuCon: null, thuTuSanPham48: null, ...dk },
  phienBan,
});
const CTX: NguCanhGoiY = { soBuoi: 24, thuTuCon: 2, thuTuSanPham48: null, niemYet: 5_280_000 };
const bo = { phienBanBangA: "v1", thuTuCon: 2, choPhepThem: ["khac1"] as string[], dongDuocHoi: [] as string[] };
function tinhGoiYCoDinh(): TinhGoiY {
  return async (_tx, orderItemId): Promise<GoiYDaTinh> => {
    bo.dongDuocHoi.push(orderItemId);
    const ctx = { ...CTX, thuTuCon: bo.thuTuCon };
    return {
      goiY: goiYChuongTrinh(ctx, [ct("banga24", "BASE", 5, { soBuoi: [24] }, bo.phienBanBangA), ct("anhem2", "ADD_ON", 10, { thuTuCon: { tu: 2, den: 2 } })], 25),
      ctx,
      choPhepThem: new Set(bo.choPhepThem),
      canCu: null,
    };
  };
}

// ── Fixture đơn ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function dungDon(id: string, itemId: string, o: { centerId?: string; status?: "DRAFT" | "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" } = {}) {
  await db.order.create({
    data: {
      id,
      code: `ORD-2699-DX-${++dem}-${id.slice(-6)}`,
      type: "COURSE",
      status: o.status ?? "PENDING_PAYMENT",
      customerName: `${T}khach`,
      customerPhone: "0905123456",
      totalAmount: TIEN,
      subtotal: TIEN,
      centerId: o.centerId ?? CS1,
    },
  });
  await db.orderItem.create({
    data: { id: itemId, orderId: id, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: TIEN, totalPrice: TIEN, discountAmount: 0, status: "ACTIVE" },
  });
}

async function datCo(orgUnitId: string, bat: boolean | null) {
  if (bat === null) await db.centerSetting.deleteMany({ where: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } });
  else {
    await db.centerSetting.upsert({
      where: { orgUnitId_key: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI } },
      create: { orgUnitId, key: KHOA_CONG_TAC_PHAM_VI, valueJson: bat },
      update: { valueJson: bat },
    });
  }
  clearSettingsCache();
}

async function donDep() {
  const ids = (await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Order" WHERE "id" LIKE ${`${T}%`}`).map((d) => d.id);
  await db.discountProgramChangeRequest.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.qrSession.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
  await db.paymentBillLine.deleteMany({ where: { bill: { orderId: { in: ids } } } });
  await db.paymentBill.deleteMany({ where: { orderId: { in: ids } } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { startsWith: T } }, { entityType: "Order", entityId: { in: ids } }] } });
  await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
  await db.$executeRaw`DELETE FROM "Order" WHERE "id" = ANY(${ids})`;
}

function actorLit(o: { id: string; superAdmin?: boolean; perms?: readonly string[]; centerIds?: readonly string[]; orgUnitIds?: readonly string[] }): Actor {
  const centers = [...(o.centerIds ?? [CS1])];
  const ous = [...(o.orgUnitIds ?? [OU1])];
  return {
    userId: o.id,
    isSuperAdmin: o.superAdmin ?? false,
    isHoLevel: false,
    orgRoles: [],
    permissions: (o.perms ?? []).map((action) => ({ action, scopeType: "CENTER" as const, orgUnitId: ous[0] ?? OU1, roleCode: "TEST_ROLE", centerScope: centers, orgUnitScope: ous })),
    visibleCenterIds: centers,
    visibleOrgUnitIds: ous,
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  };
}
const NGUOI = (id: string) => ({ id, name: `Người ${id}` });
const SALE = () => actorLit({ id: `${T}sale`, perms: ["orders:create"] });
const SALE_KHAC = () => actorLit({ id: `${T}sale2`, perms: ["orders:create"] });
const SALE_CS2 = () => actorLit({ id: `${T}sale-cs2`, perms: ["orders:create"], centerIds: [CS2], orgUnitIds: [OU2] });
const QL = () => actorLit({ id: `${T}ql`, perms: ["discounts:approve", "installments:approve"] });
const QL_CS2 = () => actorLit({ id: `${T}ql2`, perms: ["discounts:approve", "installments:approve"], centerIds: [CS2], orgUnitIds: [OU2] });
const XEM = () => actorLit({ id: `${T}xem`, perms: ["orders:view"] });
const VUA_BAN_VUA_DUYET = () => actorLit({ id: `${T}ca-hai`, perms: ["orders:create", "discounts:approve"] });

const guiBoBot = (actor: Actor, itemId: string, tinh: TinhGoiY = tinhGoiYCoDinh(), lyDo = LY_DO) =>
  guiDeXuat({ actor, nguoi: NGUOI(actor.userId), orderItemId: itemId, themVao: [], boBot: ["anhem2"], lyDo, tinhGoiY: tinh, now: NOW });
const quyet = (actor: Actor, deXuatId: string, hanhDong: "DUYET" | "TU_CHOI" | "HUY", lyDo: string | null = null, tinh: TinhGoiY | undefined = tinhGoiYCoDinh()) =>
  quyetDinhDeXuat({ actor, nguoi: NGUOI(actor.userId), deXuatId, hanhDong, lyDo, tinhGoiY: tinh, now: NOW });

const phaiOk = (r: KetQuaDichVu): Extract<KetQuaDichVu, { ok: true }> => {
  if (!r.ok) throw new Error(`mong ok, nhận lỗi ${r.ma}: ${r.error}`);
  return r;
};
const phaiLoi = (r: KetQuaDichVu, ma: string): void => {
  expect({ ok: r.ok, ma: r.ok ? null : r.ma }).toEqual({ ok: false, ma });
};
const nhatKy = (orderId: string) =>
  db.auditLog.findMany({ where: { entityType: "Order", entityId: orderId, action: { startsWith: "DISCOUNT_PROGRAM_CHANGE_" } }, orderBy: { createdAt: "asc" } });
const hang = (orderItemId: string) => db.discountProgramChangeRequest.findMany({ where: { orderItemId }, orderBy: { createdAt: "asc" } });

/** Ảnh chụp bảng TIỀN — dịch vụ này không được đổi một byte nào. */
async function chupTien(orderId: string): Promise<string> {
  return JSON.stringify({
    order: await db.order.findMany({ where: { id: orderId } }),
    item: await db.orderItem.findMany({ where: { orderId }, orderBy: { id: "asc" } }),
    payment: await db.payment.findMany({ where: { orderId } }),
  });
}

describe.skipIf(!RUN_DB_TESTS)("[DXC-DB] đề xuất đổi chương trình giảm + QLCS duyệt — Postgres THẬT", () => {
  beforeAll(async () => {
    assertTestDb();
    await donDep();
    await seedOrg(["HO", "CS1", "CS2"]);
    CS1 = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    CS2 = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    OU1 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    OU2 = (await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
  });
  beforeEach(async () => {
    await donDep();
    await datCo(OU1, true);
    await datCo(OU2, null);
    bo.phienBanBangA = "v1";
    bo.thuTuCon = 2;
    bo.choPhepThem = ["khac1"];
    bo.dongDuocHoi = [];
  });
  afterAll(async () => {
    await donDep();
    await datCo(OU1, null);
    await datCo(OU2, null);
  });

  it("[DXC-DB-01] Sale đề xuất BỎ một gợi ý ⇒ một dòng PENDING đủ căn cứ + nhật ký lên ĐƠN; KHÔNG đổi Order / OrderItem / Payment", async () => {
    await dungDon(`${T}o1`, `${T}i1`);
    const truoc = await chupTien(`${T}o1`);
    const kq = phaiOk(await guiBoBot(SALE(), `${T}i1`));
    expect(kq).toMatchObject({ daLam: true, trangThai: "PENDING" });

    const dong = await hang(`${T}i1`);
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({
      status: "PENDING",
      orderId: `${T}o1`,
      centerId: CS1,
      orgUnitId: OU1,
      addVoucherIds: [],
      removeVoucherIds: ["anhem2"],
      reason: LY_DO,
      proposedById: `${T}sale`,
      decidedById: null,
      decidedAt: null,
    });
    expect(dong[0]!.suggestionFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(dong[0]!.suggestionSnapshot)).toContain("banga24");

    const log = await nhatKy(`${T}o1`);
    expect(log.map((l) => [l.action, l.actorId, l.reason])).toEqual([["DISCOUNT_PROGRAM_CHANGE_PROPOSED", `${T}sale`, LY_DO]]);
    expect(await chupTien(`${T}o1`), "dịch vụ không được đụng bảng tiền").toBe(truoc);
  });

  it("[DXC-DB-02] cờ phạm vi của cơ sở TẮT (hoặc chưa đặt) ⇒ PHAM_VI_TAT, KHÔNG ghi gì (kể cả nhật ký)", async () => {
    await dungDon(`${T}o2`, `${T}i2`);
    for (const bat of [false, null] as const) {
      await datCo(OU1, bat);
      phaiLoi(await guiBoBot(SALE(), `${T}i2`), "PHAM_VI_TAT");
    }
    expect(await hang(`${T}i2`)).toHaveLength(0);
    expect(await nhatKy(`${T}o2`)).toHaveLength(0);
  });

  it("[DXC-DB-03] lý do ngắn / đề xuất rỗng / mã lạ ⇒ từ chối, không ghi (cổng đứng trước phép ghi đầu tiên)", async () => {
    await dungDon(`${T}o3`, `${T}i3`);
    phaiLoi(await guiBoBot(SALE(), `${T}i3`, tinhGoiYCoDinh(), "ngắn"), "LY_DO_NGAN");
    phaiLoi(await guiDeXuat({ actor: SALE(), nguoi: NGUOI(`${T}sale`), orderItemId: `${T}i3`, themVao: [], boBot: [], lyDo: LY_DO, tinhGoiY: tinhGoiYCoDinh(), now: NOW }), "DE_XUAT_RONG");
    phaiLoi(await guiDeXuat({ actor: SALE(), nguoi: NGUOI(`${T}sale`), orderItemId: `${T}i3`, themVao: ["la-hoac"], boBot: [], lyDo: LY_DO, tinhGoiY: tinhGoiYCoDinh(), now: NOW }), "THEM_MA_KHONG_DUNG_DUOC");
    phaiLoi(await guiDeXuat({ actor: SALE(), nguoi: NGUOI(`${T}sale`), orderItemId: `${T}i3`, themVao: [], boBot: ["khong-duoc-goi-y"], lyDo: LY_DO, tinhGoiY: tinhGoiYCoDinh(), now: NOW }), "BO_MA_KHONG_CO_TRONG_GOI_Y");
    expect(await hang(`${T}i3`)).toHaveLength(0);
    expect(await nhatKy(`${T}o3`)).toHaveLength(0);
  });

  it("[DXC-DB-04] Sale THÊM một mã ngoài gợi ý (mã dùng được) ⇒ ghi nhận; mã lưu đúng", async () => {
    await dungDon(`${T}o4`, `${T}i4`);
    phaiOk(await guiDeXuat({ actor: SALE(), nguoi: NGUOI(`${T}sale`), orderItemId: `${T}i4`, themVao: ["khac1"], boBot: [], lyDo: LY_DO, tinhGoiY: tinhGoiYCoDinh(), now: NOW }));
    expect((await hang(`${T}i4`)).map((d) => [d.addVoucherIds, d.removeVoucherIds])).toEqual([[["khac1"], []]]);
  });

  it("[DXC-DB-05] cách ly cơ sở khi ĐỀ XUẤT: Sale CS2 với đơn CS1 ⇒ 'không tìm thấy' (không lộ đơn tồn tại); thiếu quyền tạo đơn ⇒ KHONG_QUYEN", async () => {
    await dungDon(`${T}o5`, `${T}i5`);
    phaiLoi(await guiBoBot(SALE_CS2(), `${T}i5`), "KHONG_TIM_THAY");
    phaiLoi(await guiBoBot(XEM(), `${T}i5`), "KHONG_QUYEN");
    phaiLoi(await guiBoBot(SALE(), `${T}khong-co-dong`), "KHONG_TIM_THAY");
    expect(await hang(`${T}i5`)).toHaveLength(0);
    expect(await nhatKy(`${T}o5`)).toHaveLength(0);
  });

  it("[DXC-DB-06] đơn đã chốt (CONFIRMED / CANCELLED) ⇒ DON_KHONG_CON_SUA_DUOC", async () => {
    await dungDon(`${T}o6`, `${T}i6`, { status: "CONFIRMED" });
    phaiLoi(await guiBoBot(SALE(), `${T}i6`), "DON_KHONG_CON_SUA_DUOC");
    await dungDon(`${T}o6b`, `${T}i6b`, { status: "CANCELLED" });
    phaiLoi(await guiBoBot(SALE(), `${T}i6b`), "DON_KHONG_CON_SUA_DUOC");
    expect(await hang(`${T}i6`)).toHaveLength(0);
  });

  it("[DXC-DB-07] hai đề xuất cho CÙNG dòng: lần hai ⇒ DA_CO_DE_XUAT_CHO; bấm ĐỒNG THỜI hai lần ⇒ đúng MỘT dòng, đúng MỘT nhật ký", async () => {
    await dungDon(`${T}o7`, `${T}i7`);
    phaiOk(await guiBoBot(SALE(), `${T}i7`));
    phaiLoi(await guiBoBot(SALE_KHAC(), `${T}i7`), "DA_CO_DE_XUAT_CHO");

    await dungDon(`${T}o7b`, `${T}i7b`);
    const kq = await Promise.all([guiBoBot(SALE(), `${T}i7b`), guiBoBot(SALE_KHAC(), `${T}i7b`), guiBoBot(SALE(), `${T}i7b`)]);
    expect(kq.filter((r) => r.ok), "đúng một lượt thắng").toHaveLength(1);
    expect(kq.filter((r) => !r.ok).every((r) => !r.ok && r.ma === "DA_CO_DE_XUAT_CHO")).toBe(true);
    expect(await hang(`${T}i7b`)).toHaveLength(1);
    expect(await nhatKy(`${T}o7b`)).toHaveLength(1);
  });

  it("[DXC-DB-10] QLCS đúng cơ sở DUYỆT ⇒ APPROVED; nhật ký có người đề xuất · người duyệt · lý do đề xuất · không tự duyệt; bảng tiền KHÔNG đổi", async () => {
    await dungDon(`${T}o10`, `${T}i10`);
    const { deXuatId } = phaiOk(await guiBoBot(SALE(), `${T}i10`));
    const truoc = await chupTien(`${T}o10`);
    const kq = phaiOk(await quyet(QL(), deXuatId, "DUYET", "Đã đối chiếu giấy xác nhận"));
    expect(kq).toMatchObject({ daLam: true, trangThai: "APPROVED" });

    const [dong] = await hang(`${T}i10`);
    expect(dong).toMatchObject({ status: "APPROVED", decidedById: `${T}ql`, decisionReason: "Đã đối chiếu giấy xác nhận" });
    expect(dong!.decidedAt).toEqual(NOW);
    const log = (await nhatKy(`${T}o10`)).filter((l) => l.action === "DISCOUNT_PROGRAM_CHANGE_APPROVED");
    expect(log).toHaveLength(1);
    expect(log[0]!.actorId).toBe(`${T}ql`);
    expect(log[0]!.newValues).toMatchObject({ nguoiDeXuat: `${T}sale`, nguoiQuyet: `${T}ql`, tuQuyet: false, trangThai: "APPROVED", lyDoDeXuat: LY_DO, boBot: ["anhem2"] });
    expect(await chupTien(`${T}o10`), "duyệt chỉ đổi trạng thái đề xuất — áp vào dòng đơn là bước nối riêng").toBe(truoc);
  });

  it("[DXC-DB-11] sai cơ sở / thiếu quyền duyệt ⇒ KHÔNG đổi gì: QLCS CS2 ⇒ 'không tìm thấy'; Sale (không quyền duyệt) ⇒ KHONG_QUYEN; đề xuất vẫn PENDING, không nhật ký quyết định", async () => {
    await dungDon(`${T}o11`, `${T}i11`);
    const { deXuatId } = phaiOk(await guiBoBot(SALE(), `${T}i11`));
    phaiLoi(await quyet(QL_CS2(), deXuatId, "DUYET"), "KHONG_TIM_THAY");
    phaiLoi(await quyet(QL_CS2(), deXuatId, "TU_CHOI", "Từ chối thử từ cơ sở khác"), "KHONG_TIM_THAY");
    phaiLoi(await quyet(SALE_KHAC(), deXuatId, "DUYET"), "KHONG_QUYEN");
    phaiLoi(await quyet(XEM(), deXuatId, "TU_CHOI", "Từ chối thử không có quyền"), "KHONG_QUYEN");
    expect((await hang(`${T}i11`)).map((d) => d.status)).toEqual(["PENDING"]);
    expect((await nhatKy(`${T}o11`)).map((l) => l.action)).toEqual(["DISCOUNT_PROGRAM_CHANGE_PROPOSED"]);
  });

  it("[DXC-DB-12] cờ TẮT sau khi đã đề xuất ⇒ không duyệt được (PHAM_VI_TAT)", async () => {
    await dungDon(`${T}o12`, `${T}i12`);
    const { deXuatId } = phaiOk(await guiBoBot(SALE(), `${T}i12`));
    await datCo(OU1, false);
    phaiLoi(await quyet(QL(), deXuatId, "DUYET"), "PHAM_VI_TAT");
    expect((await hang(`${T}i12`))[0]!.status).toBe("PENDING");
  });

  it("[DXC-DB-13] thao tác LẶP: duyệt lần hai ⇒ ok nhưng daLam=false, KHÔNG thêm nhật ký, không đổi decidedAt; từ chối sau khi đã duyệt cũng không đổi", async () => {
    await dungDon(`${T}o13`, `${T}i13`);
    const { deXuatId } = phaiOk(await guiBoBot(SALE(), `${T}i13`));
    phaiOk(await quyet(QL(), deXuatId, "DUYET"));
    const sau1 = await hang(`${T}i13`);
    const lan2 = phaiOk(await quyet(QL(), deXuatId, "DUYET"));
    expect(lan2).toMatchObject({ daLam: false, trangThai: "APPROVED" });
    const luaTuChoi = phaiOk(await quyet(QL(), deXuatId, "TU_CHOI", "Từ chối sau khi đã duyệt thì vô nghĩa"));
    expect(luaTuChoi).toMatchObject({ daLam: false, trangThai: "APPROVED" });
    expect(await hang(`${T}i13`)).toEqual(sau1);
    expect((await nhatKy(`${T}o13`)).map((l) => l.action)).toEqual(["DISCOUNT_PROGRAM_CHANGE_PROPOSED", "DISCOUNT_PROGRAM_CHANGE_APPROVED"]);
  });

  it("[DXC-DB-14] ĐỒNG THỜI duyệt ‖ từ chối cùng một đề xuất: đúng MỘT bên thắng, trạng thái khớp bên thắng, đúng MỘT nhật ký quyết định (lặp 6 lần)", async () => {
    for (let i = 0; i < 6; i++) {
      await dungDon(`${T}o14-${i}`, `${T}i14-${i}`);
      const { deXuatId } = phaiOk(await guiBoBot(SALE(), `${T}i14-${i}`));
      const [a, b] = await Promise.all([quyet(QL(), deXuatId, "DUYET"), quyet(QL(), deXuatId, "TU_CHOI", "Từ chối đồng thời để thử đua")]);
      const ra = phaiOk(a);
      const rb = phaiOk(b);
      expect([ra.daLam, rb.daLam].filter(Boolean), "đúng một bên làm được").toHaveLength(1);
      const [dong] = await hang(`${T}i14-${i}`);
      const thang = ra.daLam ? ra : rb;
      expect(dong!.status).toBe(thang.trangThai);
      const quyetLog = (await nhatKy(`${T}o14-${i}`)).filter((l) => l.action !== "DISCOUNT_PROGRAM_CHANGE_PROPOSED");
      expect(quyetLog).toHaveLength(1);
    }
  });

  it("[DXC-DB-15] gợi ý ĐÃ ĐỔI giữa lúc đề xuất và lúc duyệt (văn bản đổi phiên bản, hoặc thứ hạng con đổi) ⇒ GOI_Y_DA_DOI, vẫn PENDING; vẫn TỪ CHỐI được để gỡ khỏi hàng chờ", async () => {
    await dungDon(`${T}o15`, `${T}i15`);
    const { deXuatId } = phaiOk(await guiBoBot(SALE(), `${T}i15`));

    bo.phienBanBangA = "v2";
    phaiLoi(await quyet(QL(), deXuatId, "DUYET"), "GOI_Y_DA_DOI");
    bo.phienBanBangA = "v1";
    bo.thuTuCon = 3;
    phaiLoi(await quyet(QL(), deXuatId, "DUYET"), "GOI_Y_DA_DOI");
    expect((await hang(`${T}i15`))[0]!.status).toBe("PENDING");

    phaiOk(await quyet(QL(), deXuatId, "TU_CHOI", "Gợi ý đã đổi, Sale đề xuất lại"));
    expect((await hang(`${T}i15`))[0]!.status).toBe("REJECTED");
    // gợi ý khớp lại thì duyệt bản gốc được (đối chứng dương cho hai ca trên)
    bo.thuTuCon = 2;
    await dungDon(`${T}o15b`, `${T}i15b`);
    const g = phaiOk(await guiBoBot(SALE(), `${T}i15b`));
    phaiOk(await quyet(QL(), g.deXuatId, "DUYET"));
    expect((await hang(`${T}i15b`))[0]!.status).toBe("APPROVED");
  });

  it("[DXC-DB-16] từ chối cần lý do ≥ 10 ký tự (service) VÀ DB cũng chặn đường ghi thô; lý do lưu đúng", async () => {
    await dungDon(`${T}o16`, `${T}i16`);
    const { deXuatId } = phaiOk(await guiBoBot(SALE(), `${T}i16`));
    phaiLoi(await quyet(QL(), deXuatId, "TU_CHOI", "không"), "LY_DO_NGAN");
    phaiLoi(await quyet(QL(), deXuatId, "TU_CHOI", null), "LY_DO_NGAN");
    expect((await hang(`${T}i16`))[0]!.status).toBe("PENDING");
    phaiOk(await quyet(QL(), deXuatId, "TU_CHOI", "Thiếu giấy tờ chứng minh"));
    expect((await hang(`${T}i16`))[0]).toMatchObject({ status: "REJECTED", decisionReason: "Thiếu giấy tờ chứng minh", decidedById: `${T}ql` });

    // đường ghi thô (bỏ qua service) cũng không lọt các dòng sai
    const chen = (extra: string) =>
      db.$executeRawUnsafe(
        `INSERT INTO "DiscountProgramChangeRequest"("id","orderId","orderItemId","centerId","reason","suggestionFingerprint","suggestionSnapshot","proposedById","proposedAt","updatedAt"${extra.split("|")[0]}) VALUES ('${T}raw-${++dem}','${T}o16','${T}i16-raw','${CS1}','Lý do đủ dài ở đây','fp','{}','u',now(),now()${extra.split("|")[1]})`,
      );
    await expect(chen("|")).rejects.toThrow(); // thiếu cả thêm lẫn bỏ ⇒ CHECK nonempty
    await expect(db.$executeRawUnsafe(`INSERT INTO "DiscountProgramChangeRequest"("id","orderId","orderItemId","centerId","addVoucherIds","reason","suggestionFingerprint","suggestionSnapshot","proposedById","proposedAt","updatedAt") VALUES ('${T}raw-x','${T}o16','${T}i16-raw2','${CS1}',ARRAY['a'],'ngan','fp','{}','u',now(),now())`)).rejects.toThrow(); // lý do ngắn
    await expect(db.$executeRawUnsafe(`INSERT INTO "DiscountProgramChangeRequest"("id","status","orderId","orderItemId","centerId","addVoucherIds","reason","suggestionFingerprint","suggestionSnapshot","proposedById","proposedAt","updatedAt") VALUES ('${T}raw-y','APPROVED','${T}o16','${T}i16-raw3','${CS1}',ARRAY['a'],'Lý do đủ dài ở đây','fp','{}','u',now(),now())`)).rejects.toThrow(); // đã duyệt mà không ai duyệt
  });

  it("[DXC-DB-17] HUỶ: chỉ người đề xuất; sau khi huỷ, dòng được đề xuất lại (chỉ mục từng phần chỉ chặn PENDING); duyệt đề xuất đã huỷ ⇒ không đổi gì", async () => {
    await dungDon(`${T}o17`, `${T}i17`);
    const { deXuatId } = phaiOk(await guiBoBot(SALE(), `${T}i17`));
    phaiLoi(await quyet(SALE_KHAC(), deXuatId, "HUY"), "CHI_NGUOI_DE_XUAT_MOI_HUY_DUOC");
    phaiOk(await quyet(SALE(), deXuatId, "HUY"));
    expect((await hang(`${T}i17`))[0]).toMatchObject({ status: "CANCELLED", decidedById: `${T}sale` });
    const moi = phaiOk(await guiBoBot(SALE(), `${T}i17`));
    expect(moi.deXuatId).not.toBe(deXuatId);
    expect((await hang(`${T}i17`)).map((d) => d.status)).toEqual(["CANCELLED", "PENDING"]);
    expect(phaiOk(await quyet(QL(), deXuatId, "DUYET"))).toMatchObject({ daLam: false, trangThai: "CANCELLED" });
  });

  it("[DXC-DB-18] đơn đã chốt SAU khi đề xuất ⇒ không duyệt được (DON_KHONG_CON_SUA_DUOC); từ chối vẫn được", async () => {
    await dungDon(`${T}o18`, `${T}i18`);
    const { deXuatId } = phaiOk(await guiBoBot(SALE(), `${T}i18`));
    await db.order.update({ where: { id: `${T}o18` }, data: { status: "CONFIRMED" } });
    phaiLoi(await quyet(QL(), deXuatId, "DUYET"), "DON_KHONG_CON_SUA_DUOC");
    expect((await hang(`${T}i18`))[0]!.status).toBe("PENDING");
    phaiOk(await quyet(QL(), deXuatId, "TU_CHOI", "Đơn đã chốt, không áp dụng nữa"));
  });

  it("[DXC-DB-19] người vừa bán vừa duyệt tự duyệt đề xuất của mình: KHÔNG bị chặn (chưa có quy tắc) nhưng nhật ký ghi tuQuyet=true để soát", async () => {
    await dungDon(`${T}o19`, `${T}i19`);
    const ca = VUA_BAN_VUA_DUYET();
    const { deXuatId } = phaiOk(await guiBoBot(ca, `${T}i19`));
    phaiOk(await quyet(ca, deXuatId, "DUYET"));
    const log = (await nhatKy(`${T}o19`)).find((l) => l.action === "DISCOUNT_PROGRAM_CHANGE_APPROVED");
    expect(log!.newValues).toMatchObject({ nguoiDeXuat: `${T}ca-hai`, nguoiQuyet: `${T}ca-hai`, tuQuyet: true });
  });

  it("[DXC-DB-20] cô lập cơ sở khi đọc: bảng được khai trong scopedDb — actor CS2 không đọc được đề xuất của CS1 (qua đường dịch vụ đã kiểm ở DXC-DB-11)", async () => {
    await dungDon(`${T}o20`, `${T}i20`);
    phaiOk(await guiBoBot(SALE(), `${T}i20`));
    const { scopedDb } = await import("@/lib/db-scope");
    expect(await scopedDb(QL_CS2()).discountProgramChangeRequest.findMany({ where: { orderId: `${T}o20` } })).toHaveLength(0);
    expect(await scopedDb(QL()).discountProgramChangeRequest.findMany({ where: { orderId: `${T}o20` } })).toHaveLength(1);
  });

  // ═══ BẤT BIẾN "ĐANG CÓ ĐỀ XUẤT CHỜ ⇒ KHÔNG CÓ MÃ NÀO ĐANG THU TIỀN THEO GIÁ CŨ" ═══════════════════════════════════════
  const HEN_NGAY = new Date(NOW.getTime() + 10 * 60_000);
  const QUA_NGAY = new Date(NOW.getTime() - 10 * 60_000);

  async function dotCua(orderId: string, itemId: string): Promise<string> {
    const r = await db.paymentRequest.create({
      data: { orderId, orderItemId: itemId, centerId: CS1, installmentNo: 1, amountDue: TIEN, status: "PENDING", sortOrder: 1 },
      select: { id: true },
    });
    return r.id;
  }

  it("[DXC-DB-21] đã có phiếu gộp MỞ / QR còn hạn / tiền đã ghi nhận ⇒ DON_DA_PHAT_MA, không ghi gì; ĐỐI CHỨNG DƯƠNG: phiếu đã huỷ, QR hết hạn, khoản bị TỪ CHỐI thì đề xuất được", async () => {
    // (a) phiếu gộp đang mở
    await dungDon(`${T}o21a`, `${T}i21a`);
    await db.paymentBill.create({ data: { orderId: `${T}o21a`, centerId: CS1, amountDue: TIEN, status: "OPEN", matchKey: `${T}mk-21a` } });
    phaiLoi(await guiBoBot(SALE(), `${T}i21a`), "DON_DA_PHAT_MA");
    // (b) QR còn hạn
    await dungDon(`${T}o21b`, `${T}i21b`);
    const dotB = await dotCua(`${T}o21b`, `${T}i21b`);
    await db.qrSession.create({ data: { paymentRequestId: dotB, centerId: CS1, amountShown: TIEN, expiresAt: HEN_NGAY, status: "ACTIVE" } });
    phaiLoi(await guiBoBot(SALE(), `${T}i21b`), "DON_DA_PHAT_MA");
    // (c) tiền đã ghi nhận (kể cả chờ kế toán)
    await dungDon(`${T}o21c`, `${T}i21c`);
    await db.payment.create({ data: { orderId: `${T}o21c`, orderItemId: `${T}i21c`, amount: 1_000_000, method: "cash", paidDate: NOW, saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS1 } });
    phaiLoi(await guiBoBot(SALE(), `${T}i21c`), "DON_DA_PHAT_MA");
    for (const i of ["a", "b", "c"]) expect(await hang(`${T}i21${i}`), i).toHaveLength(0);

    // ĐỐI CHỨNG DƯƠNG — mỗi thứ dưới đây KHÔNG còn sống nên không chặn
    await dungDon(`${T}o21d`, `${T}i21d`);
    await db.paymentBill.create({ data: { orderId: `${T}o21d`, centerId: CS1, amountDue: TIEN, status: "VOID", matchKey: `${T}mk-21d` } });
    const dotD = await dotCua(`${T}o21d`, `${T}i21d`);
    await db.qrSession.create({ data: { paymentRequestId: dotD, centerId: CS1, amountShown: TIEN, expiresAt: QUA_NGAY, status: "ACTIVE" } }); // hết hạn theo giờ
    await db.qrSession.create({ data: { paymentRequestId: dotD, centerId: CS1, amountShown: TIEN, expiresAt: HEN_NGAY, status: "EXPIRED" } }); // đã đóng
    await db.payment.create({ data: { orderId: `${T}o21d`, orderItemId: `${T}i21d`, amount: 1_000_000, method: "cash", paidDate: NOW, saleStatus: "RECORDED", accountantStatus: "REJECTED", centerId: CS1 } });
    phaiOk(await guiBoBot(SALE(), `${T}i21d`));
  });

  it("[DXC-DB-22] helper cổng QR: đúng PENDING mới tính; duyệt/từ chối/huỷ ⇒ hết chặn; đơn khác không bị ảnh hưởng; chạy được cả trong transaction", async () => {
    await dungDon(`${T}o22`, `${T}i22`);
    await dungDon(`${T}o22x`, `${T}i22x`);
    expect(await coDeXuatDoiChuongTrinhDangCho(`${T}o22`)).toBe(false);
    const { deXuatId } = phaiOk(await guiBoBot(SALE(), `${T}i22`));
    expect(await coDeXuatDoiChuongTrinhDangCho(`${T}o22`)).toBe(true);
    expect(await coDeXuatDoiChuongTrinhDangCho(`${T}o22x`), "đơn khác").toBe(false);
    expect(await db.$transaction((tx) => coDeXuatDoiChuongTrinhDangCho(`${T}o22`, tx))).toBe(true);
    phaiOk(await quyet(QL(), deXuatId, "TU_CHOI", "Từ chối để kiểm cổng chặn QR"));
    expect(await coDeXuatDoiChuongTrinhDangCho(`${T}o22`)).toBe(false);
    const g = phaiOk(await guiBoBot(SALE(), `${T}i22`));
    phaiOk(await quyet(SALE(), g.deXuatId, "HUY"));
    expect(await coDeXuatDoiChuongTrinhDangCho(`${T}o22`)).toBe(false);
    const h = phaiOk(await guiBoBot(SALE(), `${T}i22`));
    phaiOk(await quyet(QL(), h.deXuatId, "DUYET"));
    expect(await coDeXuatDoiChuongTrinhDangCho(`${T}o22`)).toBe(false);
  });

  // ═══ RÀ SOÁT ĐỘC LẬP 19/10/2026 — các lỗ tìm ra sau khi viết ═══════════════════════════════════════════════════════
  it("[DXC-DB-23] TẮT cờ khi còn đề xuất PENDING: DUYỆT bị chặn nhưng TỪ CHỐI và HUỶ vẫn chạy (không kẹt vĩnh viễn, cổng QR được gỡ)", async () => {
    await dungDon(`${T}o23`, `${T}i23`);
    const a = phaiOk(await guiBoBot(SALE(), `${T}i23`));
    await datCo(OU1, false);
    phaiLoi(await quyet(QL(), a.deXuatId, "DUYET"), "PHAM_VI_TAT");
    expect(await coDeXuatDoiChuongTrinhDangCho(`${T}o23`)).toBe(true);
    phaiOk(await quyet(QL(), a.deXuatId, "TU_CHOI", "Cờ đã tắt, gỡ đề xuất khỏi hàng chờ"));
    expect(await coDeXuatDoiChuongTrinhDangCho(`${T}o23`)).toBe(false);

    await datCo(OU1, true);
    await dungDon(`${T}o23b`, `${T}i23b`);
    const b = phaiOk(await guiBoBot(SALE(), `${T}i23b`));
    await datCo(OU1, false);
    phaiOk(await quyet(SALE(), b.deXuatId, "HUY"));
    expect((await hang(`${T}i23b`))[0]!.status).toBe("CANCELLED");
  });

  it("[DXC-DB-24] mã được THÊM bị thu hồi / hết dùng được SAU khi đề xuất ⇒ DUYỆT bị chặn (dấu vân tay không băm mã thêm), vẫn PENDING; từ chối được", async () => {
    await dungDon(`${T}o24`, `${T}i24`);
    const a = phaiOk(await guiDeXuat({ actor: SALE(), nguoi: NGUOI(`${T}sale`), orderItemId: `${T}i24`, themVao: ["khac1"], boBot: [], lyDo: LY_DO, tinhGoiY: tinhGoiYCoDinh(), now: NOW }));
    bo.choPhepThem = []; // khac1 hết hiệu lực
    phaiLoi(await quyet(QL(), a.deXuatId, "DUYET"), "THEM_MA_KHONG_DUNG_DUOC");
    expect((await hang(`${T}i24`))[0]!.status).toBe("PENDING");
    bo.choPhepThem = ["khac1"]; // đối chứng dương: còn dùng được thì duyệt được
    phaiOk(await quyet(QL(), a.deXuatId, "DUYET"));
  });

  it("[DXC-DB-25] giữa lúc đề xuất và lúc duyệt có TIỀN / PHIẾU / QR phát sinh (ghi tay tiền mặt không qua cổng QR) ⇒ DUYỆT bị chặn DON_DA_PHAT_MA; từ chối được", async () => {
    await dungDon(`${T}o25`, `${T}i25`);
    const a = phaiOk(await guiBoBot(SALE(), `${T}i25`));
    await db.payment.create({ data: { orderId: `${T}o25`, orderItemId: `${T}i25`, amount: 1_000_000, method: "cash", paidDate: NOW, saleStatus: "RECORDED", accountantStatus: "PENDING", centerId: CS1 } });
    phaiLoi(await quyet(QL(), a.deXuatId, "DUYET"), "DON_DA_PHAT_MA");
    expect((await hang(`${T}i25`))[0]!.status).toBe("PENDING");
    phaiOk(await quyet(QL(), a.deXuatId, "TU_CHOI", "Đã có tiền theo giá cũ, không đổi giá nữa"));
  });

  it("[DXC-DB-26] bộ tính gợi ý nhận orderItemId do DỊCH VỤ lấy từ DB — cả lúc đề xuất lẫn lúc duyệt (không dựa vào closure tự nhớ dòng)", async () => {
    await dungDon(`${T}o26`, `${T}i26`);
    const a = phaiOk(await guiBoBot(SALE(), `${T}i26`));
    phaiOk(await quyet(QL(), a.deXuatId, "DUYET"));
    expect(bo.dongDuocHoi).toEqual([`${T}i26`, `${T}i26`]);
  });

  // ═══ `taoQrSessionDuoiKhoa` — ĐÚNG CHỖ GHI QR, kiểm lại cổng dưới khoá đơn (rà soát độc lập 19/10/2026) ═══════════════════════
  const duLieuQr = (paymentRequestId: string) => ({
    paymentRequestId,
    centerId: CS1,
    amountShown: TIEN,
    qrContent: "qr",
    expiresAt: HEN_NGAY,
    status: "ACTIVE" as const,
  });

  it("[DXC-DB-27] ghi QR: đơn sạch ⇒ ghi; có đề xuất PENDING ⇒ CHẶN, 0 QrSession; mỗi cột duyệt PENDING ⇒ CHẶN; đề xuất đã quyết ⇒ ghi lại được", async () => {
    await dungDon(`${T}o27`, `${T}i27`);
    const dot = await dotCua(`${T}o27`, `${T}i27`);
    const ok = await taoQrSessionDuoiKhoa({ orderId: `${T}o27`, data: duLieuQr(dot) });
    expect(ok.ok).toBe(true);
    await db.qrSession.deleteMany({ where: { paymentRequestId: dot } });

    const a = phaiOk(await guiBoBot(SALE(), `${T}i27`));
    const chan = await taoQrSessionDuoiKhoa({ orderId: `${T}o27`, data: duLieuQr(dot) });
    expect(chan.ok).toBe(false);
    expect(!chan.ok && chan.error.toLowerCase()).toContain("đề xuất đổi chương trình giảm");
    expect(await db.qrSession.count({ where: { paymentRequestId: dot } })).toBe(0);

    phaiOk(await quyet(QL(), a.deXuatId, "TU_CHOI", "Từ chối để phát lại mã QR"));
    for (const cot of ["discountApprovalStatus", "installmentApprovalStatus", "soBuoiApprovalStatus"] as const) {
      await db.order.update({ where: { id: `${T}o27` }, data: { [cot]: "PENDING_APPROVAL" } });
      expect((await taoQrSessionDuoiKhoa({ orderId: `${T}o27`, data: duLieuQr(dot) })).ok, cot).toBe(false);
      await db.order.update({ where: { id: `${T}o27` }, data: { [cot]: null } });
    }
    expect(await db.qrSession.count({ where: { paymentRequestId: dot } })).toBe(0);
    expect((await taoQrSessionDuoiKhoa({ orderId: `${T}o27`, data: duLieuQr(dot) })).ok).toBe(true);
    expect((await taoQrSessionDuoiKhoa({ orderId: `${T}khong-co-don`, data: duLieuQr(dot) })).ok).toBe(false);
  });

  it("[DXC-DB-28] ĐUA đề xuất ‖ phát QR (12 lượt): đúng MỘT bên thắng; KHÔNG BAO GIỜ vừa có đề xuất PENDING vừa có QR còn hạn", async () => {
    for (let i = 0; i < 12; i++) {
      const o = `${T}o28-${i}`;
      const it = `${T}i28-${i}`;
      await dungDon(o, it);
      const dot = await dotCua(o, it);
      const [de, qr] = await Promise.all([guiBoBot(SALE(), it), taoQrSessionDuoiKhoa({ orderId: o, data: duLieuQr(dot) })]);
      const soDeXuat = await db.discountProgramChangeRequest.count({ where: { orderId: o, status: "PENDING" } });
      const soQr = await db.qrSession.count({ where: { paymentRequestId: dot, status: "ACTIVE" } });
      expect({ de: de.ok, qr: qr.ok, soDeXuat, soQr }, `lượt ${i}`).toSatisfy((x: { de: boolean; qr: boolean; soDeXuat: number; soQr: number }) =>
        (x.de && !x.qr && x.soDeXuat === 1 && x.soQr === 0) || (!x.de && x.qr && x.soDeXuat === 0 && x.soQr === 1),
      );
      if (!de.ok) expect(de.ma).toBe("DON_DA_PHAT_MA");
    }
  });

  it("[DXC-DB-29] XÁC ĐỊNH (không dựa vào may rủi): người khác đang GIỮ KHOÁ ĐƠN ⇒ ghi QR phải CHỜ; khi người đó commit một đề xuất PENDING thì QR bị chặn", async () => {
    await dungDon(`${T}o29`, `${T}i29`);
    const dot = await dotCua(`${T}o29`, `${T}i29`);
    let nhaKhoa!: () => void;
    const giuKhoa = new Promise<void>((r) => (nhaKhoa = r));
    let daCoKhoa!: () => void;
    const coKhoa = new Promise<void>((r) => (daCoKhoa = r));
    const luotGiu = db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, `${T}o29`);
      daCoKhoa();
      await giuKhoa;
      // đề xuất PENDING được ghi KHI đang giữ khoá, rồi commit
      await tx.discountProgramChangeRequest.create({
        data: {
          orderId: `${T}o29`,
          orderItemId: `${T}i29`,
          centerId: CS1,
          removeVoucherIds: ["anhem2"],
          reason: "Đề xuất chen vào lúc QR đang chờ khoá",
          suggestionFingerprint: "f".repeat(64),
          suggestionSnapshot: {},
          proposedById: `${T}sale`,
          proposedAt: NOW,
        },
      });
    });
    await coKhoa;
    const luotQr = taoQrSessionDuoiKhoa({ orderId: `${T}o29`, data: duLieuQr(dot) });
    let xong = false;
    void luotQr.then(() => (xong = true));
    await new Promise((r) => setTimeout(r, 600));
    expect(xong, "ghi QR phải CHỜ khoá đơn của người đang giữ").toBe(false);
    nhaKhoa();
    await luotGiu;
    const kq = await luotQr;
    expect(kq.ok, "đọc LẠI sau khi có khoá ⇒ thấy đề xuất vừa commit ⇒ chặn").toBe(false);
    expect(await db.qrSession.count({ where: { paymentRequestId: dot } })).toBe(0);
  });
});
