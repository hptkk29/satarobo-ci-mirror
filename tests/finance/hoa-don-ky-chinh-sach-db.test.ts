// Ca [KCD-*] / [KSU-*] — CHÍNH SÁCH KÝ (tạm dừng · hạn mức) + LỆNH KÝ DO HỆ THỐNG TẠO, Postgres THẬT + máy chủ VIN GIẢ (BGĐ 04/11/2026).
//
// ⚠️ Máy chủ VIN và chữ ký là GIẢ: bộ này chứng minh MÃ CỦA TA — cổng tạm dừng, hạn mức, quyền, bảo toàn nội dung, khớp chứng thư, lệnh hệ thống, quét + báo — không phải VIN thật chạy được.
// Không gọi `resetDb()`: fixture tiền tố `fx-kcs-`, dọn đúng phần của mình. Đồng hồ ĐÓNG BĂNG (luật 19).
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
const h = vi.hoisted(() => ({
  notify: vi.fn(async (_p: { userIds: string[]; dedupeKey: string; title: string; body: string; href: string }) => 2),
  keToan: vi.fn(async (_now: Date) => [{ userId: "fx-kcs-ke-toan-ho", phamVi: "ALL" as "ALL" | string[] }]),
}));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));
vi.mock("@/lib/finance/hoa-don/nhac-ke-toan-db", () => ({ timKeToan: h.keToan }));

import { duyetVaBatDauKy, huyLenhKy } from "@/lib/finance/hoa-don/lenh-ky-db";
import { luuKetNoi } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { layCongHsmChoPhapNhan } from "@/lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan";
import { batLaiKy, docChinhSachKy, docLichSuChinhSachKy, docSuDungHanMuc, giuChoHanMucTrongTx, kyDangTamDung, luuHanMucKy, tamDungKy } from "@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db";
import { SYSTEM_USER_ID } from "@/lib/auth/system-actor";
import { batDauPhienKyUsb, duocKyChoPhapNhan, hoanTatKyUsb, taoLenhKyUsb, taoLenhKyUsbHeThong } from "@/lib/finance/hoa-don/ky-usb/ky-usb-lenh";
import { quetTaoLenhKyHeThong } from "@/lib/finance/hoa-don/ky-usb/quet-tao-lenh";
import { layViecKeTiep } from "@/lib/finance/hoa-don/ky-usb/viec-ky";
import { CHINH_SACH_KY_NGHIEM_NHAT, NGUOI_YEU_CAU_HE_THONG } from "@/lib/finance/hoa-don/lenh-ky-trang-thai";
import { CHUNG_THU_KHAC_B64, kyXmlGiaChoTest, SERIAL_CHUNG_THU_GIA, TAI_KHOAN_VIN_GIA, taoMayChuVinGia } from "@/lib/vin-hoadon/may-chu-vin-gia";

if (!RUN_DB_TESTS) console.warn(`[KCD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-kcs-";
const CS = `${T}cs`;
const DON = `${T}don`;
const HD = `${T}hd`;
const REF = `${T}ref-1`;
const MST = "0402341070";
const NOW = new Date("2026-11-04T03:00:00.000Z");
const PHUT = (n: number) => new Date(NOW.getTime() + n * 60_000);
const ENV = { HOA_DON_KHOA_BI_MAT: "khoa-ky-chinh-sach-kcs-0123456789-abcdefghijk" };
const KEYS = ["billing.hoaDonEnabled", "hoaDon.kyUsb"];

const actor = (userId: string, o: { quanTri?: boolean; centerScope?: "ALL" | string[] } = {}): Actor =>
  ({
    userId,
    isSuperAdmin: o.quanTri === true,
    isHoLevel: true,
    orgRoles: [],
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "KE_TOAN", centerScope: o.centerScope ?? "ALL" }],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as unknown as Actor;
const QUAN_TRI = actor(`${T}quan-tri`, { quanTri: true });
const KE_TOAN_HO = actor(`${T}ke-toan-ho`);
const KE_TOAN_KHAC = actor(`${T}ke-toan-khac`);
const NGUOI = { id: QUAN_TRI.userId, name: "Quản trị tối cao" };

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
  await db.auditLog.deleteMany({ where: { OR: [{ entityType: "HoaDonLenhKy", entityId: { in: lenh.map((l) => l.id) } }, { entityId: HD }, { entityType: "HoaDonKyChinhSach" }, { entityType: "HoaDonKetNoiNhaCungCap" }] } });
  await db.hoaDonLenhKy.deleteMany({ where: { hoaDonId: HD } });
  await db.hoaDonNgoaiLe.deleteMany({ where: { centerId: CS } });
  await db.hoaDonDienTu.deleteMany({ where: { id: HD } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
  await db.center.deleteMany({ where: { id: CS } });
  await db.systemSetting.deleteMany({ where: { key: { in: KEYS } } });
  await db.hoaDonKetNoiNhaCungCap.deleteMany({});
  await db.hoaDonKyChinhSach.deleteMany({});
}
const bat = (key: string, v = true) => db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });

async function dung(o: { serial?: string | null } = {}) {
  await don();
  await db.center.create({ data: { id: CS, name: "CS KCS", slug: CS, address: "x" } });
  await db.order.create({ data: { id: DON, code: "ORD-269976-000001", type: "COURSE", status: "CONFIRMED", customerName: "Phụ huynh", customerPhone: "0328545551", totalAmount: 5_000_000, centerId: CS } });
  await db.hoaDonDienTu.create({
    data: { id: HD, orderId: DON, centerId: CS, trangThai: "DANG_PHAT_HANH", tongTien: 5_000_000, taoBoiId: `${T}kt`, phapNhanMa: "NEW_VISION", phapNhanMst: MST, nhaCungCapMa: "VIN_HOADON", misaRefId: REF, misaPhieu: JSON.parse(JSON.stringify(phieu())) },
  });
  for (const k of KEYS) await bat(k);
  const kq = await luuKetNoi({
    actor: QUAN_TRI,
    nguoi: NGUOI,
    du: {
      phapNhanMa: "NEW_VISION",
      moiTruong: "SANDBOX",
      nhaCungCapMa: "VIN_HOADON",
      dangBat: true,
      baseUrl: "https://vin-thu.example.test",
      mst: MST,
      tenDangNhap: TAI_KHOAN_VIN_GIA.username,
      phuongThucKy: "USB_TOKEN",
      cheDoKy: "LO",
      chungThuSerial: o.serial === undefined ? SERIAL_CHUNG_THU_GIA : o.serial,
      chungThuHetHan: "2027-05-01",
    },
    matKhauMoi: TAI_KHOAN_VIN_GIA.password,
    lyDo: "Khai kết nối VIN cho fixture KCS",
    env: ENV,
  });
  if (!kq.ok) throw new Error(`fixture kết nối: ${kq.error}`);
  h.notify.mockClear();
  h.keToan.mockClear();
}

const lenhCuaHd = () => db.hoaDonLenhKy.findFirstOrThrow({ where: { hoaDonId: HD }, orderBy: { createdAt: "desc" } });
const hoaDon = () => db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } });
const GUI_XML = "/XuLyHoaDon/KyHoaDonToken_GuiXmlDaKy";
const dem = (may: ReturnType<typeof taoMayChuVinGia>, duong: string) => may.cuocGoi.filter((c) => c.duong === duong).length;
const kyGia = (xmlBase64: string, chungThu?: string | null) => Buffer.from(kyXmlGiaChoTest(Buffer.from(xmlBase64, "base64").toString("utf8"), chungThu), "utf8").toString("base64");
const taoHeThong = () => taoLenhKyUsbHeThong({ hoaDonId: HD, now: NOW, env: ENV });

/** Lệnh HỆ THỐNG → người ký nhận ký → phiên. */
async function toiPhien(may: ReturnType<typeof taoMayChuVinGia>, nguoiKy: Actor = KE_TOAN_HO) {
  const t = await taoHeThong();
  if (!t.ok) throw new Error(`taoHeThong: ${t.error}`);
  const d = await duyetVaBatDauKy({ actor: nguoiKy, ten: "Kế toán ký", lenhId: t.id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: NOW });
  if (!d.ok) throw new Error(`duyet: ${d.error}`);
  const p = await batDauPhienKyUsb({ actor: nguoiKy, lenhId: t.id, now: NOW, env: ENV, fetchImpl: may.fetchImpl });
  return { lenhId: t.id, phien: p };
}
const hoanTat = (may: ReturnType<typeof taoMayChuVinGia>, lenhId: string, xml: string, nguoiKy: Actor = KE_TOAN_HO) =>
  hoanTatKyUsb({ actor: nguoiKy, ten: "Kế toán ký", lenhId, xmlDaKyBase64: xml, now: PHUT(2), env: ENV, fetchImpl: may.fetchImpl });

describe.skipIf(!RUN_DB_TESTS)("[KCD] chính sách ký theo pháp nhân — tạm dừng · hạn mức · nhật ký", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[KCD-01] tạm dừng: ghi dòng + nhật ký trước/sau trong CÙNG giao dịch; dừng lần hai bị từ chối (không nhật ký trùng, không ghi đè lý do gốc)", async () => {
    expect(await kyDangTamDung("NEW_VISION")).toEqual({ tamDung: false });
    expect(await tamDungKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Nghi lộ khoá API VIN", suCo: true, now: NOW })).toEqual({ ok: true });
    expect(await kyDangTamDung("NEW_VISION")).toEqual({ tamDung: true, lyDo: "Nghi lộ khoá API VIN", suCo: true });
    const hai = await tamDungKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Lý do khác hoàn toàn", suCo: false, now: PHUT(5) });
    expect(hai).toMatchObject({ ok: false });
    expect((await kyDangTamDung("NEW_VISION")) as { lyDo: string }).toMatchObject({ lyDo: "Nghi lộ khoá API VIN" });
    const ls = await db.auditLog.findMany({ where: { entityType: "HoaDonKyChinhSach" } });
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ action: "TAM_DUNG_KY", actorId: NGUOI.id, reason: "Nghi lộ khoá API VIN" });
    expect(ls[0]!.oldValues).toMatchObject({ tamDung: false });
    expect(ls[0]!.newValues).toMatchObject({ tamDung: true, suCo: true });
  });

  it("[KCD-02] CHỈ Quản trị tối cao ghi: kế toán Hội sở / kế toán khác bị từ chối ở lớp DB (không dòng, không nhật ký) — đối chứng dương ở KCD-01", async () => {
    for (const a of [KE_TOAN_HO, KE_TOAN_KHAC]) {
      expect(await tamDungKy({ actor: a, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Thử dừng khi không đủ quyền", suCo: false, now: NOW })).toMatchObject({ ok: false });
      expect(await luuHanMucKy({ actor: a, nguoi: NGUOI, phapNhanMa: "NEW_VISION", han: { hanMucMoiHoaDon: 1, hanMucMoiNgay: 2, soToiDa: 3, cuaSoPhut: 60, nguongTanSuat: null }, lyDo: "Thử khai hạn mức không đủ quyền" })).toMatchObject({ ok: false });
      expect(await batLaiKy({ actor: a, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Thử bật lại không đủ quyền", xacNhanSuCo: true })).toMatchObject({ ok: false });
    }
    expect(await db.hoaDonKyChinhSach.count()).toBe(0);
    expect(await db.auditLog.count({ where: { entityType: "HoaDonKyChinhSach" } })).toBe(0);
  });

  it("[KCD-03] bật lại: dừng thường chỉ cần lý do; dừng vì SỰ CỐ BẢO MẬT cần xác nhận riêng đúng `true`; không đang dừng ⇒ từ chối; có nhật ký BAT_LAI_KY", async () => {
    expect(await batLaiKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Bật lại khi chưa hề dừng", xacNhanSuCo: true })).toMatchObject({ ok: false });
    await tamDungKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Nghi lộ tài khoản VIN", suCo: true, now: NOW });
    for (const x of [undefined, false, "true", 1]) {
      expect(await batLaiKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Đã đổi mật khẩu VIN, rà soát xong", xacNhanSuCo: x })).toMatchObject({ ok: false });
    }
    expect((await kyDangTamDung("NEW_VISION")).tamDung).toBe(true);
    expect(await batLaiKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Đã đổi mật khẩu VIN, rà soát xong", xacNhanSuCo: true })).toEqual({ ok: true });
    expect((await kyDangTamDung("NEW_VISION")).tamDung).toBe(false);
    // dừng thường: không cần xác nhận sự cố
    await tamDungKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Tạm dừng để đối soát cuối tháng", suCo: false, now: PHUT(1) });
    expect(await batLaiKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Đối soát xong, ký lại bình thường", xacNhanSuCo: undefined })).toEqual({ ok: true });
    const acts = (await db.auditLog.findMany({ where: { entityType: "HoaDonKyChinhSach" }, orderBy: { createdAt: "asc" } })).map((l) => l.action);
    expect(acts).toEqual(["TAM_DUNG_KY", "BAT_LAI_KY", "TAM_DUNG_KY", "BAT_LAI_KY"]);
  });

  it("[KCD-04] hạn mức: lưu kèm nhật ký TRƯỚC/SAU (giá trị cũ → mới); sai luật (mỗi hoá đơn > mỗi ngày · thiếu cửa sổ · lý do ngắn) bị từ chối; pháp nhân lạ bị từ chối", async () => {
    const han = { hanMucMoiHoaDon: 10_000_000, hanMucMoiNgay: 50_000_000, soToiDa: 20, cuaSoPhut: 60, nguongTanSuat: 15 };
    expect(await luuHanMucKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", han, lyDo: "Khai hạn mức theo thống kê 90 ngày", xacNhanNoiLong: true })).toEqual({ ok: true });
    expect(await luuHanMucKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", han: { ...han, hanMucMoiHoaDon: 12_000_000 }, lyDo: "Nâng hạn mức mỗi hoá đơn", xacNhanNoiLong: true, maChiDao: "BGĐ-2026-11-04" })).toEqual({ ok: true });
    for (const loi of [{ ...han, hanMucMoiHoaDon: 99_000_000 }, { ...han, cuaSoPhut: null }, { ...han, soToiDa: 0 }]) {
      expect(await luuHanMucKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", han: loi, lyDo: "Thử giá trị sai", xacNhanNoiLong: true })).toMatchObject({ ok: false });
    }
    expect(await luuHanMucKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", han, lyDo: "ngắn" })).toMatchObject({ ok: false });
    expect(await luuHanMucKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "KHONG_CO_PHAP_NHAN_NAY", han, lyDo: "Pháp nhân không tồn tại", xacNhanNoiLong: true })).toMatchObject({ ok: false });
    expect(await docChinhSachKy("NEW_VISION")).toMatchObject({ hanMucMoiHoaDon: 12_000_000, hanMucMoiNgay: 50_000_000, tamDung: false });
    const ls = await docLichSuChinhSachKy();
    const sua = ls.find((l) => l.action === "SUA_HAN_MUC_KY")!;
    expect(sua.truocSau).toEqual([{ truong: "hanMucMoiHoaDon", truoc: 10_000_000, sau: 12_000_000 }]);
    expect(sua).toMatchObject({ nguoi: NGUOI.name, lyDo: "Nâng hạn mức mỗi hoá đơn", phapNhanMa: "NEW_VISION" });
    // Mã chỉ đạo của BGĐ nằm trong nhật ký (không phải điều kiện bắt buộc).
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: "HoaDonKyChinhSach", action: "SUA_HAN_MUC_KY" } });
    expect(log.newValues).toMatchObject({ maChiDao: "BGĐ-2026-11-04", xacNhanNoiLong: true });
  });

  it("[KCD-04b] NỚI LỎNG phải có xác nhận riêng ÉP Ở MÁY CHỦ: bật lần đầu · tăng · rút ngắn cửa sổ bị từ chối khi thiếu `true` (không ghi gì, không nhật ký); SIẾT CHẶT thì không cần", async () => {
    const han = { hanMucMoiHoaDon: 10_000_000, hanMucMoiNgay: 50_000_000, soToiDa: 20, cuaSoPhut: 60, nguongTanSuat: null };
    const dem = () => db.auditLog.count({ where: { entityType: "HoaDonKyChinhSach" } });
    // bật lần đầu (null → đủ) = nới
    for (const x of [undefined, false, "true", 1]) {
      expect(await luuHanMucKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", han, lyDo: "Khai hạn mức lần đầu cho pháp nhân", xacNhanNoiLong: x })).toMatchObject({ ok: false });
    }
    expect(await db.hoaDonKyChinhSach.count()).toBe(0);
    expect(await dem()).toBe(0);
    expect(await luuHanMucKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", han, lyDo: "Khai hạn mức lần đầu cho pháp nhân", xacNhanNoiLong: true })).toEqual({ ok: true });
    // tăng từng trường / rút ngắn cửa sổ = nới
    for (const noi of [{ hanMucMoiHoaDon: 11_000_000 }, { hanMucMoiNgay: 60_000_000 }, { soToiDa: 21 }, { cuaSoPhut: 30 }]) {
      expect(await luuHanMucKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", han: { ...han, ...noi }, lyDo: "Thử nới không xác nhận" })).toMatchObject({ ok: false });
    }
    expect(await docChinhSachKy("NEW_VISION")).toMatchObject({ hanMucMoiHoaDon: 10_000_000, hanMucMoiNgay: 50_000_000, soToiDa: 20, cuaSoPhut: 60 });
    // siết chặt + đổi ngưỡng cảnh báo: KHÔNG cần xác nhận nới
    expect(await luuHanMucKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", han: { ...han, hanMucMoiHoaDon: 5_000_000, soToiDa: 5, nguongTanSuat: 3 }, lyDo: "Siết chặt hạn mức theo chỉ đạo" })).toEqual({ ok: true });
    expect(await docChinhSachKy("NEW_VISION")).toMatchObject({ hanMucMoiHoaDon: 5_000_000, soToiDa: 5, nguongTanSuat: 3 });
  });

  it("[KCD-05] dùng hạn mức: tổng NGÀY (giờ VN) + số hoá đơn trong CỬA SỔ đếm từ sổ CHỈ cho hoá đơn do HỆ THỐNG tạo; cổng giữ chỗ FAIL-CLOSED khi chưa khai, và cộng dồn hoá đơn đã có", async () => {
    const giu = (soTien: number, now: Date, pn = "NEW_VISION") => db.$transaction((tx) => giuChoHanMucTrongTx(tx, { phapNhanMa: pn, soTien, now }));
    expect(await giu(1, new Date())).toMatchObject({ ok: false, ma: "CHUA_KHAI_HAN_MUC" });
    await luuHanMucKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", han: { hanMucMoiHoaDon: 6_000_000, hanMucMoiNgay: 10_000_000, soToiDa: 5, cuaSoPhut: 60, nguongTanSuat: null }, lyDo: "Khai hạn mức thử cho fixture", xacNhanNoiLong: true });
    const bayGio = new Date();
    // hoá đơn fixture do KẾ TOÁN tạo (không phải hệ thống) ⇒ KHÔNG ăn vào hạn mức ký tự động
    expect(await docSuDungHanMuc("NEW_VISION", 60, bayGio)).toEqual({ tongNgay: 0, soTrongCuaSo: 0 });
    // chuyển nó thành hoá đơn do HỆ THỐNG tạo (5.000.000đ, DANG_PHAT_HANH, tạo "bây giờ") ⇒ ăn vào hạn mức
    await db.hoaDonDienTu.update({ where: { id: HD }, data: { taoBoiId: SYSTEM_USER_ID } });
    expect(await docSuDungHanMuc("NEW_VISION", 60, bayGio)).toEqual({ tongNgay: 5_000_000, soTrongCuaSo: 1 });
    expect(await giu(5_000_000, bayGio)).toMatchObject({ ok: true });
    expect(await giu(5_000_001, bayGio)).toMatchObject({ ok: false, ma: "VUOT_NGAY" });
    expect(await giu(6_000_001, bayGio)).toMatchObject({ ok: false, ma: "VUOT_MOI_HOA_DON" });
    // loại chính hoá đơn đang xét khỏi số đếm (kiểm lại bản đã tạo mà không tính nó hai lần)
    expect(await docSuDungHanMuc("NEW_VISION", 60, bayGio, db, HD)).toEqual({ tongNgay: 0, soTrongCuaSo: 0 });
    // pháp nhân khác không bị ảnh hưởng bởi số đếm của pháp nhân này
    expect(await docSuDungHanMuc("SATA_ROBO", 60, bayGio)).toEqual({ tongNgay: 0, soTrongCuaSo: 0 });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[KSU] lệnh ký do HỆ THỐNG tạo + quét + báo kế toán", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[KSU-01] lệnh hệ thống: người yêu cầu = SYSTEM; MỘT kế toán nhận ký rồi ký được dưới chính sách NGHIÊM (không cần người thứ hai); lệnh ghi AI ký · LÚC NÀO · chứng thư nào; nhật ký có serial", async () => {
    const may = taoMayChuVinGia();
    const { lenhId, phien } = await toiPhien(may);
    if (!phien.ok) throw new Error(phien.error);
    const l0 = await lenhCuaHd();
    expect(l0).toMatchObject({ nguoiYeuCauId: NGUOI_YEU_CAU_HE_THONG, nguoiKyId: KE_TOAN_HO.userId, trangThai: "DANG_KY" });
    const kq = await hoanTat(may, lenhId, kyGia(phien.xmlChuaKyBase64));
    expect(kq.ok).toBe(true);
    const l = await lenhCuaHd();
    expect(l).toMatchObject({ trangThai: "DA_KY", nguoiKyId: KE_TOAN_HO.userId, chungThuSerial: SERIAL_CHUNG_THU_GIA });
    expect(l.kyLuc?.toISOString()).toBe(PHUT(2).toISOString());
    expect((await hoaDon()).soHoaDon).toMatch(/^\d{7}$/);
    const ls = await db.auditLog.findMany({ where: { entityType: "HoaDonLenhKy", entityId: lenhId }, orderBy: { createdAt: "asc" } });
    expect(ls.map((x) => x.action)).toEqual(["TAO_LENH_KY_HOA_DON", "DUYET_BAT_DAU_KY_HOA_DON", "HOAN_TAT_KY_HOA_DON"]);
    expect(ls[0]).toMatchObject({ actorId: null, actorName: "Hệ thống" });
    expect(ls[2]!.newValues).toMatchObject({ nguoiKyId: KE_TOAN_HO.userId, chungThuSerial: SERIAL_CHUNG_THU_GIA });
  });

  it("[KSU-02] ĐỐI CHỨNG ÂM: lệnh LẬP TAY (người yêu cầu = chính kế toán) vẫn chịu tách nhiệm vụ — người yêu cầu KHÔNG tự ký; SYSTEM không phải đường vòng cho lệnh tay", async () => {
    const t = await taoLenhKyUsb({ actor: KE_TOAN_HO, ten: "KT", hoaDonId: HD, now: NOW, env: ENV });
    if (!t.ok) throw new Error(t.error);
    expect((await lenhCuaHd()).nguoiYeuCauId).toBe(KE_TOAN_HO.userId);
    const tuKy = await duyetVaBatDauKy({ actor: KE_TOAN_HO, ten: "KT", lenhId: t.id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: NOW });
    expect(tuKy).toMatchObject({ ok: false, ma: "TACH_NHIEM_VU" });
    expect((await duyetVaBatDauKy({ actor: KE_TOAN_KHAC, ten: "KT2", lenhId: t.id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: NOW })).ok).toBe(true);
  });

  it("[KSU-03] tạo lệnh hệ thống IDEMPOTENT: lần hai ⇒ DA_CO_LENH_SONG, vẫn đúng MỘT lệnh; sau khi lệnh hết hạn thì tạo lệnh mới được", async () => {
    expect((await taoHeThong()).ok).toBe(true);
    expect(await taoHeThong()).toMatchObject({ ok: false, ma: "DA_CO_LENH_SONG" });
    expect(await db.hoaDonLenhKy.count({ where: { hoaDonId: HD } })).toBe(1);
    const sau = await taoLenhKyUsbHeThong({ hoaDonId: HD, now: PHUT(13 * 60), env: ENV });
    expect(sau.ok).toBe(true);
    expect(await db.hoaDonLenhKy.count({ where: { hoaDonId: HD, trangThai: "HET_HAN" } })).toBe(1);
  });

  it("[KSU-04] QUÉT: cờ TẮT ⇒ null và KHÔNG tạo gì; BẬT ⇒ tạo MỘT lệnh + báo gộp; chạy lại ⇒ không lệnh thứ hai và không báo trùng khoá", async () => {
    await bat("hoaDon.kyUsb", false);
    expect(await quetTaoLenhKyHeThong(NOW)).toBeNull();
    expect(await db.hoaDonLenhKy.count({ where: { hoaDonId: HD } })).toBe(0);
    await bat("hoaDon.kyUsb");
    const kq = (await quetTaoLenhKyHeThong(NOW))!;
    expect(kq).toMatchObject({ quet: 1, taoMoi: 1, daCo: 0, nhacTheoPhapNhan: 1 });
    expect(h.notify).toHaveBeenCalledTimes(1);
    const tb = h.notify.mock.calls[0]![0];
    expect(tb.dedupeKey).toBe("hoa-don.cho-ky:NEW_VISION:2026-11-04:0");
    expect(tb.userIds).toEqual(["fx-kcs-ke-toan-ho"]);
    expect(tb.body).toContain("1 hoá đơn");
    const lai = (await quetTaoLenhKyHeThong(PHUT(10)))!;
    expect(lai).toMatchObject({ taoMoi: 0, daCo: 1 });
    expect(await db.hoaDonLenhKy.count({ where: { hoaDonId: HD } })).toBe(1);
    expect(h.notify.mock.calls[1]![0].dedupeKey).toBe(tb.dedupeKey); // cùng nhịp ⇒ cùng khoá (notifyStaff không rung lại)
    // sau 2 giờ vẫn chưa ai ký ⇒ khoá MỚI (nhắc lại)
    await quetTaoLenhKyHeThong(PHUT(125));
    expect(h.notify.mock.calls[2]![0].dedupeKey).toMatch(/:1$/);
  });

  it("[KSU-05] QUÉT bỏ qua hoá đơn BẤT THƯỜNG: có ngoại lệ hoá đơn đang mở ⇒ không lệnh hệ thống (kế toán lập tay, chịu luật tách nhiệm vụ); lệnh trước đã LOI_KY / HUY ⇒ cần người quyết, không tự tạo lại", async () => {
    await db.hoaDonNgoaiLe.create({ data: { centerId: CS, loai: "NGHI_TRUNG", muc: "CAN_XU_LY", hoaDonId: HD, orderId: DON, trangThai: "MO", dedupeKey: `${T}ngoai-le` } });
    expect(await quetTaoLenhKyHeThong(NOW)).toMatchObject({ taoMoi: 0, boQuaNgoaiLe: 1 });
    expect(await db.hoaDonLenhKy.count({ where: { hoaDonId: HD } })).toBe(0);
    await db.hoaDonNgoaiLe.deleteMany({ where: { centerId: CS } });
    const t = await taoHeThong();
    if (!t.ok) throw new Error(t.error);
    await huyLenhKy({ actor: KE_TOAN_HO, ten: "KT", lenhId: t.id, lyDo: "Huỷ lệnh để kiểm lại nội dung hoá đơn", now: NOW });
    expect(await quetTaoLenhKyHeThong(PHUT(1))).toMatchObject({ taoMoi: 0, boQuaCanNguoi: 1 });
    expect(await db.hoaDonLenhKy.count({ where: { hoaDonId: HD } })).toBe(1);
  });

  it("[KSU-06] pháp nhân TẠM DỪNG: quét KHÔNG tạo lệnh và KHÔNG rủ ai ký; bật lại ⇒ quét tạo lệnh", async () => {
    await tamDungKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Nghi lộ khoá API VIN", suCo: true, now: NOW });
    expect(await quetTaoLenhKyHeThong(NOW)).toMatchObject({ taoMoi: 0, boQuaTamDung: 1, nhacTheoPhapNhan: 0 });
    expect(h.notify).not.toHaveBeenCalled();
    await batLaiKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Đã đổi khoá, rà soát xong", xacNhanSuCo: true });
    expect(await quetTaoLenhKyHeThong(PHUT(1))).toMatchObject({ taoMoi: 1 });
  });

  it("[KSU-07] báo kế toán đúng phạm vi: kế toán CƠ SỞ KHÁC không nhận; kế toán Hội sở (ALL) và kế toán đúng cơ sở của lệnh nhận", async () => {
    h.keToan.mockResolvedValue([
      { userId: "fx-kcs-cs-khac", phamVi: ["cs-khac"] },
      { userId: "fx-kcs-cs-dung", phamVi: [CS] },
      { userId: "fx-kcs-ho", phamVi: "ALL" },
    ]);
    await quetTaoLenhKyHeThong(NOW);
    expect(h.notify.mock.calls[0]![0].userIds).toEqual(["fx-kcs-cs-dung", "fx-kcs-ho"]);
    h.keToan.mockResolvedValue([{ userId: "fx-kcs-ke-toan-ho", phamVi: "ALL" }]);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[KSG] bảo toàn nội dung · chứng thư · tạm dừng · đúng pháp nhân", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[KSG-01] NỘI DUNG ĐỔI sau khi lập lệnh (số tiền / người mua) ⇒ bắt đầu phiên bị CHẶN, lệnh LOI_KY (NOI_DUNG_DOI), VIN KHÔNG nhận gì", async () => {
    const may = taoMayChuVinGia();
    const t = await taoHeThong();
    if (!t.ok) throw new Error(t.error);
    await duyetVaBatDauKy({ actor: KE_TOAN_HO, ten: "KT", lenhId: t.id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: NOW });
    const doi = JSON.parse(JSON.stringify(phieu()));
    doi.tongThanhToan = 50_000_000;
    doi.dong[0].thanhTien = 50_000_000;
    await db.hoaDonDienTu.update({ where: { id: HD }, data: { misaPhieu: doi } });
    const p = await batDauPhienKyUsb({ actor: KE_TOAN_HO, lenhId: t.id, now: NOW, env: ENV, fetchImpl: may.fetchImpl });
    expect(p).toMatchObject({ ok: false, ma: "NOI_DUNG_DOI" });
    expect(may.cuocGoi).toHaveLength(0);
    expect(await lenhCuaHd()).toMatchObject({ trangThai: "LOI_KY" });
    expect((await lenhCuaHd()).lyDo).toContain("NOI_DUNG_DOI");
  });

  it("[KSG-02] nội dung đổi GIỮA bắt đầu phiên và hoàn tất ⇒ hoàn tất bị chặn, KHÔNG gửi XML, hoá đơn không có số", async () => {
    const may = taoMayChuVinGia();
    const { lenhId, phien } = await toiPhien(may);
    if (!phien.ok) throw new Error(phien.error);
    const doi = JSON.parse(JSON.stringify(phieu()));
    doi.nguoiMua.hoTen = "Người mua bị thay";
    await db.hoaDonDienTu.update({ where: { id: HD }, data: { misaPhieu: doi } });
    expect(await hoanTat(may, lenhId, kyGia(phien.xmlChuaKyBase64))).toMatchObject({ ok: false, ma: "NOI_DUNG_DOI" });
    expect(dem(may, GUI_XML)).toBe(0);
    expect((await hoaDon()).soHoaDon).toBeNull();
    expect((await lenhCuaHd()).trangThai).toBe("LOI_KY");
  });

  it("[KSG-03] DÙNG NHẦM CHỨNG THƯ: XML ký bằng chứng thư KHÁC chứng thư đã khai (hoặc không kèm chứng thư) ⇒ KHÔNG gửi, lệnh LOI_KY (CHUNG_THU_LECH); đối chứng dương: đúng chứng thư thì gửi", async () => {
    for (const chungThu of [CHUNG_THU_KHAC_B64, null]) {
      await dung();
      const may = taoMayChuVinGia();
      const { lenhId, phien } = await toiPhien(may);
      if (!phien.ok) throw new Error(phien.error);
      expect(await hoanTat(may, lenhId, kyGia(phien.xmlChuaKyBase64, chungThu))).toMatchObject({ ok: false, ma: "CHUNG_THU_LECH" });
      expect(dem(may, GUI_XML)).toBe(0);
      expect((await hoaDon()).soHoaDon).toBeNull();
      expect(await lenhCuaHd()).toMatchObject({ trangThai: "LOI_KY", chungThuSerial: null });
    }
    await dung();
    const may = taoMayChuVinGia();
    const { lenhId, phien } = await toiPhien(may);
    if (!phien.ok) throw new Error(phien.error);
    expect((await hoanTat(may, lenhId, kyGia(phien.xmlChuaKyBase64))).ok).toBe(true);
    expect(dem(may, GUI_XML)).toBe(1);
  });

  it("[KSG-04] CHƯA khai serial chứng thư ⇒ KHÔNG bắt đầu phiên (không thể kiểm chứng thư nào là đúng); khai rồi thì được", async () => {
    await dung({ serial: null });
    const may = taoMayChuVinGia();
    const t = await taoHeThong();
    if (!t.ok) throw new Error(t.error);
    await duyetVaBatDauKy({ actor: KE_TOAN_HO, ten: "KT", lenhId: t.id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: NOW });
    expect(await batDauPhienKyUsb({ actor: KE_TOAN_HO, lenhId: t.id, now: NOW, env: ENV, fetchImpl: may.fetchImpl })).toMatchObject({ ok: false, ma: "CHUNG_THU" });
    expect(may.cuocGoi).toHaveLength(0);
  });

  it("[KSG-05] TẠM DỪNG giữa chừng: bắt đầu phiên / hoàn tất ⇒ TAM_DUNG, lệnh GIỮ NGUYÊN (DANG_KY, không bị đóng), VIN không nhận gì; bật lại ⇒ ký tiếp được; «lấy việc» của ứng dụng dừng cả lượt mà không đóng lệnh nào", async () => {
    const may = taoMayChuVinGia();
    const { lenhId, phien } = await toiPhien(may);
    if (!phien.ok) throw new Error(phien.error);
    const soCuoc = may.cuocGoi.length;
    await tamDungKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Nghi lộ khoá API VIN", suCo: false, now: PHUT(1) });
    expect(await hoanTat(may, lenhId, kyGia(phien.xmlChuaKyBase64))).toMatchObject({ ok: false, ma: "TAM_DUNG" });
    expect(await batDauPhienKyUsb({ actor: KE_TOAN_HO, lenhId, now: PHUT(1), env: ENV, fetchImpl: may.fetchImpl })).toMatchObject({ ok: false, ma: "TAM_DUNG" });
    expect(await layViecKeTiep({ actor: KE_TOAN_HO, now: PHUT(1), env: ENV, fetchImpl: may.fetchImpl })).toMatchObject({ ok: false, ma: "TAM_DUNG" });
    expect(may.cuocGoi.length).toBe(soCuoc);
    expect((await lenhCuaHd()).trangThai).toBe("DANG_KY");
    await batLaiKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Đã kiểm tra xong, ký lại", xacNhanSuCo: undefined });
    expect((await hoanTat(may, lenhId, kyGia(phien.xmlChuaKyBase64))).ok).toBe(true);
  });

  it("[KSG-06] tạm dừng chặn cả TẠO lệnh (lập tay lẫn hệ thống); cổng GUI chặn, TRA_CUU không", async () => {
    await tamDungKy({ actor: QUAN_TRI, nguoi: NGUOI, phapNhanMa: "NEW_VISION", lyDo: "Tạm dừng để đối soát", suCo: false, now: NOW });
    expect(await taoHeThong()).toMatchObject({ ok: false, ma: "TAM_DUNG" });
    expect(await taoLenhKyUsb({ actor: KE_TOAN_HO, ten: "KT", hoaDonId: HD, now: NOW, env: ENV })).toMatchObject({ ok: false, ma: "TAM_DUNG" });
    expect(await db.hoaDonLenhKy.count({ where: { hoaDonId: HD } })).toBe(0);
    expect(await layCongHsmChoPhapNhan("NEW_VISION", "GUI", { env: ENV })).toMatchObject({ ok: false, tamDung: true });
  });

  it("[KSG-07] ĐÚNG PHÁP NHÂN: kế toán Hội sở (ALL) ký được; kế toán một cơ sở chỉ ký khi pháp nhân của hoá đơn ĐÚNG là pháp nhân phát hành đang cấu hình của cơ sở đó — khác ⇒ PHAP_NHAN_KHAC, lệnh KHÔNG bị đóng", async () => {
    const may = taoMayChuVinGia();
    const csKeToan = actor(`${T}ke-toan-cs`, { centerScope: [CS] });
    expect(await duocKyChoPhapNhan(KE_TOAN_HO, { centerId: CS, phapNhanMa: "NEW_VISION" }, NOW)).toBe(true);
    // cơ sở CHƯA khai pháp nhân phát hành ⇒ kế toán cơ sở không ký được (fail-closed)
    expect(await duocKyChoPhapNhan(csKeToan, { centerId: CS, phapNhanMa: "NEW_VISION" }, NOW)).toBe(false);
    await db.cauHinhHoaDonCoSo.create({
      data: { centerId: CS, phapNhanMa: "SATA_ROBO", kyHieu: "1C26TSR", hieuLucTu: new Date("2026-01-01T00:00:00Z"), hieuLucDen: new Date("2026-12-31T00:00:00Z"), dangBat: true, taoBoiId: `${T}kt`, capNhatBoiId: `${T}kt` },
    });
    expect(await duocKyChoPhapNhan(csKeToan, { centerId: CS, phapNhanMa: "NEW_VISION" }, NOW)).toBe(false); // cơ sở này phát hành cho SATA_ROBO, không phải NEW_VISION
    const t = await taoHeThong();
    if (!t.ok) throw new Error(t.error);
    await duyetVaBatDauKy({ actor: csKeToan, ten: "KT CS", lenhId: t.id, chinhSach: CHINH_SACH_KY_NGHIEM_NHAT, now: NOW });
    expect(await batDauPhienKyUsb({ actor: csKeToan, lenhId: t.id, now: NOW, env: ENV, fetchImpl: may.fetchImpl })).toMatchObject({ ok: false, ma: "PHAP_NHAN_KHAC" });
    expect(may.cuocGoi).toHaveLength(0);
    expect((await lenhCuaHd()).trangThai).toBe("DANG_KY");
    // đối chứng dương: cơ sở này phát hành cho đúng NEW_VISION ⇒ kế toán cơ sở ký được
    await db.cauHinhHoaDonCoSo.updateMany({ where: { centerId: CS }, data: { phapNhanMa: "NEW_VISION", kyHieu: "1C26MNV" } });
    expect(await duocKyChoPhapNhan(csKeToan, { centerId: CS, phapNhanMa: "NEW_VISION" }, NOW)).toBe(true);
    expect((await batDauPhienKyUsb({ actor: csKeToan, lenhId: t.id, now: NOW, env: ENV, fetchImpl: may.fetchImpl })).ok).toBe(true);
  });
});
