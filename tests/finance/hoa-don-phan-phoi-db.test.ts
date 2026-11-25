// Ca [PPH-*] — PHÂN PHỐI HOÁ ĐƠN ĐÃ PHÁT HÀNH cho Sale / phụ huynh (Invoice Hub S10) TRÊN POSTGRES THẬT.
//
// Chạy:  DATABASE_URL=… DIRECT_URL=… pnpm exec vitest run -c vitest.db.config.ts tests/finance/hoa-don-phan-phoi-db.test.ts
// Không gọi `resetDb()`: fixture tự dựng + tự dọn theo tiền tố `fx-pph-`; mỗi ca dựng lại ⇒ xanh khi chạy MỘT MÌNH. Mọi ca "KHÔNG được" kèm đối chứng dương.
// Chỉ mock: kho tệp (R2) và phiên/quyền của route. Cô lập cơ sở, sở hữu phụ huynh, cờ theo cơ sở, audit, đọc DB đều CHẠY THẬT.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  doc: vi.fn(),
  khoOk: vi.fn(() => true),
  audit: vi.fn(),
  auth: vi.fn(),
  checkPermission: vi.fn(),
  getPortalContext: vi.fn(),
}));
vi.mock("@/lib/finance/hoa-don/phan-phoi-tep", () => ({ docPdfHoaDon: h.doc }));
vi.mock("@/lib/finance/hoa-don/kho-tep", () => ({ khoHoaDonDaCauHinh: h.khoOk }));
vi.mock("@/lib/audit/audit-log", async (orig) => {
  const that = await orig<typeof import("@/lib/audit/audit-log")>();
  h.audit.mockImplementation(that.writeAudit);
  return { ...that, writeAudit: h.audit };
});
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/portal/session", () => ({ getPortalContext: h.getPortalContext }));

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "@/lib/auth/actor";
import { docHoaDonChoDon, docHoaDonChoPhuHuynh, moTepChoNguoiXem } from "@/lib/finance/hoa-don/phan-phoi-db";
import { GET } from "@/app/api/hoa-don/[id]/tai-pdf/route";

if (!RUN_DB_TESTS) console.warn(`[PPH] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-pph-";
const CS1 = `${T}cs1`;
const CS2 = `${T}cs2`;
const OU_HO = `${T}ou-ho`;
const OU1 = `${T}ou1`;
const OU2 = `${T}ou2`;
const VAI_XEM = `${T}vai-xem`; // orders:view
const VAI_PII = `${T}vai-pii`; // orders:view-pii
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const KHOA_R2 = (hd: string) => `hoa-don/${T}cs1/2026/${T}don/${hd}-uuid.pdf`;

// học viên
const K1 = `${T}k1`; // con 1 của P1 (CS1)
const K2 = `${T}k2`; // con 2 của P1 (CS1)
const K3 = `${T}k3`; // con của P2 (CS1)
const K4 = `${T}k4`; // con của P3 (CS2)
// đơn
const DON_A = `${T}don-a`; // CS1, K1
const DON_B = `${T}don-b`; // CS1, studentId NULL; khoản gắn K2 qua dòng hàng
const DON_P2 = `${T}don-p2`; // CS1, K3
const DON_CS2 = `${T}don-cs2`; // CS2, K4
const DON_MIX = `${T}don-mix`; // CS1, dòng hàng của K1 VÀ K3 (hai phụ huynh khác nhau)
// hoá đơn
const HD_A = `${T}hd-a`;
const HD_A_NHAP = `${T}hd-a-nhap`;
const HD_A_LOI = `${T}hd-a-loi`;
const HD_A_THAY = `${T}hd-a-thay`;
const HD_A_GIALAP = `${T}hd-a-gialap`;
const HD_A_NOPDF = `${T}hd-a-nopdf`;
const HD_B = `${T}hd-b`;
const HD_P2 = `${T}hd-p2`;
const HD_CS2 = `${T}hd-cs2`;
const HD_MIX = `${T}hd-mix`;

async function don() {
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.hoaDonDienTu.deleteMany({ where: { id: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.orderItem.deleteMany({ where: { orderId: { startsWith: T } } });
  await db.order.deleteMany({ where: { id: { startsWith: T } } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  const nguoi = await db.user.findMany({ where: { email: { endsWith: `@${T}test` } }, select: { id: true } });
  await db.userOrgRole.deleteMany({ where: { OR: [{ userId: { in: nguoi.map((u) => u.id) } }, { roleId: { in: [VAI_XEM, VAI_PII] } }] } });
  await db.rolePermission.deleteMany({ where: { roleId: { in: [VAI_XEM, VAI_PII] } } });
  await db.roleDef.deleteMany({ where: { id: { in: [VAI_XEM, VAI_PII] } } });
  await db.user.deleteMany({ where: { id: { in: nguoi.map((u) => u.id) } } });
  await db.centerSetting.deleteMany({ where: { orgUnitId: { in: [OU1, OU2] } } });
  await db.orgUnit.deleteMany({ where: { id: { in: [OU1, OU2] } } });
  await db.orgUnit.deleteMany({ where: { id: OU_HO } });
  await db.center.deleteMany({ where: { id: { in: [CS1, CS2] } } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem", "hoaDon.hubPhanPhoi"] } } });
}

async function datCo(o: { phanPhoi: boolean; thiDiem?: boolean }) {
  for (const [key, v] of [
    ["billing.hoaDonEnabled", true],
    ["hoaDon.hubQuet", true],
    ["hoaDon.hubThiDiem", o.thiDiem ?? true],
    ["hoaDon.hubPhanPhoi", o.phanPhoi],
  ] as const) {
    await db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });
  }
}
const batRieng = (orgUnitId: string, value: boolean) =>
  db.centerSetting.upsert({ where: { orgUnitId_key: { orgUnitId, key: "hoaDon.hubThiDiem" } }, create: { orgUnitId, key: "hoaDon.hubThiDiem", valueJson: value }, update: { valueJson: value } });

type Nguoi = { id: string };
async function lapNhanVien(ten: string, vai: { xem: string[]; pii: string[] }): Promise<Nguoi> {
  const u = await seedUser({ email: `${ten}@${T}test`, role: "TEACHER", name: ten });
  for (const ou of vai.xem) await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou, roleId: VAI_XEM, grantedById: u.id } });
  for (const ou of vai.pii) await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ou, roleId: VAI_PII, grantedById: u.id } });
  return u;
}
async function lapPhuHuynh(ten: string): Promise<Nguoi> {
  return seedUser({ email: `${ten}@${T}test`, role: "PARENT", name: ten });
}

let soTiep = 200;
const hdBase = (id: string, orderId: string, centerId: string, o: Record<string, unknown> = {}) => ({
  id,
  orderId,
  centerId,
  trangThai: "DA_XAC_NHAN" as const,
  kyHieu: "1C26TSR",
  soHoaDon: id === HD_A ? "127" : String(soTiep++),
  ngayPhatHanh: new Date("2026-10-11T00:00:00Z"),
  tongTien: 5_000_000,
  tepPdfKey: KHOA_R2(id),
  nguonPhatHanh: "MISA_API" as const,
  taoBoiId: `${T}kt`,
  ...o,
});

let P1: Nguoi;
let P2: Nguoi;
let P3: Nguoi;
let SALE_CS1: Nguoi;
let SALE_CS2: Nguoi;
let SALE_KHONG_PII: Nguoi;
let SALE_PII_CS2: Nguoi; // orders:view ở CS1+CS2, orders:view-pii CHỈ ở CS2

async function dungFixture() {
  await don();
  await datCo({ phanPhoi: true });
  for (const [id, ten] of [[CS1, "CS1 PPH"], [CS2, "CS2 PPH"]] as const) await db.center.create({ data: { id, name: ten, slug: id, address: "x" } });
  await db.orgUnit.create({ data: { id: OU_HO, type: "HO", code: `${T}HO`, name: "HO PPH", path: `/${T}ho/`, depth: 0 } });
  await db.orgUnit.create({ data: { id: OU1, type: "CENTER", code: `${T}OU1`, name: "ĐV CS1 PPH", centerId: CS1, parentId: OU_HO, path: `/${T}ho/${T}ou1/`, depth: 1 } });
  await db.orgUnit.create({ data: { id: OU2, type: "CENTER", code: `${T}OU2`, name: "ĐV CS2 PPH", centerId: CS2, parentId: OU_HO, path: `/${T}ho/${T}ou2/`, depth: 1 } });

  await db.roleDef.create({ data: { id: VAI_XEM, code: `${T}vai-xem`, name: "Xem đơn PPH" } });
  await db.rolePermission.create({ data: { roleId: VAI_XEM, action: "orders:view", scopeType: "GLOBAL" } });
  await db.roleDef.create({ data: { id: VAI_PII, code: `${T}vai-pii`, name: "Xem PII PPH" } });
  await db.rolePermission.create({ data: { roleId: VAI_PII, action: "orders:view-pii", scopeType: "GLOBAL" } });

  P1 = await lapPhuHuynh("p1");
  P2 = await lapPhuHuynh("p2");
  P3 = await lapPhuHuynh("p3");
  SALE_CS1 = await lapNhanVien("sale-cs1", { xem: [OU1], pii: [OU1] });
  SALE_CS2 = await lapNhanVien("sale-cs2", { xem: [OU2], pii: [OU2] });
  SALE_KHONG_PII = await lapNhanVien("sale-khong-pii", { xem: [OU1], pii: [] });
  SALE_PII_CS2 = await lapNhanVien("sale-pii-cs2", { xem: [OU1, OU2], pii: [OU2] });

  for (const [id, ten, cha, coSo] of [[K1, "Con Một", P1, CS1], [K2, "Con Hai", P1, CS1], [K3, "Con Ba", P2, CS1], [K4, "Con Bốn", P3, CS2]] as const) {
    await db.student.create({ data: { id, name: `${ten} PPH`, centerId: coSo, parentUserId: cha.id, status: "ACTIVE" } });
  }
  const donMoi = async (id: string, coSo: string, studentId: string | null, ma: string) =>
    db.order.create({ data: { id, code: ma, type: "COURSE", status: "CONFIRMED", customerName: "Khach PPH", customerPhone: "0328545331", totalAmount: 5_000_000, centerId: coSo, studentId } });
  const dong = (id: string, orderId: string, studentId: string) =>
    db.orderItem.create({ data: { id, orderId, type: "COURSE_ENROLLMENT", itemName: "Khoá PPH", unitPrice: 5_000_000, totalPrice: 5_000_000, studentId } });
  await donMoi(DON_A, CS1, K1, "ORD-269972-000001");
  await dong(`${T}it-a`, DON_A, K1);
  await donMoi(DON_B, CS1, null, "ORD-269972-000002");
  await dong(`${T}it-b`, DON_B, K2);
  await donMoi(DON_P2, CS1, K3, "ORD-269972-000003");
  await dong(`${T}it-p2`, DON_P2, K3);
  await donMoi(DON_CS2, CS2, K4, "ORD-269972-000004");
  await dong(`${T}it-cs2`, DON_CS2, K4);
  await donMoi(DON_MIX, CS1, null, "ORD-269972-000005");
  await dong(`${T}it-mix1`, DON_MIX, K1);
  await dong(`${T}it-mix3`, DON_MIX, K3);

  const hd = (id: string, orderId: string, centerId: string, o: Record<string, unknown> = {}) => db.hoaDonDienTu.create({ data: hdBase(id, orderId, centerId, o) as never });
  await hd(HD_A, DON_A, CS1);
  await hd(HD_A_NHAP, DON_A, CS1, { trangThai: "NHAP", soHoaDon: null, ngayPhatHanh: null });
  await hd(HD_A_LOI, DON_A, CS1, { trangThai: "LOI_PHAT_HANH", soHoaDon: null, ngayPhatHanh: null, tepPdfKey: null });
  await hd(HD_A_THAY, DON_A, CS1, { trangThai: "THAY_THE", huyLyDo: "Sai thông tin PPH", huyBoiId: `${T}kt`, huyLuc: new Date("2026-10-12T03:00:00Z") });
  await hd(HD_A_GIALAP, DON_A, CS1, { nguonPhatHanh: "MISA_GIA_LAP" });
  await hd(HD_A_NOPDF, DON_A, CS1, { tepPdfKey: null });
  await hd(HD_P2, DON_P2, CS1);
  await hd(HD_CS2, DON_CS2, CS2);
  await hd(HD_MIX, DON_MIX, CS1);
  // HD_B: nối với con qua KHOẢN (dòng hàng của K2), không qua Order.studentId.
  await hd(HD_B, DON_B, CS1);
  const pay = await db.payment.create({ data: { id: `${T}pay-b`, orderId: DON_B, orderItemId: `${T}it-b`, amount: 5_000_000, method: "BANK_TRANSFER", paidDate: new Date("2026-10-10T03:00:00Z"), centerId: CS1 } });
  await db.hoaDonKhoan.create({ data: { hoaDonId: HD_B, paymentId: pay.id, soTien: 5_000_000, hieuLuc: true } });
}

const owner = (p: Nguoi, con: string[]) => ({ parentUserId: p.id, childIds: con });
const actorCua = (n: Nguoi) => resolveActorUncached(n.id);
const ids = (d: { id: string }[]) => d.map((x) => x.id).sort();
const nhatKyTai = () => db.auditLog.findMany({ where: { action: "TAI_TEP_HOA_DON", entityId: { startsWith: T } } });

beforeEach(async () => {
  if (!RUN_DB_TESTS) return;
  vi.clearAllMocks();
  h.khoOk.mockReturnValue(true);
  h.doc.mockResolvedValue(PDF);
  await dungFixture();
});
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});

const chay = RUN_DB_TESTS ? describe : describe.skip;

chay("[PPH-01] Sale: cô lập cơ sở + chỉ hoá đơn đã phát hành / đã thay thế", () => {
  it("Sale CS1 thấy hoá đơn của đơn CS1 (đối chứng dương), KHÔNG thấy đơn CS2; Sale CS2 ngược lại", async () => {
    const a = await docHoaDonChoDon(await actorCua(SALE_CS1), { orderId: DON_A, xemPii: true });
    expect(a).not.toBeNull();
    expect(a!.dong.length).toBeGreaterThan(0);
    expect(await docHoaDonChoDon(await actorCua(SALE_CS1), { orderId: DON_CS2, xemPii: true })).toBeNull();
    expect(await docHoaDonChoDon(await actorCua(SALE_CS2), { orderId: DON_A, xemPii: true })).toBeNull();
    const cs2 = await docHoaDonChoDon(await actorCua(SALE_CS2), { orderId: DON_CS2, xemPii: true });
    expect(ids(cs2!.dong)).toEqual([HD_CS2]);
  });

  it("đơn có đủ trạng thái: chỉ ĐÃ PHÁT HÀNH + ĐÃ THAY THẾ vào danh sách; NHÁP / LỖI PHÁT HÀNH không", async () => {
    const k = (await docHoaDonChoDon(await actorCua(SALE_CS1), { orderId: DON_A, xemPii: true }))!;
    expect(ids(k.dong)).toEqual([HD_A, HD_A_GIALAP, HD_A_NOPDF, HD_A_THAY].sort());
    const theoId = new Map(k.dong.map((d) => [d.id, d]));
    expect(theoId.get(HD_A)).toMatchObject({ nhan: "Đã phát hành", taiPdf: `/api/hoa-don/${HD_A}/tai-pdf` });
    expect(theoId.get(HD_A_THAY)).toMatchObject({ nhan: "Đã thay thế", daThayThe: true, taiPdf: null });
    expect(theoId.get(HD_A_GIALAP)).toMatchObject({ nhan: "Bản mô phỏng", taiPdf: null });
    expect(theoId.get(HD_A_NOPDF)!.taiPdf).toBeNull();
    expect(theoId.get(HD_A_NOPDF)!.lyDoKhongTai).toMatch(/chưa có tệp PDF/);
  });

  it("view-model không chứa khoá R2 / hash / studentId / tên con", async () => {
    const k = await docHoaDonChoDon(await actorCua(SALE_CS1), { orderId: DON_A, xemPii: true });
    const s = JSON.stringify(k);
    for (const nhay of [KHOA_R2(HD_A), `hoa-don/${T}cs1/`, "tepPdf", K1, "Con Một", "maTraCuu"]) expect(s).not.toContain(nhay);
  });
});

chay("[PPH-02] Sale: tải PDF cần orders:view-pii ĐÚNG cơ sở của hoá đơn", () => {
  it("không có view-pii ⇒ thấy dòng nhưng KHÔNG nút tải; đối chứng: có view-pii ⇒ có nút", async () => {
    const khong = await docHoaDonChoDon(await actorCua(SALE_KHONG_PII), { orderId: DON_A, xemPii: false });
    expect(khong!.dong.find((d) => d.id === HD_A)).toMatchObject({ taiPdf: null });
    expect(khong!.dong.find((d) => d.id === HD_A)!.lyDoKhongTai).toMatch(/quyền xem thông tin khách/);
    const co = await docHoaDonChoDon(await actorCua(SALE_CS1), { orderId: DON_A, xemPii: true });
    expect(co!.dong.find((d) => d.id === HD_A)!.taiPdf).not.toBeNull();
  });
  it("view-pii CHỈ ở CS2 mà xem đơn CS1 ⇒ không nút tải ở CS1, có nút ở CS2 (quyền trần GLOBAL không đủ)", async () => {
    const a = await actorCua(SALE_PII_CS2);
    expect((await docHoaDonChoDon(a, { orderId: DON_A, xemPii: true }))!.dong.find((d) => d.id === HD_A)!.taiPdf).toBeNull();
    expect((await docHoaDonChoDon(a, { orderId: DON_CS2, xemPii: true }))!.dong.find((d) => d.id === HD_CS2)!.taiPdf).not.toBeNull();
    // và đường tải thật cũng từ chối đúng chỗ đó
    expect((await moTepChoNguoiXem({ hoaDonId: HD_A, nguoi: { loai: "NHAN_VIEN", actor: a, xemPii: true }, nguoiDung: { id: SALE_PII_CS2.id, ten: "x" } })).ok).toBe(false);
    expect((await moTepChoNguoiXem({ hoaDonId: HD_CS2, nguoi: { loai: "NHAN_VIEN", actor: a, xemPii: true }, nguoiDung: { id: SALE_PII_CS2.id, ten: "x" } })).ok).toBe(true);
  });
});

chay("[PPH-03] Phụ huynh: chỉ hoá đơn của CON mình, cùng cơ sở cũng không thấy con người khác", () => {
  it("P1/K1 thấy hoá đơn của K1 (đối chứng dương); KHÔNG thấy của K3 (P2, cùng cơ sở), K4 (CS2), đơn trộn", async () => {
    const o = owner(P1, [K1, K2]);
    const k1 = await docHoaDonChoPhuHuynh(o, K1, CS1);
    expect(ids(k1.dong)).toEqual([HD_A]);
    expect(k1.bat).toBe(true);
    for (const khong of [HD_P2, HD_CS2, HD_MIX]) expect(ids(k1.dong)).not.toContain(khong);
  });
  it("P2 thấy hoá đơn của K3 và không thấy của K1; P3 (CS2) thấy hoá đơn của K4", async () => {
    expect(ids((await docHoaDonChoPhuHuynh(owner(P2, [K3]), K3, CS1)).dong)).toEqual([HD_P2]);
    expect(ids((await docHoaDonChoPhuHuynh(owner(P3, [K4]), K4, CS2)).dong)).toEqual([HD_CS2]);
  });
  it("hỏi dưới con của NGƯỜI KHÁC, hoặc nhét con người khác vào childIds ⇒ vẫn rỗng (con lấy lại từ DB)", async () => {
    expect((await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K3, CS1)).dong).toEqual([]);
    const gia = owner(P1, [K1, K2, K3]); // cố nhận K3 (của P2) là con mình
    expect((await docHoaDonChoPhuHuynh(gia, K3, CS1)).dong).toEqual([]);
    expect(ids((await docHoaDonChoPhuHuynh(gia, K1, CS1)).dong)).toEqual([HD_A]); // và đơn trộn K1+K3 vẫn không lọt
  });
  it("hoá đơn nối con qua KHOẢN (Order.studentId rỗng) hiện dưới đúng con đó; không hiện dưới con anh/chị", async () => {
    expect(ids((await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K2, CS1)).dong)).toEqual([HD_B]);
    expect(ids((await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K1, CS1)).dong)).not.toContain(HD_B);
  });
  it("đơn trộn con của HAI phụ huynh ⇒ không phụ huynh nào thấy (fail-closed)", async () => {
    expect(ids((await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K1, CS1)).dong)).not.toContain(HD_MIX);
    expect(ids((await docHoaDonChoPhuHuynh(owner(P2, [K3]), K3, CS1)).dong)).not.toContain(HD_MIX);
  });
  it("con đã xoá mềm ⇒ không còn là con của phụ huynh trong loader", async () => {
    await db.student.update({ where: { id: K1 }, data: { deletedAt: new Date("2026-10-20T00:00:00Z") } });
    expect((await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K1, CS1)).dong).toEqual([]);
    await db.student.update({ where: { id: K1 }, data: { deletedAt: null } });
    expect(ids((await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K1, CS1)).dong)).toEqual([HD_A]); // đối chứng
  });
});

chay("[PPH-04] Phụ huynh: NHÁP / LỖI PHÁT HÀNH / ĐÃ THAY THẾ / MÔ PHỎNG / thiếu PDF không bao giờ hiện", () => {
  it("đơn K1 có 6 hoá đơn đủ trạng thái ⇒ phụ huynh chỉ thấy đúng MỘT (đã xác nhận, có PDF, bản thật)", async () => {
    const k = await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K1, CS1);
    expect(ids(k.dong)).toEqual([HD_A]);
    expect(Object.keys(k.dong[0]!).sort()).toEqual(["id", "kyHieu", "ngayLabel", "soTien", "taiPdf", "tieuDe"]);
  });
  it("từng bản không hợp lệ cũng bị route/loader tải từ chối (không chỉ ẩn khỏi danh sách)", async () => {
    const nguoi = { loai: "PHU_HUYNH" as const, owner: owner(P1, [K1, K2]) };
    const mo = (hoaDonId: string) => moTepChoNguoiXem({ hoaDonId, nguoi, nguoiDung: { id: P1.id, ten: "p1" } });
    for (const x of [HD_A_NHAP, HD_A_LOI, HD_A_THAY, HD_A_GIALAP, HD_A_NOPDF]) expect(await mo(x)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect((await mo(HD_A)).ok).toBe(true); // đối chứng dương
  });
});

chay("[PPH-05] cờ THEO CƠ SỞ: tắt ⇒ như không tồn tại (danh sách rỗng, tải 404, không audit)", () => {
  it("công tắc phân phối TẮT ⇒ Sale null, phụ huynh rỗng + bat=false, tải KHONG_TIM_THAY, 0 audit; bật lại ⇒ có", async () => {
    await datCo({ phanPhoi: false });
    expect(await docHoaDonChoDon(await actorCua(SALE_CS1), { orderId: DON_A, xemPii: true })).toBeNull();
    expect(await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K1, CS1)).toEqual({ bat: false, dong: [] });
    const t = await moTepChoNguoiXem({ hoaDonId: HD_A, nguoi: { loai: "PHU_HUYNH", owner: owner(P1, [K1, K2]) }, nguoiDung: { id: P1.id, ten: "p1" } });
    expect(t).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await nhatKyTai()).toHaveLength(0);
    expect(h.doc).not.toHaveBeenCalled();
    await datCo({ phanPhoi: true });
    expect(ids((await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K1, CS1)).dong)).toEqual([HD_A]);
  });
  it("thí điểm theo cơ sở: chỉ CS1 bật riêng ⇒ CS1 có, CS2 không; bật thêm CS2 ⇒ CS2 có", async () => {
    await datCo({ phanPhoi: true, thiDiem: false });
    await batRieng(OU1, true);
    expect(ids((await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K1, CS1)).dong)).toEqual([HD_A]);
    expect(await docHoaDonChoPhuHuynh(owner(P3, [K4]), K4, CS2)).toEqual({ bat: false, dong: [] });
    expect(await docHoaDonChoDon(await actorCua(SALE_CS2), { orderId: DON_CS2, xemPii: true })).toBeNull();
    await batRieng(OU2, true);
    expect(ids((await docHoaDonChoPhuHuynh(owner(P3, [K4]), K4, CS2)).dong)).toEqual([HD_CS2]);
    expect(await docHoaDonChoDon(await actorCua(SALE_CS2), { orderId: DON_CS2, xemPii: true })).not.toBeNull();
  });
  it("cờ bật nhưng chưa có hoá đơn nào ⇒ bat=true, dong rỗng (để khối nói 'chưa có hoá đơn')", async () => {
    const k = await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K2, CS1); // K2 chỉ có HD_B → xoá khoản & đổi trạng thái để rỗng
    expect(ids(k.dong)).toEqual([HD_B]);
    await db.hoaDonDienTu.update({ where: { id: HD_B }, data: { trangThai: "NHAP" } });
    expect(await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K2, CS1)).toEqual({ bat: true, dong: [] });
  });
});

chay("[PPH-06] tải PDF: audit đúng MỘT dòng, trước khi đọc byte; không rò khoá kho / studentId", () => {
  it("Sale tải hoá đơn của đơn mình ⇒ byte + tên tệp sạch + 1 dòng audit kênh SALE", async () => {
    const r = await moTepChoNguoiXem({ hoaDonId: HD_A, nguoi: { loai: "NHAN_VIEN", actor: await actorCua(SALE_CS1), xemPii: true }, nguoiDung: { id: SALE_CS1.id, ten: "sale cs1" } });
    expect(r).toMatchObject({ ok: true, tenTep: "hoa-don-1C26TSR-127.pdf" });
    expect(h.doc).toHaveBeenCalledWith(KHOA_R2(HD_A));
    const nk = await nhatKyTai();
    expect(nk).toHaveLength(1);
    expect(nk[0]).toMatchObject({ entityType: "HoaDonDienTu", entityId: HD_A, action: "TAI_TEP_HOA_DON" });
    expect(nk[0]!.newValues).toMatchObject({ loai: "pdf", kenh: "SALE", trangThai: "DA_XAC_NHAN", orderId: DON_A });
    const s = JSON.stringify(nk[0]);
    for (const nhay of [KHOA_R2(HD_A), `hoa-don/${T}cs1/`, K1, "Con Một", "tepPdf"]) expect(s).not.toContain(nhay);
  });
  it("Sale CS1 tải hoá đơn CS2 / Sale không có view-pii ⇒ KHONG_TIM_THAY, 0 audit, không đọc kho", async () => {
    const sale = { loai: "NHAN_VIEN" as const, actor: await actorCua(SALE_CS1), xemPii: true };
    expect(await moTepChoNguoiXem({ hoaDonId: HD_CS2, nguoi: sale, nguoiDung: { id: SALE_CS1.id, ten: "x" } })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    const khongPii = { loai: "NHAN_VIEN" as const, actor: await actorCua(SALE_KHONG_PII), xemPii: false };
    expect(await moTepChoNguoiXem({ hoaDonId: HD_A, nguoi: khongPii, nguoiDung: { id: SALE_KHONG_PII.id, ten: "x" } })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await nhatKyTai()).toHaveLength(0);
    expect(h.doc).not.toHaveBeenCalled();
    // đối chứng dương
    expect((await moTepChoNguoiXem({ hoaDonId: HD_A, nguoi: sale, nguoiDung: { id: SALE_CS1.id, ten: "x" } })).ok).toBe(true);
  });
  it("cờ `xemPii` do người gọi giải (checkPermission) là cổng RIÊNG: actor CÓ view-pii ở cơ sở mà quyền trần = false ⇒ không tải; true ⇒ tải", async () => {
    const actor = await actorCua(SALE_CS1); // dữ liệu vai có view-pii tại CS1
    const mo = (xemPii: boolean) => moTepChoNguoiXem({ hoaDonId: HD_A, nguoi: { loai: "NHAN_VIEN", actor, xemPii }, nguoiDung: { id: SALE_CS1.id, ten: "x" } });
    expect(await mo(false)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await nhatKyTai()).toHaveLength(0);
    expect((await mo(true)).ok).toBe(true);
  });
  it("phụ huynh tải hoá đơn của con mình ⇒ kênh PHU_HUYNH; tải hoá đơn của con người khác / đơn trộn ⇒ KHONG_TIM_THAY, 0 audit", async () => {
    const nguoi = { loai: "PHU_HUYNH" as const, owner: owner(P1, [K1, K2]) };
    const mo = (hoaDonId: string) => moTepChoNguoiXem({ hoaDonId, nguoi, nguoiDung: { id: P1.id, ten: "p1" } });
    for (const x of [HD_P2, HD_CS2, HD_MIX]) expect(await mo(x)).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await nhatKyTai()).toHaveLength(0);
    expect((await mo(HD_A)).ok).toBe(true);
    expect((await mo(HD_B)).ok).toBe(true); // con thứ hai, nối qua khoản
    const nk = await nhatKyTai();
    expect(nk).toHaveLength(2);
    expect(nk.every((x) => (x.newValues as { kenh?: string }).kenh === "PHU_HUYNH")).toBe(true);
  });
  it("audit LỖI ⇒ AUDIT_LOI và KHÔNG đọc byte; đối chứng: audit lành ⇒ đọc", async () => {
    h.audit.mockRejectedValueOnce(new Error("audit down"));
    const nguoi = { loai: "PHU_HUYNH" as const, owner: owner(P1, [K1, K2]) };
    expect(await moTepChoNguoiXem({ hoaDonId: HD_A, nguoi, nguoiDung: { id: P1.id, ten: "p1" } })).toEqual({ ok: false, ma: "AUDIT_LOI" });
    expect(h.doc).not.toHaveBeenCalled();
    expect((await moTepChoNguoiXem({ hoaDonId: HD_A, nguoi, nguoiDung: { id: P1.id, ten: "p1" } })).ok).toBe(true);
    expect(h.doc).toHaveBeenCalledTimes(1);
  });
  it("kho chưa cấu hình ⇒ KHO_CHUA_CAU_HINH, 0 audit, danh sách phụ huynh rỗng; kho lỗi đọc ⇒ KHO_LOI", async () => {
    const nguoi = { loai: "PHU_HUYNH" as const, owner: owner(P1, [K1, K2]) };
    h.khoOk.mockReturnValue(false);
    expect(await moTepChoNguoiXem({ hoaDonId: HD_A, nguoi, nguoiDung: { id: P1.id, ten: "p1" } })).toEqual({ ok: false, ma: "KHO_CHUA_CAU_HINH" });
    expect(await nhatKyTai()).toHaveLength(0);
    expect((await docHoaDonChoPhuHuynh(owner(P1, [K1, K2]), K1, CS1)).dong).toEqual([]);
    h.khoOk.mockReturnValue(true);
    h.doc.mockResolvedValueOnce(null);
    expect(await moTepChoNguoiXem({ hoaDonId: HD_A, nguoi, nguoiDung: { id: P1.id, ten: "p1" } })).toEqual({ ok: false, ma: "KHO_LOI" });
  });
});

chay("[PPH-07] route HTTP: 401/403/404 thống nhất, thân là byte PDF, không rò khoá kho / studentId", () => {
  const dangNhap = (u: Nguoi, quyen: string[], ph: { parentUserId: string; children: { id: string }[] } | null = null) => {
    h.auth.mockResolvedValue({ user: { id: u.id, name: "Tên Người Dùng", email: "x@y.z" } });
    h.checkPermission.mockImplementation(async (a: string) => quyen.includes(a));
    h.getPortalContext.mockResolvedValue(ph);
  };
  const goi = (id: string) => GET(new Request(`https://admin.satarobo.vn/api/hoa-don/${id}/tai-pdf`), { params: Promise.resolve({ id }) });

  it("Sale 200 + PDF + header đúng; không Location; tên tệp và header không chứa khoá R2 / studentId / tên con", async () => {
    dangNhap(SALE_CS1, ["orders:view", "orders:view-pii"]);
    const r = await goi(HD_A);
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("location")).toBeNull();
    const tieuDe = [...r.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    for (const nhay of [KHOA_R2(HD_A), `hoa-don/${T}cs1/`, K1, "Con Một", "Tên Người Dùng"]) expect(tieuDe).not.toContain(nhay);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="hoa-don-1C26TSR-[A-Za-z0-9-]+\.pdf"$/);
  });
  it("hoá đơn người khác, không tồn tại, nháp, cờ tắt ⇒ CÙNG một 404 (không phân biệt)", async () => {
    dangNhap(SALE_CS1, ["orders:view", "orders:view-pii"]);
    const thuc = await Promise.all([HD_CS2, "khong-co-dau", HD_A_NHAP].map(async (id) => ({ s: (await goi(id)).status, b: await (await goi(id)).text() })));
    for (const t of thuc) expect(t).toEqual({ s: 404, b: JSON.stringify({ error: "Không tìm thấy hoá đơn" }) });
    await datCo({ phanPhoi: false });
    const tat = await goi(HD_A);
    expect(tat.status).toBe(404);
    expect(await tat.text()).toBe(JSON.stringify({ error: "Không tìm thấy hoá đơn" }));
    await datCo({ phanPhoi: true });
    expect((await goi(HD_A)).status).toBe(200); // đối chứng dương
  });
  it("phụ huynh: con mình 200; con người khác 404; không đăng nhập 401; không phải ai cả 403", async () => {
    dangNhap(P1, [], { parentUserId: P1.id, children: [{ id: K1 }, { id: K2 }] });
    expect((await goi(HD_A)).status).toBe(200);
    expect((await goi(HD_P2)).status).toBe(404);
    expect((await goi(HD_MIX)).status).toBe(404);
    dangNhap(SALE_KHONG_PII, ["orders:view"]);
    expect((await goi(HD_A)).status).toBe(403);
    h.auth.mockResolvedValue(null);
    expect((await goi(HD_A)).status).toBe(401);
  });
  it("người có quyền xem đơn nhưng KHÔNG thấy đơn đó (không có vai ở cơ sở) mà là phụ huynh của con ⇒ rơi sang kênh phụ huynh và tải được", async () => {
    dangNhap(P1, ["orders:view", "orders:view-pii"], { parentUserId: P1.id, children: [{ id: K1 }, { id: K2 }] });
    expect((await goi(HD_A)).status).toBe(200);
    const nk = await nhatKyTai();
    expect(nk).toHaveLength(1);
    expect((nk[0]!.newValues as { kenh?: string }).kenh).toBe("PHU_HUYNH");
  });
});
