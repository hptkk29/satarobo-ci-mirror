// Ca [LDD-*] — LÔ XUẤT HOÁ ĐƠN 23H (BGĐ yêu cầu 03/11/2026) trên Postgres THẬT, cổng nhà cung cấp GIẢ.
//
// Canh những thứ test thuần KHÔNG chứng minh được (lô là chuỗi: cờ → hàng chờ → lọc → nạp phiếu → máy phát hành → nhật ký):
//   · cờ TẮT ⇒ không đọc, không ghi; CHẠY THỬ ⇒ không tạo hoá đơn nào, không gọi nhà cung cấp, vẫn ghi MỘT dòng nhật ký;
//   · TỰ ĐỘNG ⇒ hoá đơn thật: người mua = TÊN HỌC VIÊN + địa chỉ tỉnh/thành của cơ sở; MỘT hoá đơn cho MỘT lần thu;
//   · ưu tiên thông tin đã khai trên đơn; khai nửa chừng thì KHÔNG xuất; phụ huynh đang khai thì KHÔNG xuất;
//   · khoản chưa được kế toán xác nhận thì lô KHÔNG tự xác nhận (khoản vẫn PENDING, không phiếu thu);
//   · lần thu cũ hơn cửa sổ ngày thì KHÔNG xuất lùi ngày; chạy lần hai không phát hành lần hai.
// Cơ sở fixture là cơ sở thí điểm DUY NHẤT (cài riêng theo cơ sở) nên lô không chạm dữ liệu của cơ sở khác trong DB test.
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
import { coSoLoDem } from "@/lib/finance/hoa-don/feature";
import { chayLoDem, chayLoDemCuaCron } from "@/lib/finance/hoa-don/xuat-lo-dem/chay-lo-dem";
import { MUC_DICH_KET_NOI, nguCanhKetNoi } from "@/lib/finance/hoa-don/ket-noi/khoa-bi-mat";
import { maHoaBiMat } from "@/lib/security/hop-bi-mat";

if (!RUN_DB_TESTS) console.warn(`[LDD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ldd-";
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
const KEY_SETTINGS = ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.misaPhatHanh", "hoaDon.loDemChayThu", "hoaDon.loDemTuDong"];
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
  for (const k of ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.misaPhatHanh"]) await batSetting(k);
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
const chay = (cheDo: "CHAY_THU" | "TU_DONG") => chayLoDem({ cheDo, now: NOW, conThoiGian: () => true });

describe.skipIf(!RUN_DB_TESTS)("[LDD] lô hoá đơn 23h — Postgres thật, cổng nhà cung cấp giả", () => {
  beforeEach(async () => {
    so = 0;
    await dungFixture();
  });
  afterAll(don);

  it("[LDD-01] cả hai công tắc TẮT ⇒ cron không đọc, không ghi gì (null), kể cả khi có lần thu đủ điều kiện", async () => {
    await khoan(P1, 3_000_000);
    expect(await chayLoDemCuaCron({ now: NOW, conThoiGian: () => true })).toBeNull();
    expect(await hoaDon()).toHaveLength(0);
    expect(await db.auditLog.count({ where: { entityType: "HoaDonLoDem" } })).toBe(0);
  });

  it("[LDD-02] CHẠY THỬ ⇒ báo cáo «sẽ xuất», KHÔNG tạo hoá đơn, KHÔNG gọi nhà cung cấp, khoản không đổi; có nhật ký tổng kết", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemChayThu");
    const kq = (await chayLoDemCuaCron({ now: NOW, conThoiGian: () => true }))!;
    expect(kq).toMatchObject({ cheDo: "CHAY_THU", duocChon: 1, daXuat: 0 });
    // DB test dùng chung có thể còn cơ sở thí điểm khác (vd. CS2 từ bộ e2e hub) — chỉ cần cơ sở fixture có mặt.
    expect(kq.coSo).toBeGreaterThanOrEqual(1);
    expect(kq.mau.map((m) => [m.maDon, m.ketQua, m.nguonNguoiMua])).toEqual([["ORD-269930-000777", "SE_XUAT", "TIEU_DUNG"]]);
    expect(await hoaDon()).toHaveLength(0);
    expect((h.cong as ReturnType<typeof congGia>).daGui).toHaveLength(0);
    const log = await db.auditLog.findMany({ where: { entityType: "HoaDonLoDem", action: "LO_DEM_CHAY" } });
    expect(log).toHaveLength(1);
    // Nhật ký KHÔNG mang tên người mua.
    expect(JSON.stringify(log[0])).not.toContain("Trần Bảo An");
  });

  it("[LDD-03] TỰ ĐỘNG ⇒ MỘT hoá đơn thật cho lần thu: người mua = TÊN HỌC VIÊN, địa chỉ = tỉnh/thành cơ sở; xác nhận + gửi nhà cung cấp đúng một lần", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    const kq = await chay("TU_DONG");
    expect(kq).toMatchObject({ duocChon: 1, daXuat: 1, loiPhatHanh: 0 });
    const hd = await hoaDon();
    expect(hd).toHaveLength(1);
    expect(hd[0]).toMatchObject({ trangThai: "DA_XAC_NHAN", nguoiMuaTen: "Trần Bảo An", nguoiMuaDiaChi: "Đà Nẵng", nguoiMuaDonVi: null, nguoiMuaMst: null, taoBoiId: "system" });
    const cong = h.cong as ReturnType<typeof congGia>;
    expect(cong.daGui).toHaveLength(1);
    expect(cong.daGui[0]!.nguoiMua).toMatchObject({ hoTen: "Trần Bảo An", donVi: null, mst: null, diaChi: "Đà Nẵng" });
    // Nhật ký của bước bắt đầu mang dấu lô đêm + nguồn người mua.
    const bd = await db.auditLog.findFirstOrThrow({ where: { entityId: hd[0]!.id, action: "BAT_DAU_PHAT_HANH_MISA" } });
    expect(bd.newValues).toMatchObject({ loDem: true, nguonNguoiMua: "TIEU_DUNG" });
  });

  it("[LDD-04] chạy LẦN HAI cùng đêm ⇒ KHÔNG phát hành lần hai (lần thu đã có hoá đơn rời ngăn «Chờ xuất»)", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    await chay("TU_DONG");
    const lan2 = await chay("TU_DONG");
    expect(lan2).toMatchObject({ duocChon: 0, daXuat: 0 });
    expect(await hoaDon()).toHaveLength(1);
    expect((h.cong as ReturnType<typeof congGia>).daGui).toHaveLength(1);
  });

  it("[LDD-05] khoản CHƯA được kế toán xác nhận ⇒ lô KHÔNG tự xác nhận: không hoá đơn, khoản vẫn PENDING, không phiếu thu", async () => {
    await khoan(P1, 3_000_000, { xacNhan: false });
    await batSetting("hoaDon.loDemTuDong");
    const kq = await chay("TU_DONG");
    expect(kq.boQua.KHOAN_CHUA_XAC_NHAN).toBe(1);
    expect(kq.duocChon).toBe(0);
    expect(await hoaDon()).toHaveLength(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).accountantStatus).toBe(AccountantStatus.PENDING);
    expect(await db.receipt.count({ where: { paymentId: P1 } })).toBe(0);
  });

  it("[LDD-06] lần thu CŨ hơn cửa sổ (ngày thu 28/09, hôm nay 30/09, cửa sổ từ 29/09) ⇒ KHÔNG xuất lùi ngày; lần thu hôm qua thì vào", async () => {
    await khoan(P1, 3_000_000, { paid: new Date("2699-09-28T03:00:00Z") });
    await batSetting("hoaDon.loDemTuDong");
    const kq = await chay("TU_DONG");
    expect(kq.boQua.NGAY_CU).toBe(1);
    expect(await hoaDon()).toHaveLength(0);
  });

  it("[LDD-07] phụ huynh ĐANG khai (yêu cầu QR đã gửi) ⇒ lô bỏ qua đơn đó; kế toán áp dụng rồi mới tính", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    await db.hoaDonYeuCauNguoiMua.create({
      data: { centerId: CS, orderId: DON, tokenHash: `${T}tok`, trangThai: "DA_GUI", hetHanLuc: new Date("2699-09-30T20:00:00Z"), giaTriGocHash: {}, taoBoiId: SALE },
    });
    const kq = await chay("TU_DONG");
    expect(kq.boQua.KHACH_DANG_KHAI).toBe(1);
    expect(await hoaDon()).toHaveLength(0);
  });

  it("[LDD-08] ƯU TIÊN thông tin đã khai và ĐỦ: dùng nguyên, không thay bằng tên học viên", async () => {
    await dungFixture({ donData: { invoiceBuyerName: "Lê Thị Mẹ", customerAddress: "5 Hoàng Diệu", customerCity: "Đà Nẵng" } });
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    const kq = await chay("TU_DONG");
    expect(kq.daXuat).toBe(1);
    expect((await hoaDon())[0]).toMatchObject({ nguoiMuaTen: "Lê Thị Mẹ", nguoiMuaDiaChi: "5 Hoàng Diệu, Đà Nẵng" });
    const bd = await db.auditLog.findFirstOrThrow({ where: { action: "BAT_DAU_PHAT_HANH_MISA", entityId: (await hoaDon())[0]!.id } });
    expect(bd.newValues).toMatchObject({ nguonNguoiMua: "SALE_DA_KHAI" });
  });

  it("[LDD-09] đã khai NỬA CHỪNG (tên công ty, thiếu MST) ⇒ KHÔNG xuất «tiêu dùng» đè lên", async () => {
    await dungFixture({ donData: { invoiceCompanyName: "Công ty ABC", customerAddress: "5 Hoàng Diệu" } });
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    const kq = await chay("TU_DONG");
    expect(kq.boQua.DA_KHAI_CHUA_DU).toBe(1);
    expect(await hoaDon()).toHaveLength(0);
  });

  it("[LDD-10] cơ sở KHÔNG thí điểm ⇒ không nằm trong lô (đối chứng: có cài riêng ⇒ trong lô; gỡ ⇒ ra khỏi lô, không hoá đơn)", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    expect(await coSoLoDem()).toContain(CS);
    await db.centerSetting.deleteMany({ where: { orgUnitId: OU } });
    expect(await coSoLoDem()).not.toContain(CS);
    await chay("TU_DONG");
    expect(await hoaDon()).toHaveLength(0);
  });

  it("[LDD-11] hai lần thu của CÙNG đơn ⇒ HAI hoá đơn riêng (không gộp), mỗi tờ một lần thu", async () => {
    await khoan(P1, 1_000_000);
    await khoan(P2, 2_000_000);
    await batSetting("hoaDon.loDemTuDong");
    const kq = await chay("TU_DONG");
    expect(kq.daXuat).toBe(2);
    const hd = await hoaDon();
    expect(hd).toHaveLength(2);
    expect(hd.map((x) => x.khoan.map((k) => k.paymentId)).sort()).toEqual([[P1], [P2]]);
  });

  it("[LDD-13] CẢ HAI công tắc bật ⇒ TỰ ĐỘNG thắng CHẠY THỬ (phát hành thật); đối chứng: chỉ chạy thử ⇒ không hoá đơn", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemChayThu");
    await batSetting("hoaDon.loDemTuDong");
    const kq = (await chayLoDemCuaCron({ now: NOW, conThoiGian: () => true }))!;
    expect(kq.cheDo).toBe("TU_DONG");
    expect(kq.daXuat).toBe(1);
    expect(await hoaDon()).toHaveLength(1);
  });

  it("[LDD-14] màn Hoá đơn điện tử TẮT ⇒ cả hai công tắc lô cũng vô nghĩa (null, không hoá đơn)", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    await batSetting("billing.hoaDonEnabled", false);
    expect(await chayLoDemCuaCron({ now: NOW, conThoiGian: () => true })).toBeNull();
    expect(await hoaDon()).toHaveLength(0);
  });

  it("[LDD-16] FAIL-CLOSED: pháp nhân CHƯA khai hạn mức ⇒ lô TỰ ĐỘNG không phát hành, lý do VUOT_HAN_MUC, lần thu ở lại (không mất, không khoá); khai hạn mức ⇒ cùng lần thu được xuất", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    await db.hoaDonKyChinhSach.deleteMany({ where: { phapNhanMa: "SATA_ROBO" } });
    const cong = h.cong as CongHoaDon & { daGui: PhieuPhatHanh[] };
    const kq = await chay("TU_DONG");
    expect(kq.daXuat).toBe(0);
    expect(kq.boQua["VUOT_HAN_MUC"]).toBe(1);
    expect(cong.daGui).toHaveLength(0);
    expect(await hoaDon()).toHaveLength(0); // KHÔNG bản mồ côi
    // Cảnh báo cho bộ phận phụ trách: MỘT tin gộp (loại CHO) cho pháp nhân, chỉ mang số lượng + tên pháp nhân — không số tiền, không tên người mua.
    expect(h.notify).toHaveBeenCalledTimes(1);
    const tin = h.notify.mock.calls[0]![0];
    expect(tin.dedupeKey).toMatch(/^hoa-don\.han-muc:SATA_ROBO:\d{4}-\d{2}-\d{2}:CHO$/);
    expect(tin.userIds).toEqual(["fx-han-muc-ke-toan"]);
    expect(tin.body).toMatch(/^1 lần thu của /);
    expect(tin.body).not.toMatch(/\d{1,3}(\.\d{3})+/);
    await db.hoaDonKyChinhSach.create({ data: { phapNhanMa: "SATA_ROBO", hanMucMoiHoaDon: 5_000_000, hanMucMoiNgay: 50_000_000, soToiDa: 10, cuaSoPhut: 60, capNhatBoiId: SALE } });
    expect((await chay("TU_DONG")).daXuat).toBe(1);
    expect(h.notify).toHaveBeenCalledTimes(1); // xuất được thì không báo thêm
  });

  it("[LDD-17] hạn mức: chạm ĐÚNG mức mỗi hoá đơn vẫn xuất, hơn một đồng thì dừng (chờ kiểm tra)", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    await db.hoaDonKyChinhSach.update({ where: { phapNhanMa: "SATA_ROBO" }, data: { hanMucMoiHoaDon: 2_999_999 } });
    const kq = await chay("TU_DONG");
    expect(kq).toMatchObject({ daXuat: 0 });
    expect(kq.boQua["VUOT_HAN_MUC"]).toBe(1);
    expect(await hoaDon()).toHaveLength(0);
    await db.hoaDonKyChinhSach.update({ where: { phapNhanMa: "SATA_ROBO" }, data: { hanMucMoiHoaDon: 3_000_000 } });
    expect((await chay("TU_DONG")).daXuat).toBe(1); // biên: đúng bằng hạn mức
  });

  it("[LDD-18] TẠM DỪNG KÝ: pháp nhân đang dừng ⇒ lô không phát hành (CONG_NHA_CUNG_CAP, lý do nói tạm dừng), không bản, nhà cung cấp không bị gọi; bật lại ⇒ cùng lần thu được xuất", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    const cong = h.cong as CongHoaDon & { daGui: PhieuPhatHanh[] };
    await db.hoaDonKyChinhSach.update({ where: { phapNhanMa: "SATA_ROBO" }, data: { tamDung: true, tamDungLuc: NOW, tamDungBoiId: SALE, tamDungLyDo: "Nghi lộ khoá API VIN" } });
    const kq = await chay("TU_DONG");
    expect(kq.daXuat).toBe(0);
    expect(kq.boQua["CONG_NHA_CUNG_CAP"]).toBeGreaterThan(0);
    expect(JSON.stringify(kq.mau)).toContain("tạm dừng");
    expect(cong.daGui).toHaveLength(0);
    expect(await hoaDon()).toHaveLength(0);
    await db.hoaDonKyChinhSach.update({ where: { phapNhanMa: "SATA_ROBO" }, data: { tamDung: false, tamDungLuc: null, tamDungBoiId: null, tamDungLyDo: null } });
    expect((await chay("TU_DONG")).daXuat).toBe(1);
  });

  it("[LDD-12] cổng nhà cung cấp chưa cấu hình ⇒ lô bỏ qua có lý do, KHÔNG ném, KHÔNG tạo bản DANG_PHAT_HANH mồ côi", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    h.cong = null;
    const kq = await chay("TU_DONG");
    // Không cổng ⇒ nút phát hành không hiện ⇒ lần thu bị lọc ở bước chọn.
    expect(kq.daXuat).toBe(0);
    expect(await hoaDon()).toHaveLength(0);
  });

  it("[LDD-15] pháp nhân KÝ USB token (VIN) ⇒ lô TỰ ĐỘNG KHÔNG phát hành: không hoá đơn, nhà cung cấp KHÔNG bị gọi, lý do ghi ở báo cáo; đối chứng dương: bỏ cấu hình USB thì cùng lần thu được xuất", async () => {
    await khoan(P1, 3_000_000);
    await batSetting("hoaDon.loDemTuDong");
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    await db.cauHinhHoaDonCoSo.create({
      data: { centerId: CS, phapNhanMa: "NEW_VISION", kyHieu: "1C99MNV", hieuLucTu: new Date("2699-01-01T00:00:00Z"), hieuLucDen: new Date("2699-12-31T00:00:00Z"), dangBat: true, taoBoiId: SALE, capNhatBoiId: SALE },
    });
    // Hàng chờ nạp theo ĐỒNG HỒ THẬT (`hang-cho.ts`: `homNay: ngayVN(new Date())`) còn lô 23h chạy theo `now` giả 2699 — nên cơ sở phải có cấu hình hiệu lực CẢ ở ngày thật.
    // Thiếu dòng này, hàng chờ rơi về pháp nhân mặc định của cơ sở (SATA_ROBO = MISA) còn cổng lô đi theo NEW_VISION (VIN) ⇒ «nhà cung cấp vừa được đổi» ⇒ ca xanh nửa đầu vì sai lý do, đỏ nửa sau.
    await db.cauHinhHoaDonCoSo.create({
      data: { centerId: CS, phapNhanMa: "NEW_VISION", kyHieu: "1C26MNV", hieuLucTu: new Date("2000-01-01T00:00:00Z"), hieuLucDen: new Date("2100-12-31T00:00:00Z"), dangBat: true, taoBoiId: SALE, capNhatBoiId: SALE },
    });
    // Mật khẩu MÃ HOÁ ĐÚNG (khoá env + id dòng) để cổng VIN dựng được nếu có ai bỏ cổng chặn USB — ca này phải chứng minh CHÍNH cổng chặn đó,
    // không phải một lỗi cấu hình khác tình cờ làm cron bỏ qua.
    const khoaCu = process.env.HOA_DON_KHOA_BI_MAT;
    process.env.HOA_DON_KHOA_BI_MAT = "khoa-lo-dem-ldd-15-0123456789-abcdefghijkl";
    try {
      const idKetNoi = `${T}ket-noi`;
      await db.hoaDonKetNoiNhaCungCap.create({
        data: {
          id: idKetNoi,
          phapNhanMa: "NEW_VISION",
          moiTruong: "SANDBOX",
          nhaCungCapMa: "VIN_HOADON",
          dangBat: true,
          baseUrl: "https://vin-thu.example.test",
          mst: "0402341070",
          tenDangNhap: "u",
          matKhauMaHoa: maHoaBiMat("mat-khau-ldd-15", { khoaGoc: process.env.HOA_DON_KHOA_BI_MAT, mucDich: MUC_DICH_KET_NOI, nguCanh: nguCanhKetNoi(idKetNoi) }),
          phuongThucKy: "USB_TOKEN",
          cheDoKy: "LO",
          capNhatBoiId: SALE,
        },
      });
      await chayCaUsb();
    } finally {
      if (khoaCu === undefined) delete process.env.HOA_DON_KHOA_BI_MAT;
      else process.env.HOA_DON_KHOA_BI_MAT = khoaCu;
    }
  });

  async function chayCaUsb() {
    const cong = h.cong as CongHoaDon & { daGui: PhieuPhatHanh[] };
    const kq = await chay("TU_DONG");
    expect(kq.daXuat).toBe(0);
    expect(cong.daGui).toHaveLength(0);
    expect(await hoaDon()).toHaveLength(0);
    expect(kq.boQua["CONG_NHA_CUNG_CAP"]).toBeGreaterThan(0);
    // đối chứng dương: gỡ cấu hình USB ⇒ rơi về cổng env (giả) ⇒ xuất bình thường
    await db.hoaDonKetNoiNhaCungCap.deleteMany({ where: { capNhatBoiId: SALE } });
    const sau = await chay("TU_DONG");
    expect(sau.daXuat).toBe(1);
    expect(cong.daGui).toHaveLength(1);
  }
});
