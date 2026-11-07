// Ca [TXD-*] — TỰ XUẤT HOÁ ĐƠN SAU n GIỜ KỂ TỪ LÚC PHỤ HUYNH ĐIỀN FORM QR (BGĐ yêu cầu 03/11/2026) trên Postgres THẬT, cổng nhà cung cấp GIẢ.
//
// Canh chuỗi: công tắc → yêu cầu PH đã gửi quá n giờ → lần thu đang chờ xuất → máy phát hành → đóng yêu cầu:
//   · công tắc TẮT ⇒ không đọc, không ghi (null); chưa tới giờ ⇒ không xuất; tới giờ ⇒ MỘT hoá đơn cho MỖI lần thu, người mua = thông tin PH khai (KHÔNG phải «người tiêu dùng»);
//   · Sale sửa ĐƠN sau khi PH gửi ⇒ hoá đơn mang bản Sale sửa (ai ghi sau thắng); PH gửi lại ⇒ mốc dời;
//   · khoản chưa được kế toán xác nhận ⇒ KHÔNG xuất và hệ thống KHÔNG tự xác nhận tiền; thiếu thông tin người mua ⇒ không xuất, yêu cầu còn mở;
//   · xuất xong thì ĐÓNG yêu cầu (liên kết hết dùng được); chạy lần hai không phát hành lần hai; yêu cầu quá 7 ngày bị bỏ lại cho kế toán;
//   · KHÔNG có cửa sổ ngày thu (khác lô 23h): lần thu cũ hơn một ngày vẫn xuất; cơ sở ngoài thí điểm / luồng QR tắt ⇒ không đụng.
// Không gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  cong: null as null | import("@/lib/misa/meinvoice/cong").CongHoaDon,
  notify: vi.fn(async (_p: { userIds: string[]; dedupeKey: string; title: string; body: string; href: string }) => 1),
}));
// Cảnh báo chạm hạn mức đi qua `notifyStaff` + `timKeToan`: giả lập để ca KHÔNG ghi thông báo thật và kiểm được nội dung/khoá.
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));
vi.mock("@/lib/finance/hoa-don/nhac-ke-toan-db", () => ({ timKeToan: async () => [{ userId: "fx-han-muc-ke-toan", phamVi: "ALL" as const }] }));
vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
  luuTepHoaDon: async (i: { loai: "pdf" | "xml"; than: Uint8Array }) => ({ ok: true as const, co: i.than.length, sha256: `sha-${i.loai}-${i.than.length}` }),
}));
vi.mock("@/lib/finance/hoa-don/cong-phat-hanh", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/cong-phat-hanh")>()),
  layCongHoaDon: () => h.cong,
}));

import { PaymentAccountantStatus as AccountantStatus, PaymentSaleStatus as SaleStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { CongHoaDon, PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import { chayTuXuat, chayTuXuatCuaCron } from "@/lib/finance/hoa-don/tu-xuat-sau-gio/chay-tu-xuat";

if (!RUN_DB_TESTS) console.warn(`[TXD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-txd-";
const CS = `${T}center`;
const OU = `${T}ou`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HS = `${T}hs`;
const GD = `${T}gd`;
const DON = `${T}don`;
const SALE = `${T}sale`;
const P1 = `${T}p1`;
const P2 = `${T}p2`;
const YC = `${T}yc`;
const NOW = new Date("2699-09-30T08:00:00Z");
const gioTruoc = (n: number) => new Date(NOW.getTime() - n * 3_600_000);
const KEY_SETTINGS = ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.misaPhatHanh", "hoaDon.hubNguoiMua", "hoaDon.tuXuatBat", "hoaDon.tuXuatSauGio"];
const PDF = new TextEncoder().encode("%PDF-1.7 hoa don gia");
const XML = new TextEncoder().encode("<?xml version='1.0'?><HDon/>");
/** Đơn đã có thông tin người mua ĐỦ để xuất (cá nhân: tên + địa chỉ). */
const DON_DU_NGUOI_MUA = { invoiceBuyerName: "Lê Thị Phụ Huynh TXD", customerAddress: "5 Hoàng Diệu", customerCity: "Đà Nẵng" };

let so = 0;
function congGia(): CongHoaDon & { daGui: PhieuPhatHanh[] } {
  const c = {
    cheDo: "HSM" as const,
    moiTruong: "sandbox" as const,
    daGui: [] as PhieuPhatHanh[],
    async phatHanh(phieu: PhieuPhatHanh) {
      c.daGui.push(phieu);
      const s = String(++so + 7000);
      return { loai: "DA_PHAT_HANH" as const, refId: phieu.refId, kyHieu: "1C99TSR", soHoaDon: s, ngayPhatHanh: new Date("2699-09-30T08:00:00Z"), maTraCuu: `TRA-${s}` };
    },
    async traCuu() {
      return { loai: "CHUA_CO" as const };
    },
    async taiTep(_m: string, loai: "pdf" | "xml") {
      return loai === "pdf" ? PDF : XML;
    },
  };
  return c as unknown as CongHoaDon & { daGui: PhieuPhatHanh[] };
}

async function don() {
  const hds = await db.hoaDonDienTu.findMany({ where: { orderId: DON }, select: { id: true, guiEmail: { select: { id: true } } } });
  const hdIds = hds.map((x) => x.id);
  const guiIds = hds.flatMap((x) => x.guiEmail.map((g) => g.id));
  await db.domainEvent.deleteMany({
    where: { OR: [{ dedupeKey: { in: guiIds.map((g) => `hoa-don.gui:${g}`) } }, { dedupeKey: { in: hdIds.map((x) => `hoa-don.khong-email:${x}`) } }, { dedupeKey: { contains: T } }] },
  });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: hdIds } }, { entityId: { startsWith: T } }, { entityId: { startsWith: "tu-xuat:2699" } }] } });
  await db.hoaDonNgoaiLe.deleteMany({ where: { centerId: CS } });
  await db.hoaDonNghiaVu.deleteMany({ where: { orderId: DON } });
  await db.hoaDonYeuCauNguoiMua.deleteMany({ where: { orderId: DON } });
  await db.systemSetting.deleteMany({ where: { key: { in: KEY_SETTINGS } } });
  await db.centerSetting.deleteMany({ where: { orgUnitId: OU } });
  await db.orgUnit.deleteMany({ where: { id: OU } });
  await db.hoaDonDienTu.updateMany({ where: { orderId: DON }, data: { thayTheChoId: null } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollment.deleteMany({ where: { id: GD } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HS } });
  await db.hoaDonKyChinhSach.deleteMany({ where: { capNhatBoiId: SALE } });
  await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
  await db.center.deleteMany({ where: { id: CS } });
}

const batSetting = (key: string, v: unknown = true) => db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v as never }, update: { valueJson: v as never } });

const khoan = (id: string, amount: number, o: { xacNhan?: boolean; paid?: Date } = {}) =>
  db.payment.create({
    data: {
      id,
      orderId: DON,
      amount,
      method: "CASH",
      paidDate: o.paid ?? gioTruoc(1),
      saleStatus: SaleStatus.RECORDED,
      accountantStatus: o.xacNhan === false ? AccountantStatus.PENDING : AccountantStatus.CONFIRMED,
      enrollmentId: GD,
      recordedById: SALE,
      centerId: CS,
    },
  });

/** Yêu cầu QR mà PH đã gửi cách đây `gioTruocGui` giờ. */
const yeuCau = (gioTruocGui: number | null, o: { id?: string; trangThai?: string } = {}) =>
  db.hoaDonYeuCauNguoiMua.create({
    data: {
      id: o.id ?? YC,
      centerId: CS,
      orderId: DON,
      tokenHash: `${T}tok${o.id ?? ""}`,
      trangThai: o.trangThai ?? "DANG_MO",
      hetHanLuc: new Date(NOW.getTime() + 3_600_000),
      guiLuc: gioTruocGui === null ? null : gioTruoc(gioTruocGui),
      giaTriGocHash: {},
      taoBoiId: SALE,
    },
  });

async function dungFixture(o: { donData?: Record<string, unknown> } = {}) {
  await don();
  await db.center.create({ data: { id: CS, code: "FXTXD", name: "Cơ sở fixture TXD", slug: `${T}co-so`, address: "211 NHT", city: "Đà Nẵng" } });
  await db.orgUnit.create({ data: { id: OU, type: "CENTER", code: OU, name: "ĐV TXD", centerId: CS, path: `/${OU}/`, depth: 1 } });
  await db.cauHinhHoaDonCoSo.create({
    data: { centerId: CS, phapNhanMa: "SATA_ROBO", kyHieu: "1C99TSR", hieuLucTu: new Date("2699-01-01T00:00:00Z"), hieuLucDen: new Date("2699-12-31T00:00:00Z"), dangBat: true, taoBoiId: SALE, capNhatBoiId: SALE },
  });
  await db.course.create({ data: { id: KHOA, name: "Sata 4 fixture", slug: `${T}sata-4` } });
  await db.class.create({ data: { id: LOP, name: "Lớp TXD", courseId: KHOA } });
  await db.student.create({ data: { id: HS, name: "Trần Bảo An" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA, finalPrice: 3_000_000 } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269930-000888",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "Nguyễn Văn Ba",
      customerPhone: "0999000888",
      customerEmail: "ba-txd@example.com",
      totalAmount: 3_000_000,
      centerId: CS,
      studentId: HS,
      ...DON_DU_NGUOI_MUA,
      ...(o.donData ?? {}),
    },
  });
  for (const k of ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.misaPhatHanh", "hoaDon.hubNguoiMua"]) await batSetting(k);
  await db.centerSetting.create({ data: { orgUnitId: OU, key: "hoaDon.hubThiDiem", valueJson: true } });
  // BGĐ 04/11/2026: ký / phát hành TỰ ĐỘNG đòi pháp nhân đã khai hạn mức (chưa khai ⇒ không tự ký). Fixture khai hạn mức RỘNG cho cả hai pháp nhân dùng trong file.
  for (const pn of ["SATA_ROBO", "NEW_VISION"]) {
    await db.hoaDonKyChinhSach.create({
      data: { phapNhanMa: pn, hanMucMoiHoaDon: 500_000_000, hanMucMoiNgay: 2_000_000_000, soToiDa: 500, cuaSoPhut: 60, capNhatBoiId: SALE, lyDoCapNhat: "fixture hạn mức rộng" },
    });
  }
  h.cong = congGia();
}

const hoaDon = () => db.hoaDonDienTu.findMany({ where: { orderId: DON }, include: { khoan: true } });
const chay = (soGio = 2) => chayTuXuat({ soGio, now: NOW, conThoiGian: () => true });
const bat = async (soGio = 2) => {
  await batSetting("hoaDon.tuXuatBat");
  await batSetting("hoaDon.tuXuatSauGio", soGio);
};

describe.skipIf(!RUN_DB_TESTS)("[TXD] tự xuất hoá đơn sau n giờ — Postgres thật, cổng nhà cung cấp giả", () => {
  beforeEach(async () => {
    so = 0;
    await dungFixture();
  });
  afterAll(don);

  it("[TXD-01] công tắc TẮT ⇒ cron không đọc, không ghi gì (null), kể cả khi có yêu cầu đã quá giờ và lần thu đủ điều kiện", async () => {
    await khoan(P1, 3_000_000);
    await yeuCau(5);
    expect(await chayTuXuatCuaCron({ now: NOW, conThoiGian: () => true })).toBeNull();
    expect(await hoaDon()).toHaveLength(0);
    expect((await db.hoaDonYeuCauNguoiMua.findUniqueOrThrow({ where: { id: YC } })).trangThai).toBe("DANG_MO");
    expect(await db.auditLog.count({ where: { entityType: "HoaDonTuXuat" } })).toBe(0);
  });

  it("[TXD-02] CHƯA tới giờ (PH gửi 1 giờ trước, n = 2) ⇒ không xuất; ĐÚNG giờ (2 giờ) ⇒ xuất — đối chứng hai phía", async () => {
    await khoan(P1, 3_000_000);
    await bat(2);
    await yeuCau(1);
    expect(await chay()).toMatchObject({ yeuCauToiGio: 0, daXuat: 0 });
    expect(await hoaDon()).toHaveLength(0);
    await db.hoaDonYeuCauNguoiMua.update({ where: { id: YC }, data: { guiLuc: gioTruoc(2) } });
    expect(await chay()).toMatchObject({ yeuCauToiGio: 1, daXuat: 1 });
    expect(await hoaDon()).toHaveLength(1);
  });

  it("[TXD-03] tới giờ ⇒ MỘT hoá đơn thật, người mua = thông tin PH KHAI (không phải «người tiêu dùng»), do «hệ thống» bấm; yêu cầu ĐÓNG (DA_AP_DUNG) kèm nhật ký; nhật ký tổng kết không mang tên", async () => {
    await khoan(P1, 3_000_000);
    await bat();
    await yeuCau(3);
    const kq = (await chayTuXuatCuaCron({ now: NOW, conThoiGian: () => true }))!;
    expect(kq).toMatchObject({ soGio: 2, yeuCauToiGio: 1, daXuat: 1, daDongYeuCau: 1, loiPhatHanh: 0 });
    const hd = await hoaDon();
    expect(hd).toHaveLength(1);
    expect(hd[0]).toMatchObject({ trangThai: "DA_XAC_NHAN", nguoiMuaTen: "Lê Thị Phụ Huynh TXD", nguoiMuaDiaChi: "5 Hoàng Diệu, Đà Nẵng", taoBoiId: "system" });
    expect(hd[0]!.nguoiMuaTen).not.toBe("Trần Bảo An");
    const bd = await db.auditLog.findFirstOrThrow({ where: { action: "BAT_DAU_PHAT_HANH_MISA", entityId: hd[0]!.id } });
    expect(bd.newValues).not.toHaveProperty("loDem");
    expect((await db.hoaDonYeuCauNguoiMua.findUniqueOrThrow({ where: { id: YC } })).trangThai).toBe("DA_AP_DUNG");
    expect(await db.auditLog.count({ where: { entityType: "HoaDonYeuCauNguoiMua", entityId: YC, action: "DONG_YEU_CAU_SAU_TU_XUAT" } })).toBe(1);
    const log = await db.auditLog.findMany({ where: { entityType: "HoaDonTuXuat", action: "TU_XUAT_CHAY" } });
    expect(log).toHaveLength(1);
    expect(JSON.stringify(log[0])).not.toMatch(/Lê Thị Phụ Huynh|Trần Bảo An/);
    expect((h.cong as ReturnType<typeof congGia>).daGui).toHaveLength(1);
  });

  it("[TXD-04] chạy LẦN HAI ⇒ không phát hành lần hai (yêu cầu đã đóng); lượt trống không rải thêm nhật ký", async () => {
    await khoan(P1, 3_000_000);
    await bat();
    await yeuCau(3);
    await chayTuXuatCuaCron({ now: NOW, conThoiGian: () => true });
    const kq = (await chayTuXuatCuaCron({ now: NOW, conThoiGian: () => true }))!;
    expect(kq).toMatchObject({ yeuCauToiGio: 0, daXuat: 0 });
    expect(await hoaDon()).toHaveLength(1);
    expect((h.cong as ReturnType<typeof congGia>).daGui).toHaveLength(1);
    expect(await db.auditLog.count({ where: { entityType: "HoaDonTuXuat" } })).toBe(1);
  });

  it("[TXD-05] khoản CHƯA được kế toán xác nhận ⇒ KHÔNG xuất, KHÔNG tự xác nhận tiền (khoản vẫn PENDING), yêu cầu còn mở; kế toán xác nhận xong ⇒ lượt sau xuất", async () => {
    await khoan(P1, 3_000_000, { xacNhan: false });
    await bat();
    await yeuCau(3);
    const kq = await chay();
    expect(kq).toMatchObject({ yeuCauToiGio: 1, daXuat: 0, daDongYeuCau: 0 });
    expect(kq.boQua.KHOAN_CHUA_XAC_NHAN).toBe(1);
    expect(await hoaDon()).toHaveLength(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).accountantStatus).toBe("PENDING");
    expect(await db.receipt.count({ where: { paymentId: P1 } })).toBe(0);
    expect((await db.hoaDonYeuCauNguoiMua.findUniqueOrThrow({ where: { id: YC } })).trangThai).toBe("DANG_MO");
    await db.payment.update({ where: { id: P1 }, data: { accountantStatus: "CONFIRMED" } });
    expect(await chay()).toMatchObject({ daXuat: 1, daDongYeuCau: 1 });
  });

  it("[TXD-06] thông tin người mua trên đơn còn THIẾU ⇒ máy phát hành từ chối, KHÔNG hoá đơn, yêu cầu còn mở (không bao giờ xuất «tiêu dùng» thay thế)", async () => {
    await dungFixture({ donData: { invoiceBuyerName: null, customerAddress: null, customerCity: null, invoiceCompanyName: "Công ty chưa đủ" } });
    await khoan(P1, 3_000_000);
    await bat();
    await yeuCau(3);
    const kq = await chay();
    expect(kq.daXuat).toBe(0);
    expect(kq.boQua.PHAT_HANH_TU_CHOI).toBe(1);
    expect(await hoaDon()).toHaveLength(0);
    expect((await db.hoaDonYeuCauNguoiMua.findUniqueOrThrow({ where: { id: YC } })).trangThai).toBe("DANG_MO");
  });

  it("[TXD-07] Sale SỬA ĐƠN sau khi PH gửi, trước giờ tự xuất ⇒ hoá đơn mang bản Sale sửa (ai ghi sau thắng)", async () => {
    await khoan(P1, 3_000_000);
    await bat();
    await yeuCau(3);
    await db.order.update({ where: { id: DON }, data: { invoiceBuyerName: "Tên Sale sửa lại TXD" } });
    await chay();
    expect((await hoaDon())[0]).toMatchObject({ nguoiMuaTen: "Tên Sale sửa lại TXD" });
  });

  it("[TXD-08] HAI lần thu ⇒ HAI hoá đơn (mỗi lần thu một hoá đơn), cả hai mang cùng người mua; yêu cầu đóng một lần", async () => {
    await khoan(P1, 1_000_000, { paid: gioTruoc(30) });
    await khoan(P2, 2_000_000, { paid: gioTruoc(1) });
    await bat();
    await yeuCau(3);
    const kq = await chay();
    expect(kq).toMatchObject({ daXuat: 2, daDongYeuCau: 1 });
    const hd = await hoaDon();
    expect(hd).toHaveLength(2);
    expect(new Set(hd.map((x) => x.nguoiMuaTen))).toEqual(new Set(["Lê Thị Phụ Huynh TXD"]));
  });

  it("[TXD-09] KHÔNG có cửa sổ ngày thu (khác lô 23h): lần thu 10 ngày trước VẪN xuất khi PH vừa điền form", async () => {
    await khoan(P1, 3_000_000, { paid: gioTruoc(240) });
    await bat();
    await yeuCau(3);
    expect(await chay()).toMatchObject({ daXuat: 1 });
  });

  it("[TXD-10] yêu cầu PH gửi quá 7 ngày mà chưa xuất ⇒ ngừng tự xuất (kế toán xử lý tay); đối chứng: gần 7 ngày vẫn xuất", async () => {
    await khoan(P1, 3_000_000);
    await bat();
    await yeuCau(7 * 24 + 1);
    expect(await chay()).toMatchObject({ yeuCauToiGio: 0, daXuat: 0 });
    expect(await hoaDon()).toHaveLength(0);
    await db.hoaDonYeuCauNguoiMua.update({ where: { id: YC }, data: { guiLuc: gioTruoc(7 * 24 - 1) } });
    expect(await chay()).toMatchObject({ yeuCauToiGio: 1, daXuat: 1 });
  });

  it("[TXD-11] chạm hạn mức mỗi hoá đơn ⇒ KHÔNG tự xuất: không bản, không khoá khoản, yêu cầu CÒN MỞ, nhà cung cấp không bị gọi; kế toán nhận MỘT tin gộp; nâng hạn mức ⇒ lượt sau xuất (không báo lại)", async () => {
    await khoan(P1, 3_000_000);
    await bat();
    await yeuCau(5);
    await db.hoaDonKyChinhSach.updateMany({ data: { hanMucMoiHoaDon: 1_000_000 } });
    const cong = h.cong as CongHoaDon & { daGui: PhieuPhatHanh[] };
    expect(await chay()).toMatchObject({ daXuat: 0, daDongYeuCau: 0 });
    expect(cong.daGui).toHaveLength(0);
    expect(await hoaDon()).toHaveLength(0);
    expect((await db.hoaDonYeuCauNguoiMua.findUniqueOrThrow({ where: { id: YC } })).trangThai).toBe("DANG_MO");
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0]![0].dedupeKey).toMatch(/^hoa-don\.han-muc:[A-Z_]+:\d{4}-\d{2}-\d{2}:CHO$/);
    await db.hoaDonKyChinhSach.updateMany({ data: { hanMucMoiHoaDon: 500_000_000 } });
    expect(await chay()).toMatchObject({ daXuat: 1, daDongYeuCau: 1 });
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("[TXD-11] PH CHƯA gửi gì (guiLuc rỗng) ⇒ không xuất; yêu cầu đã thu hồi / hết hạn ⇒ không xuất — đối chứng dương ở [TXD-03]", async () => {
    await khoan(P1, 3_000_000);
    await bat();
    await yeuCau(null);
    expect(await chay()).toMatchObject({ yeuCauToiGio: 0, daXuat: 0 });
    for (const trangThai of ["THU_HOI", "HET_HAN"]) {
      await db.hoaDonYeuCauNguoiMua.update({ where: { id: YC }, data: { guiLuc: gioTruoc(5), trangThai } });
      expect(await chay(), trangThai).toMatchObject({ yeuCauToiGio: 0, daXuat: 0 });
    }
    expect(await hoaDon()).toHaveLength(0);
  });

  it("[TXD-12] cơ sở KHÔNG thí điểm, hoặc luồng QR (`hubNguoiMua`) TẮT ⇒ không đụng; bật lại ⇒ xuất", async () => {
    await khoan(P1, 3_000_000);
    await bat();
    await yeuCau(3);
    await db.centerSetting.deleteMany({ where: { orgUnitId: OU } });
    expect(await chay()).toMatchObject({ yeuCauToiGio: 0, daXuat: 0 });
    await db.centerSetting.create({ data: { orgUnitId: OU, key: "hoaDon.hubThiDiem", valueJson: true } });
    await batSetting("hoaDon.hubNguoiMua", false);
    expect(await chay()).toMatchObject({ yeuCauToiGio: 0, daXuat: 0 });
    expect(await hoaDon()).toHaveLength(0);
    await batSetting("hoaDon.hubNguoiMua", true);
    expect(await chay()).toMatchObject({ daXuat: 1 });
  });

  it("[TXD-13] số giờ lấy từ CẤU HÌNH: n = 4 mà PH gửi 3 giờ trước ⇒ chưa xuất; đổi n = 3 ⇒ xuất (không có hằng ẩn)", async () => {
    await khoan(P1, 3_000_000);
    await bat(4);
    await yeuCau(3);
    expect(await chayTuXuatCuaCron({ now: NOW, conThoiGian: () => true })).toMatchObject({ soGio: 4, yeuCauToiGio: 0, daXuat: 0 });
    await batSetting("hoaDon.tuXuatSauGio", 3);
    expect(await chayTuXuatCuaCron({ now: NOW, conThoiGian: () => true })).toMatchObject({ soGio: 3, daXuat: 1 });
  });

  it("[TXD-14] hết thời gian của lượt (`conThoiGian` = false) ⇒ dừng sớm, không phát hành; lượt sau làm tiếp", async () => {
    await khoan(P1, 3_000_000);
    await bat();
    await yeuCau(3);
    const kq = await chayTuXuat({ soGio: 2, now: NOW, conThoiGian: () => false });
    expect(kq).toMatchObject({ dungSom: true, daXuat: 0 });
    expect(await hoaDon()).toHaveLength(0);
    expect(await chay()).toMatchObject({ daXuat: 1 });
  });
});
