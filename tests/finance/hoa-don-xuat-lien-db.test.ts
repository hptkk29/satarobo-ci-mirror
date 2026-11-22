// Ca [XLIEN-*] — «XUẤT LIỀN» của Sale (BGĐ đổi yêu cầu 09/11/2026) trên Postgres THẬT, cổng nhà cung cấp GIẢ.
//
// Canh những thứ test thuần KHÔNG chứng minh được (xuất liền là chuỗi: xem trước → dấu đối chiếu → hàng chờ → phiếu → máy phát hành → đóng yêu cầu → xếp thư ngay):
//   · xem trước CHỈ cho đơn có thông tin người mua RIÊNG và ĐỦ; khoản chưa được kế toán xác nhận thì KHÔNG xuất liền (Sale không xác nhận tiền);
//   · xuất liền ⇒ hoá đơn mang ĐÚNG thông tin đã khai (không thay bằng tên học viên), người bấm là CHÍNH Sale (taoBoiId + nhật ký XUAT_LIEN), yêu cầu bị ĐÓNG, thư được xếp NGAY;
//   · không tạo được hoá đơn nào ⇒ KHÔNG đóng yêu cầu, KHÔNG đụng hàng đợi thư; chạy lần hai không xuất lần hai.
// Cơ sở fixture là cơ sở thí điểm DUY NHẤT. Không gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dispatch: vi.fn(async () => ({ skipped: false, claimed: 1, done: 1, retried: 0, failed: 0 })),
  hangDoi: vi.fn(async (_n: number, _o: { guiHoaDon: boolean }) => ({ sent: 1, failed: 0 })),
  cong: null as null | import("@/lib/misa/meinvoice/cong").CongHoaDon,
  notify: vi.fn(async (_p: { userIds: string[]; dedupeKey: string; title: string; body: string; href: string }) => 1),
}));
// Cảnh báo chạm hạn mức đi qua `notifyStaff` + `timKeToan`: giả lập để ca KHÔNG ghi thông báo thật và kiểm được nội dung/khoá.
vi.mock("@/lib/notifications/nguoi-nhan-phia-sale", () => ({ nguoiNhanPhiaSale: async () => ["fx-xld-sale-phu-trach"] }));
vi.mock("@/lib/events/register", () => ({ ensureHandlersRegistered: () => undefined }));
vi.mock("@/lib/events/dispatcher", () => ({ dispatchPendingEvents: h.dispatch }));
vi.mock("@/lib/email/queue", () => ({ processEmailQueue: h.hangDoi }));
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
import { baoSaleHoaDonDaXuat } from "@/lib/finance/hoa-don/gui-email";
import { xuatLienDon } from "@/lib/finance/hoa-don/xuat-lien/chay-xuat-lien";
import { doiSoatPhatHanhTreo } from "@/lib/finance/hoa-don/phat-hanh-misa";
import { xemTruocXuatLien } from "@/lib/finance/hoa-don/xuat-lien";

if (!RUN_DB_TESTS) console.warn(`[XLIEN] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-xld-";
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
const NOW = new Date("2699-09-30T16:00:00Z"); // 23:00 VN ngày 30/09/2699
const HOM_NAY_SANG = new Date("2699-09-30T02:00:00Z"); // 09:00 VN cùng ngày
const KEY_SETTINGS = ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.misaPhatHanh", "hoaDon.hubNguoiMua"];
const PDF = new TextEncoder().encode("%PDF-1.7 hoa don gia");
const XML = new TextEncoder().encode("<?xml version='1.0'?><HDon/>");

let so = 0;
function congGia(): CongHoaDon & { daGui: PhieuPhatHanh[] } {
  const c = {
    cheDo: "HSM" as const,
    moiTruong: "sandbox" as const,
    daGui: [] as PhieuPhatHanh[],
    async phatHanh(phieu: PhieuPhatHanh) {
      c.daGui.push(phieu);
      const s = String(++so + 5000);
      return { loai: "DA_PHAT_HANH" as const, refId: phieu.refId, kyHieu: "1C99TSR", soHoaDon: s, ngayPhatHanh: new Date("2699-09-30T16:00:00Z"), maTraCuu: `TRA-${s}` };
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
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: hdIds } }, { entityId: { startsWith: T } }, { entityId: { startsWith: "lo-dem:2699" } }] } });
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
  await db.hoaDonKetNoiNhaCungCap.deleteMany({ where: { capNhatBoiId: SALE } });
  await db.hoaDonKyChinhSach.deleteMany({ where: { capNhatBoiId: SALE } });
  await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
  await db.center.deleteMany({ where: { id: CS } });
}

const batSetting = (key: string, v = true) => db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });

const khoan = (id: string, amount: number, o: { xacNhan?: boolean; paid?: Date } = {}) =>
  db.payment.create({
    data: {
      id,
      orderId: DON,
      amount,
      method: "CASH",
      paidDate: o.paid ?? HOM_NAY_SANG,
      saleStatus: SaleStatus.RECORDED,
      accountantStatus: o.xacNhan === false ? AccountantStatus.PENDING : AccountantStatus.CONFIRMED,
      enrollmentId: GD,
      recordedById: SALE,
      centerId: CS,
    },
  });

async function dungFixture(o: { donData?: Record<string, unknown> } = {}) {
  await don();
  await db.center.create({ data: { id: CS, code: "FXLDD", name: "Cơ sở fixture LDD", slug: `${T}co-so`, address: "211 NHT", city: "Đà Nẵng" } });
  await db.orgUnit.create({ data: { id: OU, type: "CENTER", code: OU, name: "ĐV LDD", centerId: CS, path: `/${OU}/`, depth: 1 } });
  await db.cauHinhHoaDonCoSo.create({
    data: {
      centerId: CS,
      phapNhanMa: "SATA_ROBO",
      kyHieu: "1C99TSR",
      hieuLucTu: new Date("2699-01-01T00:00:00Z"),
      hieuLucDen: new Date("2699-12-31T00:00:00Z"),
      dangBat: true,
      taoBoiId: SALE,
      capNhatBoiId: SALE,
    },
  });
  await db.course.create({ data: { id: KHOA, name: "Sata 4 fixture", slug: `${T}sata-4` } });
  await db.class.create({ data: { id: LOP, name: "Lớp LDD", courseId: KHOA } });
  await db.student.create({ data: { id: HS, name: "Trần Bảo An" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA, finalPrice: 3_000_000 } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269930-000777",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "Nguyễn Văn Ba",
      customerPhone: "0999000777",
      customerEmail: "ba-ldd@example.com",
      totalAmount: 3_000_000,
      centerId: CS,
      studentId: HS,
      ...(o.donData ?? {}),
    },
  });
  // Cài đặt: màn + công tắc tổng + phát hành + (mỗi ca tự bật hai công tắc lô); thí điểm CHỈ cho cơ sở fixture.
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


const DA_KHAI = { invoiceBuyerName: "Lê Thị Mẹ", customerAddress: "5 Hoàng Diệu", customerCity: "Đà Nẵng", customerCccd: "048123456789" };
const NGUOI_BAM = { id: SALE, name: "Sale XLD" };
const xuat = () => xuatLienDon({ orderId: DON, centerId: CS, nguoiBam: NGUOI_BAM, now: NOW });
let idYeuCau = "";
const yeuCau = async () => {
  const y = await db.hoaDonYeuCauNguoiMua.create({
    data: { centerId: CS, orderId: DON, tokenHash: `${T}tok`, trangThai: "DANG_MO", guiLuc: new Date("2699-09-30T05:00:00Z"), hetHanLuc: new Date("2699-09-30T20:00:00Z"), giaTriGocHash: {}, taoBoiId: SALE },
  });
  idYeuCau = y.id;
  return y;
};
const trangThaiYeuCau = async () => (await db.hoaDonYeuCauNguoiMua.findFirstOrThrow({ where: { orderId: DON } })).trangThai;

describe.skipIf(!RUN_DB_TESTS)("[XLIEN] xuất liền — Postgres thật, cổng nhà cung cấp giả", () => {
  beforeEach(async () => {
    so = 0;
    h.dispatch.mockClear();
    h.hangDoi.mockClear();
    h.notify.mockClear();
    await dungFixture({ donData: DA_KHAI });
  });
  afterAll(don);

  it("[XLIEN-01] xem trước: đơn có thông tin RIÊNG và ĐỦ ⇒ người mua + học viên + email nhận + từng lần thu + tổng + dấu đối chiếu", async () => {
    await khoan(P1, 3_000_000);
    const xt = await xemTruocXuatLien({ orderId: DON, centerId: CS });
    expect(xt).toMatchObject({ ok: true, tongTien: 3_000_000, hocVien: "Trần Bảo An", emailNhan: "ba-ldd@example.com" });
    if (!xt.ok) return;
    expect(xt.nguoiMua).toMatchObject({ hoTen: "Lê Thị Mẹ", cccd: "048123456789" });
    expect(xt.lanThu).toHaveLength(1);
    expect(xt.dauVan.length).toBeGreaterThan(20);
    // xem trước KHÔNG đụng gì: không hoá đơn, không gọi nhà cung cấp
    expect(await hoaDon()).toHaveLength(0);
    expect((h.cong as ReturnType<typeof congGia>).daGui).toHaveLength(0);
  });

  it("[XLIEN-02] dấu đối chiếu ĐỔI khi thông tin đổi (phụ huynh gửi lại) hoặc khi có thêm lần thu — để máy chủ biết Sale đang xem bản cũ", async () => {
    await khoan(P1, 3_000_000);
    const a = await xemTruocXuatLien({ orderId: DON, centerId: CS });
    await db.order.update({ where: { id: DON }, data: { customerAddress: "6 Hoàng Diệu" } });
    const b = await xemTruocXuatLien({ orderId: DON, centerId: CS });
    expect(a.ok && b.ok && a.dauVan !== b.dauVan).toBe(true);
    await khoan(P2, 1_000_000, { paid: new Date("2699-09-30T03:00:00Z") });
    const c = await xemTruocXuatLien({ orderId: DON, centerId: CS });
    expect(b.ok && c.ok && b.dauVan !== c.dauVan).toBe(true);
    // đối chứng: không đổi gì ⇒ dấu y nguyên
    const d = await xemTruocXuatLien({ orderId: DON, centerId: CS });
    expect(c.ok && d.ok && c.dauVan === d.dauVan).toBe(true);
  });

  it("[XLIEN-03] đơn KHÔNG có thông tin người mua riêng ⇒ không xuất liền (việc của lô cuối ngày, không phải «xuất đúng tờ phụ huynh xin»); đối chứng: có thông tin thì được", async () => {
    await dungFixture();
    await khoan(P1, 3_000_000);
    expect(await xemTruocXuatLien({ orderId: DON, centerId: CS })).toMatchObject({ ok: false, error: expect.stringMatching(/chưa có thông tin người mua riêng/) });
    await db.order.update({ where: { id: DON }, data: DA_KHAI });
    expect((await xemTruocXuatLien({ orderId: DON, centerId: CS })).ok).toBe(true);
  });

  it("[XLIEN-04] khoản CHƯA được kế toán xác nhận ⇒ không xuất liền, lý do nói rõ «Sale không xác nhận tiền được»; khoản vẫn PENDING, không hoá đơn, không phiếu thu", async () => {
    await khoan(P1, 3_000_000, { xacNhan: false });
    const xt = await xemTruocXuatLien({ orderId: DON, centerId: CS });
    expect(xt).toMatchObject({ ok: false, error: expect.stringMatching(/kế toán xác nhận/) });
    const r = await xuat();
    expect(r.taoDuoc).toBe(0);
    expect(await hoaDon()).toHaveLength(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).accountantStatus).toBe("PENDING");
    expect(await db.receipt.count({ where: { paymentId: P1 } })).toBe(0);
  });

  it("[XLIEN-05] thông tin đã khai NỬA CHỪNG (tên công ty, thiếu MST) ⇒ xem trước từ chối và nói thiếu gì", async () => {
    await dungFixture({ donData: { invoiceCompanyName: "Công ty ABC", customerAddress: "5 Hoàng Diệu" } });
    await khoan(P1, 3_000_000);
    expect(await xemTruocXuatLien({ orderId: DON, centerId: CS })).toMatchObject({ ok: false, error: expect.stringMatching(/thiếu.*(Mã số thuế|MST)/i) });
  });

  it("[XLIEN-06] XUẤT LIỀN: MỘT hoá đơn DA_XAC_NHAN mang ĐÚNG thông tin đã khai (không phải tên học viên), người bấm = Sale, gửi nhà cung cấp đúng một lần, yêu cầu bị ĐÓNG, thư được xếp NGAY (sự kiện rồi hàng đợi, đúng thứ tự)", async () => {
    await khoan(P1, 3_000_000);
    await yeuCau();
    const r = await xuat();
    expect(r).toMatchObject({ taoDuoc: 1, daXuat: 1, loiPhatHanh: 0, guiNgay: true });
    expect(r.mili).toBeGreaterThanOrEqual(0);
    const hd = await hoaDon();
    expect(hd).toHaveLength(1);
    expect(hd[0]).toMatchObject({ trangThai: "DA_XAC_NHAN", nguoiMuaTen: "Lê Thị Mẹ", nguoiMuaDiaChi: "5 Hoàng Diệu, Đà Nẵng", taoBoiId: SALE });
    expect((h.cong as ReturnType<typeof congGia>).daGui).toHaveLength(1);
    expect(await trangThaiYeuCau()).toBe("DA_AP_DUNG");
    // thư: sự kiện được phát đi RỒI hàng đợi chạy, mỗi bên đúng một lần, và hàng đợi nhận cờ hoá đơn
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.hangDoi).toHaveBeenCalledTimes(1);
    expect(h.dispatch.mock.invocationCallOrder[0]!).toBeLessThan(h.hangDoi.mock.invocationCallOrder[0]!);
    // nhật ký: Sale là người bấm, không PII
    const au = await db.auditLog.findFirstOrThrow({ where: { action: "XUAT_LIEN", entityId: DON } });
    expect(au).toMatchObject({ actorId: SALE, actorName: "Sale XLD" });
    expect(JSON.stringify(au.newValues)).not.toMatch(/Lê Thị Mẹ|048123456789|Hoàng Diệu/);
    const dong = await db.auditLog.findFirst({ where: { action: "DONG_YEU_CAU_SAU_TU_XUAT", entityId: idYeuCau } });
    expect(dong?.actorName).toContain("xuất liền");
    // [09/11/2026] hoá đơn CÓ ⇒ MỘT sự kiện chung «đã xuất» (cùng giao dịch, đúng khoá chống trùng); handler báo Sale phụ trách + CHÍNH Sale đã bấm
    expect(await db.domainEvent.count({ where: { type: "hoa-don.da-xuat", dedupeKey: `hoa-don.da-xuat:${hd[0]!.id}` } })).toBe(1);
    expect(await baoSaleHoaDonDaXuat(hd[0]!.id, NOW)).toBeGreaterThanOrEqual(0);
    const bao = h.notify.mock.calls.map((c) => c[0]).filter((p) => p.dedupeKey.startsWith("hoa-don.da-xuat:"));
    expect(bao).toHaveLength(1);
    expect([...bao[0]!.userIds].sort()).toEqual(["fx-xld-sale-phu-trach", SALE].sort());
    expect(bao[0]).toMatchObject({ dedupeKey: `hoa-don.da-xuat:${hd[0]!.id}`, href: `/orders/${DON}#hoa-don` });
    expect(bao[0]!.title).toContain("1C99TSR");
    expect(bao[0]!.body).toContain("Xuất liền");
    expect(bao[0]!.body).toContain("đang được gửi"); // «Xuất liền» đi NGAY, không hẹn 8h sáng
    expect(JSON.stringify(bao[0])).not.toMatch(/Lê Thị Mẹ|048123456789|Hoàng Diệu/); // không PII (không CCCD / địa chỉ)
  });

  it("[XLIEN-07] bấm LẦN HAI ⇒ không xuất lần hai (lần thu đã rời «Chờ xuất»): xem trước từ chối, xuất liền không tạo thêm hoá đơn / không gọi nhà cung cấp / không động tới thư", async () => {
    await khoan(P1, 3_000_000);
    await xuat();
    h.dispatch.mockClear();
    h.hangDoi.mockClear();
    expect((await xemTruocXuatLien({ orderId: DON, centerId: CS })).ok).toBe(false);
    const r = await xuat();
    expect(r.taoDuoc).toBe(0);
    expect(await hoaDon()).toHaveLength(1);
    expect((h.cong as ReturnType<typeof congGia>).daGui).toHaveLength(1);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("[XLIEN-08] cổng nhà cung cấp CHƯA cấu hình ⇒ không hoá đơn, không bản DANG_PHAT_HANH mồ côi, yêu cầu KHÔNG bị đóng (phụ huynh / Sale còn sửa được), hàng đợi thư KHÔNG bị động; lý do nằm ở kết quả", async () => {
    await khoan(P1, 3_000_000);
    await yeuCau();
    h.cong = null;
    const r = await xuat();
    expect(r.taoDuoc).toBe(0);
    expect(r.dong.some((d) => d.lyDo) || r.lyDo.length > 0).toBe(true); // Sale luôn biết vì sao không xuất
    expect(await hoaDon()).toHaveLength(0);
    expect(await trangThaiYeuCau()).toBe("DANG_MO");
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.hangDoi).not.toHaveBeenCalled();
    expect(await db.domainEvent.count({ where: { type: "hoa-don.da-xuat", dedupeKey: { contains: DON } } })).toBe(0); // chưa có hoá đơn thật ⇒ chưa có sự kiện «đã xuất»
  });

  it("[XLIEN-09] hai lần thu của CÙNG đơn ⇒ HAI hoá đơn riêng (mỗi lần thu một tờ, như lô cuối ngày), cùng thông tin người mua", async () => {
    await khoan(P1, 3_000_000);
    await khoan(P2, 1_000_000, { paid: new Date("2699-09-29T03:00:00Z") });
    const r = await xuat();
    expect(r).toMatchObject({ taoDuoc: 2, daXuat: 2 });
    const hd = await hoaDon();
    expect(hd).toHaveLength(2);
    expect(hd.every((x) => x.nguoiMuaTen === "Lê Thị Mẹ" && x.trangThai === "DA_XAC_NHAN")).toBe(true);
    expect(hd.flatMap((x) => x.khoan.map((k) => k.paymentId)).sort()).toEqual([P1, P2]);
  });

  it("[XLIEN-11] nhà cung cấp trả KHÔNG RÕ (hoá đơn ĐANG PHÁT HÀNH, chưa xác nhận) ⇒ vẫn đóng yêu cầu (đã có hoá đơn), nhưng KHÔNG xếp thư: chưa có tờ hoá đơn nào để gửi — cron đối soát hoàn tất rồi mới gửi", async () => {
    await khoan(P1, 3_000_000);
    await yeuCau();
    const cong = h.cong as unknown as { phatHanh: (p: PhieuPhatHanh) => Promise<unknown> };
    cong.phatHanh = async () => ({ loai: "KHONG_RO" as const, thongDiep: "Nhà cung cấp chưa trả lời rõ" });
    const r = await xuat();
    expect(r).toMatchObject({ taoDuoc: 1, daXuat: 0, dangPhatHanh: 1, guiNgay: false });
    expect((await hoaDon())[0]).toMatchObject({ trangThai: "DANG_PHAT_HANH" });
    expect(await trangThaiYeuCau()).toBe("DA_AP_DUNG");
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.hangDoi).not.toHaveBeenCalled();
    expect(await db.domainEvent.count({ where: { type: "hoa-don.da-xuat", dedupeKey: { startsWith: "hoa-don.da-xuat:" }, payloadJson: { path: ["hoaDonId"], equals: (await hoaDon())[0]!.id } } })).toBe(0); // đang phát hành (nhà cung cấp chưa trả lời rõ) ⇒ CHƯA có sự kiện «đã xuất»
  });

  it("[XLIEN-12] nhà cung cấp trả lời MUỘN: «Xuất liền» thấy ĐANG PHÁT HÀNH (chưa báo), cron đối soát hoàn tất sau ⇒ lúc đó Sale mới được BÁO «đã xuất xong» (đúng một lần, kể cả đối soát chạy lại); thư xếp qua sự kiện như thường", async () => {
    await khoan(P1, 3_000_000);
    await yeuCau();
    const cong = h.cong as unknown as { phatHanh: (p: PhieuPhatHanh) => Promise<unknown>; traCuu: (r?: string) => Promise<unknown> };
    cong.phatHanh = async () => ({ loai: "KHONG_RO" as const, thongDiep: "Nhà cung cấp chưa trả lời rõ" });
    await xuat();
    const hd0 = (await hoaDon())[0]!;
    expect(hd0.trangThai).toBe("DANG_PHAT_HANH");
    expect(await db.domainEvent.count({ where: { dedupeKey: `hoa-don.da-xuat:${hd0.id}` } })).toBe(0);
    // nhà cung cấp nay đã có hoá đơn
    cong.traCuu = async () => ({ loai: "DA_PHAT_HANH" as const, refId: hd0.misaRefId, kyHieu: "1C99TSR", soHoaDon: "9001", ngayPhatHanh: new Date("2699-09-30T16:00:00Z"), maTraCuu: "TRA-9001" });
    const sau = new Date(NOW.getTime() + 15 * 60_000);
    await doiSoatPhatHanhTreo({ cong: h.cong, now: sau, slaKhongRoPhut: null });
    expect((await hoaDon())[0]).toMatchObject({ trangThai: "DA_XAC_NHAN", soHoaDon: "9001" });
    // hoàn tất MUỘN (cron đối soát) cũng phát sự kiện «đã xuất» — đúng một lần dù đối soát chạy lại; handler báo cả Sale đã bấm (dấu `xuatLien` nằm ở nhật ký bắt đầu)
    expect(await db.domainEvent.count({ where: { dedupeKey: `hoa-don.da-xuat:${hd0.id}` } })).toBe(1);
    await doiSoatPhatHanhTreo({ cong: h.cong, now: new Date(sau.getTime() + 60_000), slaKhongRoPhut: null });
    expect(await db.domainEvent.count({ where: { dedupeKey: `hoa-don.da-xuat:${hd0.id}` } })).toBe(1);
    await baoSaleHoaDonDaXuat(hd0.id, NOW);
    const bao = h.notify.mock.calls.map((c) => c[0]).filter((p) => p.dedupeKey === `hoa-don.da-xuat:${hd0.id}`);
    expect(bao).toHaveLength(1);
    expect(bao[0]!.userIds).toContain(SALE);
  });

  it("[XLIEN-10] lỗi ở bước xếp thư KHÔNG làm mất kết quả: hoá đơn vẫn xuất, `guiNgay=false` (thư để nhịp cron gửi tiếp)", async () => {
    await khoan(P1, 3_000_000);
    h.hangDoi.mockRejectedValueOnce(new Error("hàng đợi chết"));
    const r = await xuat();
    expect(r).toMatchObject({ taoDuoc: 1, daXuat: 1, guiNgay: false });
    expect(await hoaDon()).toHaveLength(1);
  });
});
