// Ca [KUL-*] — ĐƯỜNG KÝ USB TOKEN (VIN-HOADON) trên lệnh ký, Postgres THẬT + máy chủ VIN GIẢ (hub/13 §4).
//
// ⚠️ Đây KHÔNG phải bằng chứng VIN thật chạy được: máy chủ giả dựng theo bộ Postman + đo demo; chữ ký là chữ ký GIẢ (`kyXmlGiaChoTest`). Thứ bộ này chứng minh là
// MÃ CỦA TA: máy trạng thái lệnh ký + hoá đơn, không bao giờ gửi lại mù, kết quả nhà cung cấp luôn được áp, pháp nhân USB không rơi sang đường HSM.
// Không gọi `resetDb()`: fixture tiền tố `fx-kul-`, dọn đúng phần của mình. Đồng hồ ĐÓNG BĂNG (luật 19).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";

vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
  luuTepHoaDon: async (i: { loai: "pdf" | "xml"; than: Uint8Array }) => ({ ok: true as const, co: i.than.length, sha256: `sha-${i.loai}-${i.than.length}` }),
}));

import { duyetVaBatDauKy } from "@/lib/finance/hoa-don/lenh-ky-db";
import { luuKetNoi } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { batDauPhienKyUsb, hoanTatKyUsb, kiemTraLaiUsb, taoLenhKyUsb } from "@/lib/finance/hoa-don/ky-usb/ky-usb-lenh";
import { docHangChoKyUsb } from "@/lib/finance/hoa-don/ky-usb/hang-cho-ky-usb";
import { CHINH_SACH_KY_NGHIEM_NHAT } from "@/lib/finance/hoa-don/lenh-ky-trang-thai";
import { kyXmlGiaChoTest, TAI_KHOAN_VIN_GIA, taoMayChuVinGia } from "@/lib/vin-hoadon/may-chu-vin-gia";

if (!RUN_DB_TESTS) console.warn(`[KUL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-kul-";
const CS = `${T}cs`;
const DON = `${T}don`;
const HD = `${T}hd`;
const REF = `${T}ref-1`;
const MST = "0402341070";
const NOW = new Date("2026-11-04T03:00:00.000Z");
const PHUT = (n: number) => new Date(NOW.getTime() + n * 60_000);
const KHOA = "khoa-ky-usb-kul-0123456789-abcdefghijklmnop";
const ENV = { HOA_DON_KHOA_BI_MAT: KHOA };
const KEYS = ["billing.hoaDonEnabled", "hoaDon.kyUsb"];

const actor = (userId: string): Actor =>
  ({
    userId,
    isSuperAdmin: false,
    isHoLevel: true,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "KE_TOAN", centerScope: "ALL" }],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;
const YEU_CAU = actor(`${T}yeu-cau`);
const NGUOI_KY = actor(`${T}nguoi-ky`);

const phieu = (): PhieuPhatHanh => ({
  refId: REF,
  kyHieu: "1C26MNV",
  mstNguoiBan: MST,
  ngayHoaDon: new Date("2026-11-04T00:00:00.000Z"),
  nguoiMua: { hoTen: "Nguyễn Văn A", donVi: null, mst: null, diaChi: null, email: null },
  hinhThucThanhToan: "Chuyển khoản",
  dong: [{ stt: 1, ten: "Học phí", donViTinh: "Khoá", soLuong: 1, donGia: 5_000_000, thanhTien: 5_000_000, thueSuat: "KCT", tienThue: 0 }],
  tongTruocThue: 5_000_000,
  tongThue: 0,
  tongThanhToan: 5_000_000,
  soTienBangChu: "Năm triệu đồng.",
});

async function don() {
  const lenh = await db.hoaDonLenhKy.findMany({ where: { hoaDonId: HD }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityType: "HoaDonLenhKy", entityId: { in: lenh.map((l) => l.id) } }, { entityId: HD }] } });
  await db.hoaDonLenhKy.deleteMany({ where: { hoaDonId: HD } });
  await db.hoaDonNgoaiLe.deleteMany({ where: { centerId: CS } });
  await db.hoaDonDienTu.deleteMany({ where: { id: HD } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.center.deleteMany({ where: { id: CS } });
  await db.systemSetting.deleteMany({ where: { key: { in: KEYS } } });
  await db.auditLog.deleteMany({ where: { entityType: "HoaDonKetNoiNhaCungCap" } });
  await db.hoaDonKetNoiNhaCungCap.deleteMany({});
}

const bat = (key: string, v = true) => db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });

async function dung(o: { phuongThucKy?: "USB_TOKEN" | "HSM_NHA_CUNG_CAP"; hetHan?: string | null; coKetNoi?: boolean } = {}) {
  await don();
  await db.center.create({ data: { id: CS, name: "CS KUL", slug: CS, address: "x" } });
  await db.order.create({ data: { id: DON, code: "ORD-269975-000001", type: "COURSE", status: "CONFIRMED", customerName: "Phụ huynh", customerPhone: "0328545551", totalAmount: 5_000_000, centerId: CS } });
  await db.hoaDonDienTu.create({
    data: {
      id: HD,
      orderId: DON,
      centerId: CS,
      trangThai: "DANG_PHAT_HANH",
      tongTien: 5_000_000,
      taoBoiId: `${T}kt`,
      phapNhanMa: "NEW_VISION",
      phapNhanMst: MST,
      nhaCungCapMa: "VIN_HOADON",
      misaRefId: REF,
      misaPhieu: JSON.parse(JSON.stringify(phieu())),
    },
  });
  for (const k of KEYS) await bat(k);
  if (o.coKetNoi !== false) {
    const kq = await luuKetNoi({
      // BGĐ 04/11/2026: cấu hình kết nối CHỈ do Quản trị tối cao ghi.
      actor: { ...YEU_CAU, isSuperAdmin: true } as Actor,
      nguoi: { id: YEU_CAU.userId, name: "Quản trị tối cao" },
      du: {
        phapNhanMa: "NEW_VISION",
        moiTruong: "SANDBOX",
        nhaCungCapMa: "VIN_HOADON",
        dangBat: true,
        baseUrl: "https://vin-thu.example.test",
        mst: MST,
        tenDangNhap: TAI_KHOAN_VIN_GIA.username,
        phuongThucKy: o.phuongThucKy ?? "USB_TOKEN",
        cheDoKy: "LO",
        chungThuSerial: "5400FA1B2C3D",
        chungThuHetHan: o.hetHan === undefined ? "2027-05-01" : o.hetHan,
      },
      matKhauMoi: TAI_KHOAN_VIN_GIA.password,
      lyDo: "Khai kết nối VIN cho fixture KUL",
      env: ENV,
    });
    if (!kq.ok) throw new Error(`fixture kết nối: ${kq.error}`);
  }
}

const hoaDon = () => db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } });
const lenhCuaHd = () => db.hoaDonLenhKy.findFirstOrThrow({ where: { hoaDonId: HD }, orderBy: { createdAt: "desc" } });
const dem = (may: ReturnType<typeof taoMayChuVinGia>, duong: string) => may.cuocGoi.filter((c) => c.duong === duong).length;
const GUI_XML = "/XuLyHoaDon/KyHoaDonToken_GuiXmlDaKy";

/** Đi tới lúc có lệnh DANG_KY + phiên ký. */
async function toiPhienKy(may: ReturnType<typeof taoMayChuVinGia>, at = NOW) {
  const t = await taoLenhKyUsb({ actor: YEU_CAU, ten: "Hệ thống", hoaDonId: HD, now: at, env: ENV });
  if (!t.ok) throw new Error(`taoLenh: ${t.error}`);
  const soCuocSauTao = may.cuocGoi.length;
  const d = await duyetVaBatDauKy({ actor: NGUOI_KY, ten: "Kế toán ký", lenhId: t.id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: at });
  if (!d.ok) throw new Error(`duyet: ${d.error}`);
  const p = await batDauPhienKyUsb({ actor: NGUOI_KY, lenhId: t.id, now: at, env: ENV, fetchImpl: may.fetchImpl });
  return { lenhId: t.id, phien: p, soCuocSauTao };
}
const hoanTat = (may: ReturnType<typeof taoMayChuVinGia>, lenhId: string, xmlDaKyBase64: string, at = PHUT(2)) =>
  hoanTatKyUsb({ actor: NGUOI_KY, ten: "Kế toán ký", lenhId, xmlDaKyBase64, now: at, env: ENV, fetchImpl: may.fetchImpl });
const kyGia = (xmlBase64: string) => Buffer.from(kyXmlGiaChoTest(Buffer.from(xmlBase64, "base64").toString("utf8")), "utf8").toString("base64");

describe.skipIf(!RUN_DB_TESTS)("[KUL] ký USB token trên lệnh ký — Postgres thật, máy chủ VIN giả", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[KUL-01] luồng đủ: tạo lệnh (không gọi VIN) → ký bắt đầu → lưu nháp + tải XML → ký giả → gửi XML đã ký ⇒ hoá đơn CÓ SỐ, lệnh DA_KY, VIN nhận ĐÚNG MỘT lần gửi XML", async () => {
    const may = taoMayChuVinGia();
    const { lenhId, phien, soCuocSauTao } = await toiPhienKy(may);
    expect(soCuocSauTao).toBe(0); // tạo lệnh KHÔNG chạm nhà cung cấp (lệnh có thể nằm qua đêm)
    if (!phien.ok) throw new Error(phien.error);
    expect(may.daGhi.get(REF)?.daKy).toBe(false); // mới là NHÁP trên VIN
    const l = await lenhCuaHd();
    expect(l).toMatchObject({ trangThai: "DANG_KY", maPhienNcc: phien.maPhien, phuongThuc: "USB_TOKEN" });
    expect(l.xmlChuaKy).toContain("<HDon>");
    const kq = await hoanTat(may, lenhId, kyGia(phien.xmlChuaKyBase64));
    expect(kq.ok).toBe(true);
    expect(dem(may, GUI_XML)).toBe(1);
    expect(may.daGhi.get(REF)?.daKy).toBe(true);
    const hd = await hoaDon();
    expect(hd.soHoaDon).toMatch(/^\d{7}$/);
    expect(hd.maTraCuu).toBe(may.daGhi.get(REF)!.maGiaoDich);
    expect(hd.misaSoLanGui).toBe(1); // giành lượt gửi đúng một lần
    expect((await lenhCuaHd()).trangThai).toBe("DA_KY");
  });

  it("[KUL-02] cờ `hoaDon.kyUsb` TẮT ⇒ cả ba bước từ chối, KHÔNG gọi VIN (đối chứng dương: bật thì chạy)", async () => {
    const may = taoMayChuVinGia();
    await bat("hoaDon.kyUsb", false);
    expect(await taoLenhKyUsb({ actor: YEU_CAU, ten: "x", hoaDonId: HD, now: NOW, env: ENV })).toMatchObject({ ok: false, ma: "TAT" });
    expect(await batDauPhienKyUsb({ actor: NGUOI_KY, lenhId: "x", now: NOW, env: ENV, fetchImpl: may.fetchImpl })).toMatchObject({ ok: false, ma: "TAT" });
    expect(await hoanTatKyUsb({ actor: NGUOI_KY, ten: "x", lenhId: "x", xmlDaKyBase64: "", now: NOW, env: ENV, fetchImpl: may.fetchImpl })).toMatchObject({ ok: false, ma: "TAT" });
    expect(may.cuocGoi).toHaveLength(0);
    expect(await db.hoaDonLenhKy.count({ where: { hoaDonId: HD } })).toBe(0);
    await bat("hoaDon.kyUsb");
    expect((await taoLenhKyUsb({ actor: YEU_CAU, ten: "x", hoaDonId: HD, now: NOW, env: ENV })).ok).toBe(true);
  });

  it("[KUL-03] pháp nhân KHÔNG ký USB (HSM) hoặc chưa khai kết nối ⇒ không tạo lệnh USB", async () => {
    await dung({ phuongThucKy: "HSM_NHA_CUNG_CAP", hetHan: null });
    expect(await taoLenhKyUsb({ actor: YEU_CAU, ten: "x", hoaDonId: HD, now: NOW, env: ENV })).toMatchObject({ ok: false, ma: "KHONG_PHAI_KY_USB" });
    await dung({ coKetNoi: false });
    expect(await taoLenhKyUsb({ actor: YEU_CAU, ten: "x", hoaDonId: HD, now: NOW, env: ENV })).toMatchObject({ ok: false, ma: "KHONG_PHAI_KY_USB" });
    expect(await db.hoaDonLenhKy.count({ where: { hoaDonId: HD } })).toBe(0);
    await dung(); // đối chứng dương
    expect((await taoLenhKyUsb({ actor: YEU_CAU, ten: "x", hoaDonId: HD, now: NOW, env: ENV })).ok).toBe(true);
  });

  it("[KUL-04] chứng thư chưa khai hạn / đã hết hạn ⇒ KHÔNG bắt đầu phiên, VIN không nhận gì; còn hạn thì được", async () => {
    for (const hetHan of [null, "2026-11-03"]) {
      await dung({ hetHan });
      const may = taoMayChuVinGia();
      const t = await taoLenhKyUsb({ actor: YEU_CAU, ten: "x", hoaDonId: HD, now: NOW, env: ENV });
      if (!t.ok) throw new Error(t.error);
      await duyetVaBatDauKy({ actor: NGUOI_KY, ten: "ký", lenhId: t.id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: NOW });
      const p = await batDauPhienKyUsb({ actor: NGUOI_KY, lenhId: t.id, now: NOW, env: ENV, fetchImpl: may.fetchImpl });
      expect(p).toMatchObject({ ok: false, ma: "CHUNG_THU" });
      expect(may.cuocGoi).toHaveLength(0);
    }
    await dung({ hetHan: "2026-11-04" }); // hạn là NGÀY CUỐI còn hiệu lực — hôm nay còn dùng được
    const may = taoMayChuVinGia();
    expect((await toiPhienKy(may)).phien.ok).toBe(true);
  });

  it("[KUL-05] phiên ký quá hạn (29 phút sau khi mở; biên an toàn 2 phút) ⇒ KHÔNG gửi gì, lệnh LOI_KY (QUA_THOI_GIAN); phiên 20 phút thì gửi được", async () => {
    const may = taoMayChuVinGia();
    const { lenhId, phien } = await toiPhienKy(may);
    if (!phien.ok) throw new Error(phien.error);
    const quaHan = await hoanTat(may, lenhId, kyGia(phien.xmlChuaKyBase64), PHUT(29));
    expect(quaHan).toMatchObject({ ok: false, ma: "HET_PHIEN" });
    expect(dem(may, GUI_XML)).toBe(0);
    expect((await lenhCuaHd()).trangThai).toBe("LOI_KY");
    expect((await hoaDon()).soHoaDon).toBeNull();
    // đối chứng dương: phiên mới, 20 phút ⇒ gửi được
    await dung();
    const may2 = taoMayChuVinGia();
    const b = await toiPhienKy(may2);
    if (!b.phien.ok) throw new Error(b.phien.error);
    expect((await hoanTat(may2, b.lenhId, kyGia(b.phien.xmlChuaKyBase64), PHUT(20))).ok).toBe(true);
  });

  it("[KUL-06] XML 'đã ký' KHÔNG có chữ ký / bị sửa nội dung ⇒ KHÔNG gửi, KHÔNG đụng hoá đơn (vẫn DANG_PHAT_HANH, không LOI_PHAT_HANH), lệnh LOI_KY", async () => {
    for (const hong of ["chua-ky", "sua-noi-dung"]) {
      await dung();
      const may = taoMayChuVinGia();
      const { lenhId, phien } = await toiPhienKy(may);
      if (!phien.ok) throw new Error(phien.error);
      const xml = Buffer.from(phien.xmlChuaKyBase64, "base64").toString("utf8");
      const gui = hong === "chua-ky" ? xml : kyXmlGiaChoTest(xml).replace("5000000", "1");
      const kq = await hoanTat(may, lenhId, Buffer.from(gui, "utf8").toString("base64"));
      expect(kq.ok, hong).toBe(false);
      expect(dem(may, GUI_XML), hong).toBe(0);
      const hd = await hoaDon();
      expect(hd.trangThai, hong).toBe("DANG_PHAT_HANH");
      expect(hd.misaGuiLuc, hong).toBeNull(); // chưa từng "gửi" ⇒ không giành lượt
      expect((await lenhCuaHd()).trangThai, hong).toBe("LOI_KY");
    }
  });

  it("[KUL-07] timeout SAU KHI VIN đã nhận chữ ký ⇒ KHÔNG_RÕ: đúng MỘT lần gửi, hoá đơn giữ DANG_PHAT_HANH; «Kiểm tra lại» chỉ TRA CỨU và thấy số thật (không gửi lại)", async () => {
    const may = taoMayChuVinGia();
    const { lenhId, phien } = await toiPhienKy(may);
    if (!phien.ok) throw new Error(phien.error);
    may.datKichBan("TIMEOUT_DA_GHI");
    await hoanTat(may, lenhId, kyGia(phien.xmlChuaKyBase64));
    expect(dem(may, GUI_XML)).toBe(1);
    let hd = await hoaDon();
    expect(hd.trangThai).toBe("DANG_PHAT_HANH");
    expect(hd.soHoaDon).toBeNull();
    expect(hd.misaLoiThongDiep).toBeTruthy();
    expect((await lenhCuaHd()).trangThai).toBe("LOI_KY");
    may.datKichBan("THANH_CONG");
    const truoc = may.cuocGoi.length;
    await kiemTraLaiUsb({ nguoiGoiId: null, hoaDonId: HD, now: PHUT(5), env: ENV, fetchImpl: may.fetchImpl });
    expect(dem(may, GUI_XML)).toBe(1); // vẫn một — kiểm tra lại không gửi lại
    expect(may.cuocGoi.slice(truoc).some((c) => c.duong === "/TraCuuHoaDon/TraThongTinHoaDon")).toBe(true);
    hd = await hoaDon();
    expect(hd.soHoaDon).toMatch(/^\d{7}$/);
  });

  it("[KUL-08] VIN từ chối chắc chắn ⇒ hoá đơn LOI_PHAT_HANH (kế toán thấy), lệnh LOI_KY; phiên lạ ⇒ không ghi nhận đã ký", async () => {
    const may = taoMayChuVinGia();
    const { lenhId, phien } = await toiPhienKy(may);
    if (!phien.ok) throw new Error(phien.error);
    may.epMotLan(GUI_XML, () => new Response("{}", { status: 400 }));
    await hoanTat(may, lenhId, kyGia(phien.xmlChuaKyBase64));
    expect((await hoaDon()).trangThai).toBe("LOI_PHAT_HANH");
    expect((await lenhCuaHd()).trangThai).toBe("LOI_KY");
    expect(may.daGhi.get(REF)?.daKy).toBe(false);
  });

  it("[KUL-09] tách nhiệm vụ S9 vẫn nguyên: người yêu cầu KHÔNG tự ký lệnh mình dưới chính sách nghiêm; bắt đầu phiên chỉ cho ĐÚNG người ký", async () => {
    const may = taoMayChuVinGia();
    const t = await taoLenhKyUsb({ actor: YEU_CAU, ten: "x", hoaDonId: HD, now: NOW, env: ENV });
    if (!t.ok) throw new Error(t.error);
    const tuKy = await duyetVaBatDauKy({ actor: YEU_CAU, ten: "x", lenhId: t.id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: NOW });
    expect(tuKy.ok).toBe(false);
    // chưa DANG_KY ⇒ chưa bắt đầu phiên được
    expect(await batDauPhienKyUsb({ actor: NGUOI_KY, lenhId: t.id, now: NOW, env: ENV, fetchImpl: may.fetchImpl })).toMatchObject({ ok: false, ma: "SAI_TRANG_THAI" });
    await duyetVaBatDauKy({ actor: NGUOI_KY, ten: "ký", lenhId: t.id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: NOW });
    // người KHÁC (không phải người đã nhận ký) không bắt đầu phiên được
    expect(await batDauPhienKyUsb({ actor: actor(`${T}ai-do`), lenhId: t.id, now: NOW, env: ENV, fetchImpl: may.fetchImpl })).toMatchObject({ ok: false, ma: "SAI_TRANG_THAI" });
    expect(may.cuocGoi).toHaveLength(0);
    expect((await batDauPhienKyUsb({ actor: NGUOI_KY, lenhId: t.id, now: NOW, env: ENV, fetchImpl: may.fetchImpl })).ok).toBe(true);
  });

  it("[KUL-10] bắt đầu phiên lặp lại an toàn: lưu nháp lần hai trả đúng magiaodich cũ, VIN chỉ có MỘT bản nháp", async () => {
    const may = taoMayChuVinGia();
    const a = await toiPhienKy(may);
    if (!a.phien.ok) throw new Error(a.phien.error);
    const lai = await batDauPhienKyUsb({ actor: NGUOI_KY, lenhId: a.lenhId, now: PHUT(1), env: ENV, fetchImpl: may.fetchImpl });
    expect(lai.ok).toBe(true);
    expect(may.daGhi.size).toBe(1);
    expect(dem(may, "/QuanLyHoaDon/LapHoaDonGoc")).toBe(2);
  });

  it("[KUL-11] «Kiểm tra lại» KHÔNG BAO GIỜ gửi lại, kể cả khi VIN nói CHƯA CÓ hoá đơn (nháp biến mất): không LapHoaDonGoc, không GuiVaKyHoadonGocHSM, không GuiXmlDaKy", async () => {
    const may = taoMayChuVinGia();
    const { phien } = await toiPhienKy(may);
    if (!phien.ok) throw new Error(phien.error);
    (may.daGhi as Map<string, unknown>).delete(REF); // VIN "quên" bản nháp ⇒ tra cứu trả CHUA_CO
    const truoc = may.cuocGoi.length;
    await kiemTraLaiUsb({ nguoiGoiId: null, hoaDonId: HD, now: PHUT(5), env: ENV, fetchImpl: may.fetchImpl });
    const moi = may.cuocGoi.slice(truoc).map((c) => c.duong);
    expect(moi.some((d) => d === "/TraCuuHoaDon/TraThongTinHoaDon")).toBe(true); // đối chứng: có tra cứu thật
    for (const cam of ["/QuanLyHoaDon/LapHoaDonGoc", "/QuanLyHoaDon/GuiVaKyHoadonGocHSM", GUI_XML]) expect(moi).not.toContain(cam);
  });

  it("[KUL-12] danh sách «chờ ký USB»: thấy hoá đơn của pháp nhân USB kèm lệnh mới nhất; kế toán cơ sở KHÁC không thấy; pháp nhân HSM không có trong danh sách", async () => {
    const xem = await docHangChoKyUsb(YEU_CAU);
    expect(xem).toHaveLength(1);
    expect(xem[0]).toMatchObject({ hoaDonId: HD, phapNhanTen: expect.any(String), soTien: 5_000_000, nguoiMua: "Nguyễn Văn A", lenh: null, daGui: false });
    const t = await taoLenhKyUsb({ actor: YEU_CAU, ten: "x", hoaDonId: HD, now: NOW, env: ENV });
    if (!t.ok) throw new Error(t.error);
    expect((await docHangChoKyUsb(YEU_CAU))[0]!.lenh).toMatchObject({ id: t.id, trangThai: "CHO_KY", nguoiYeuCauId: YEU_CAU.userId });
    const coSoKhac = { ...actor(`${T}cs-khac`), isHoLevel: false, visibleCenterIds: [`${T}khong-phai-cs`], permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "KE_TOAN", centerScope: [`${T}khong-phai-cs`] }] } as unknown as Actor;
    expect(await docHangChoKyUsb(coSoKhac)).toEqual([]);
    await dung({ phuongThucKy: "HSM_NHA_CUNG_CAP", hetHan: null });
    expect(await docHangChoKyUsb(YEU_CAU)).toEqual([]);
  });
});
