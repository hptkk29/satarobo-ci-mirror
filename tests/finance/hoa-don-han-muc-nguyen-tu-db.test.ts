// Ca [HMN-*] — HẠN MỨC KÝ TỰ ĐỘNG: KIỂM + GIỮ CHỖ NGUYÊN TỬ trong giao dịch tạo hoá đơn (`batDauPhatHanh`, kieu `TU_DONG_HSM`) — Postgres THẬT (BGĐ 04/11/2026).
//
// ⚠️ Cái cần chứng minh KHÔNG phải luật so sánh (luật thuần đã có ở `ky-chinh-sach/luat.test.ts`) mà là tính NGUYÊN TỬ: nhiều worker cùng lúc, mỗi người một ĐƠN KHÁC NHAU (nên khoá đơn
// không chặn họ), mà tổng vẫn không vượt hạn mức. Ca đồng thời chỉ đáng tin khi đã CẤY LẠI lỗi (bỏ `FOR UPDATE`) và thấy nó đỏ — xem phép cấy trong hub/14 mục 10.
// Không gọi `resetDb()`: fixture tiền tố `fx-hmn-`, tự dọn. Đồng hồ: cột `createdAt` là giờ DB nên cửa sổ/ngày đếm theo giờ THẬT — ca dùng `new Date()` một lần ở đầu bộ.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentAccountantStatus as AccountantStatus, PaymentSaleStatus as SaleStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { SYSTEM_ACTOR, SYSTEM_USER_ID } from "@/lib/auth/system-actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { CongHoaDon, KetQuaPhatHanh, KetQuaTraCuu } from "@/lib/misa/meinvoice/cong";

vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
  luuTepHoaDon: async (i: { loai: "pdf" | "xml"; than: Uint8Array }) => ({ ok: true as const, co: i.than.length, sha256: `sha-${i.loai}-${i.than.length}` }),
  xoaTepHoaDon: async () => undefined,
}));

import { batDauPhatHanh, doiSoatPhatHanhTreo, guiPhatHanh, LoiPhatHanh, type KieuPhatHanh, type NguonPhieu } from "@/lib/finance/hoa-don/phat-hanh-misa";
import { CAU_HINH_HOA_DON_MAC_DINH } from "@/lib/finance/hoa-don/phap-nhan";
import { dungPhieuThuData } from "@/lib/finance/hoa-don/phieu-thu-data";
import { docSuDungHanMuc, lyDoKhongGuiDuocHoaDonHeThong, luuHanMucKy, tamDungKy } from "@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db";

if (!RUN_DB_TESTS) console.warn(`[HMN] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hmn-";
const CS = `${T}center`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const SALE = `${T}sale`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture HMN" };
const QUAN_TRI = { id: `${T}quan-tri`, name: "Quản trị tối cao" };
const SO_DON = 5;
// Số worker chạy ĐỒNG THỜI trong ca nguyên tử. KHÔNG được bằng cỡ pool: `lib/db.ts` đặt `connection_limit=5`, và `batDauPhatHanh` còn cần thêm một kết nối ngoài giao dịch ở đâu đó
// — 5 lượt song song làm cạn pool, mọi giao dịch quá 5 giây (đo: kể cả lượt BẤM TAY, không qua cổng hạn mức ⇒ có sẵn từ trước, xem hub/14 mục «Còn mở»).
const CONG_THOI = 4;
const SATA = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "SATA_ROBO")!;
const PDF = new TextEncoder().encode("%PDF-1.7 hoa don gia");
const XML = new TextEncoder().encode("<?xml version='1.0'?><HDon/>");
const NOW = new Date();
const TIEN = 3_000_000;

const id = (loai: string, i: number) => `${T}${loai}-${i}`;
const keToan = (): Actor =>
  ({ userId: KT.id, isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: [CS] }] }) as unknown as Actor;
const quanTri = { userId: QUAN_TRI.id, isSuperAdmin: true } as unknown as Actor;

async function don() {
  const dsDon = Array.from({ length: SO_DON }, (_, i) => id("don", i));
  const hds = await db.hoaDonDienTu.findMany({ where: { orderId: { in: dsDon } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: hds.map((x) => x.id) } }, { entityType: "HoaDonKyChinhSach" }] } });
  await db.hoaDonNgoaiLe.deleteMany({ where: { centerId: CS } });
  await db.hoaDonNghiaVu.deleteMany({ where: { orderId: { in: dsDon } } });
  await db.hoaDonDienTu.updateMany({ where: { orderId: { in: dsDon } }, data: { thayTheChoId: null } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: dsDon } } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: { in: dsDon } } });
  await db.order.deleteMany({ where: { id: { in: dsDon } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: `${T}gd-` } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { startsWith: `${T}hs-` } } });
  await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
  await db.center.deleteMany({ where: { id: CS } });
  await db.hoaDonKyChinhSach.deleteMany({});
}

async function dung(soTienMoiDon: readonly number[] = Array.from({ length: SO_DON }, () => TIEN)) {
  await don();
  await db.center.create({ data: { id: CS, code: "FXHMN", name: "Cơ sở fixture HMN", slug: `${T}co-so`, address: "211 NHT" } });
  // Cấu hình hoá đơn của cơ sở phủ MỌI năm (đồng hồ thật — createdAt là giờ DB): ca không phụ thuộc năm hiện tại.
  await db.cauHinhHoaDonCoSo.create({
    data: { centerId: CS, phapNhanMa: "SATA_ROBO", kyHieu: "1C99TSR", hieuLucTu: new Date("2000-01-01T00:00:00Z"), hieuLucDen: new Date("2999-12-31T00:00:00Z"), dangBat: true, taoBoiId: KT.id, capNhatBoiId: KT.id },
  });
  await db.course.create({ data: { id: KHOA, name: "Sata 4 fixture", slug: `${T}sata-4` } });
  await db.class.create({ data: { id: LOP, name: "Lớp HMN", courseId: KHOA } });
  for (let i = 0; i < soTienMoiDon.length; i++) {
    await db.student.create({ data: { id: id("hs", i), name: `Bé HMN ${i}` } });
    await db.enrollment.create({ data: { id: id("gd", i), studentId: id("hs", i), classId: LOP, courseId: KHOA, finalPrice: 9_000_000 } });
    await db.order.create({
      data: {
        id: id("don", i),
        code: `ORD-269931-00050${i}`,
        type: "COURSE",
        status: "CONFIRMED",
        customerName: "PH HMN",
        customerPhone: `099900050${i}`,
        customerAddress: "12 Lê Lợi, Đà Nẵng",
        invoiceEmail: "ph-hmn@example.com",
        totalAmount: 9_000_000,
        centerId: CS,
      },
    });
    await db.payment.create({
      data: {
        id: id("p", i),
        orderId: id("don", i),
        amount: soTienMoiDon[i]!,
        method: "CASH",
        note: null,
        paidDate: new Date(Date.now() - 86_400_000),
        saleStatus: SaleStatus.RECORDED,
        accountantStatus: AccountantStatus.PENDING,
        enrollmentId: id("gd", i),
        recordedById: SALE,
        centerId: CS,
      },
    });
  }
}

const datChinhSach = (o: Partial<{ hanMucMoiHoaDon: number | null; hanMucMoiNgay: number | null; soToiDa: number | null; cuaSoPhut: number | null; nguongTanSuat: number | null; tamDung: boolean }> = {}) =>
  db.hoaDonKyChinhSach.create({
    data: {
      phapNhanMa: "SATA_ROBO",
      capNhatBoiId: QUAN_TRI.id,
      hanMucMoiHoaDon: o.hanMucMoiHoaDon === undefined ? 10_000_000 : o.hanMucMoiHoaDon,
      hanMucMoiNgay: o.hanMucMoiNgay === undefined ? 100_000_000 : o.hanMucMoiNgay,
      soToiDa: o.soToiDa === undefined ? 2 : o.soToiDa,
      cuaSoPhut: o.cuaSoPhut === undefined ? 60 : o.cuaSoPhut,
      nguongTanSuat: o.nguongTanSuat === undefined ? null : o.nguongTanSuat,
      ...(o.tamDung ? { tamDung: true, tamDungLuc: NOW, tamDungBoiId: QUAN_TRI.id, tamDungLyDo: "Tạm dừng để kiểm tra fixture" } : {}),
    },
  });

const nguon = (soTien: number): NguonPhieu => ({
  trang: [
    dungPhieuThuData({
      maPhieu: null,
      ngayLap: "29/09/2699",
      phapNhan: SATA,
      cauHinh: CAU_HINH_HOA_DON_MAC_DINH,
      don: {
        code: "ORD-269931-000500",
        type: "COURSE",
        customerName: "PH HMN",
        customerPhone: "0999000500",
        customerEmail: null,
        customerAddress: "12 Lê Lợi, Đà Nẵng",
        customerWard: null,
        customerCity: null,
        customerCccd: null,
        invoiceBuyerName: null,
        invoiceCompanyName: null,
        invoiceTaxCode: null,
        invoiceCustomerCode: null,
        invoiceEmail: "ph-hmn@example.com",
      },
      soTien,
      hinhThucThanhToan: "Tiền mặt",
      tenKhoa: "Sata 4 fixture",
      tenHocVien: "Bé HMN",
      tenLop: "Lớp HMN",
      nguoiThu: null,
      dongDon: [],
    }),
  ],
  phuongThuc: [{ ma: "CASH", nhan: "Tiền mặt" }],
});

/** Một lượt phát hành cho đơn thứ `i`. `kieu` mặc định `TU_DONG_HSM` (người gọi là hệ thống — như runner). */
const batDau = (i: number, soTien = TIEN, kieu: KieuPhatHanh = "TU_DONG_HSM", o: { now?: Date } = {}) =>
  batDauPhatHanh({
    nguoiBam: kieu === "BAM_TAY" ? KT : { id: SYSTEM_USER_ID, name: "Hệ thống (HMN)" },
    actor: kieu === "BAM_TAY" ? keToan() : SYSTEM_ACTOR,
    orderId: id("don", i),
    centerId: CS,
    lanThuKey: `khoan:${id("p", i)}`,
    khoan: [{ id: id("p", i), soTien }],
    nguon: nguon(soTien),
    cheDo: "HSM",
    nhaCungCap: "MISA_MEINVOICE",
    now: o.now ?? NOW,
    kieu,
  });

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiPhatHanh ? e.ma : String(e);
  }
}
const soHoaDon = () => db.hoaDonDienTu.count({ where: { orderId: { startsWith: `${T}don-` } } });

type CongGia = CongHoaDon & { daGui: string[]; kichBanTraCuu: (KetQuaTraCuu | "NEM")[]; kichBanPhatHanh: (KetQuaPhatHanh | "NEM")[] };
let soGia = 0;
function congGia(): CongGia {
  const c: CongGia = {
    cheDo: "HSM",
    moiTruong: "sandbox",
    daGui: [],
    kichBanTraCuu: [],
    kichBanPhatHanh: [],
    async phatHanh(phieu) {
      c.daGui.push(phieu.refId);
      const k = c.kichBanPhatHanh.shift();
      if (k === "NEM") throw new Error("ECONNRESET giả");
      if (k) return k;
      const so = `${++soGia + 700}`;
      return { loai: "DA_PHAT_HANH", refId: phieu.refId, kyHieu: "1C99TSR", soHoaDon: so, ngayPhatHanh: new Date(), maTraCuu: `TRA-${so}` };
    },
    async traCuu() {
      const k = c.kichBanTraCuu.shift() ?? { loai: "CHUA_CO" };
      if (k === "NEM") throw new Error("timeout giả");
      return k;
    },
    async taiTep(_ma, loai) {
      return loai === "pdf" ? PDF : XML;
    },
  };
  return c;
}

describe.skipIf(!RUN_DB_TESTS)("[HMN] hạn mức ký tự động — kiểm + giữ chỗ nguyên tử", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[HMN-01] ĐỒNG THỜI: 4 worker, 4 ĐƠN KHÁC NHAU, soToiDa = 2 ⇒ đúng 2 hoá đơn được tạo, 2 lượt kia VUOT_HAN_MUC (không ai lọt vì đọc cùng lúc)", async () => {
    await datChinhSach({ soToiDa: 2 });
    const kq = await Promise.allSettled(Array.from({ length: CONG_THOI }, (_, i) => batDau(i)));
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(2);
    const tuChoi = kq.filter((k): k is PromiseRejectedResult => k.status === "rejected");
    expect(tuChoi).toHaveLength(CONG_THOI - 2);
    for (const t of tuChoi) expect(t.reason).toBeInstanceOf(LoiPhatHanh);
    for (const t of tuChoi) expect((t.reason as LoiPhatHanh).ma).toBe("VUOT_HAN_MUC");
    expect(await soHoaDon()).toBe(2);
    expect(await docSuDungHanMuc("SATA_ROBO", 60, NOW)).toEqual({ tongNgay: 2 * TIEN, soTrongCuaSo: 2 });
  });

  it("[HMN-02] ĐỒNG THỜI theo TIỀN: hạn mức NGÀY 7.000.000đ, 4 hoá đơn × 3.000.000đ cùng lúc ⇒ đúng 2 hoá đơn (6tr), không ai vượt 7tr", async () => {
    await datChinhSach({ hanMucMoiNgay: 7_000_000, soToiDa: 50 });
    const kq = await Promise.allSettled(Array.from({ length: CONG_THOI }, (_, i) => batDau(i)));
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(2);
    const dung = await docSuDungHanMuc("SATA_ROBO", 60, NOW);
    expect(dung.tongNgay).toBeLessThanOrEqual(7_000_000);
    expect(await soHoaDon()).toBe(2);
  });

  it("[HMN-03] FAIL-CLOSED: chưa có dòng chính sách ⇒ không tự phát hành (CHUA_KHAI), không để lại hoá đơn; khai thiếu cửa sổ/hạn mức ⇒ cũng không", async () => {
    expect(await maLoi(batDau(0))).toBe("VUOT_HAN_MUC");
    expect(await soHoaDon()).toBe(0);
    await datChinhSach({ hanMucMoiNgay: null });
    expect(await maLoi(batDau(0))).toBe("VUOT_HAN_MUC");
    expect(await soHoaDon()).toBe(0);
    // Khoản vẫn còn nguyên để kế toán xử lý (không bị khoá vào hoá đơn nào).
    expect(await db.hoaDonKhoan.count({ where: { paymentId: { startsWith: T } } })).toBe(0);
  });

  it("[HMN-04] MỖI HOÁ ĐƠN: hoá đơn gộp nhiều khoản đo theo TỔNG; chạm đúng hạn mức vẫn được, hơn một đồng thì không", async () => {
    await dung([3_000_001, 3_000_000, TIEN, TIEN, TIEN]);
    await datChinhSach({ hanMucMoiHoaDon: 3_000_000 });
    expect(await maLoi(batDau(0, 3_000_001))).toBe("VUOT_HAN_MUC");
    expect(await maLoi(batDau(1, 3_000_000))).toBeNull();
  });

  it("[HMN-05] TẠM DỪNG đọc LẠI dưới khoá: pháp nhân đang dừng ⇒ TAM_DUNG_KY, không tạo gì; bật lại bằng đường thật thì tạo được", async () => {
    await datChinhSach({ tamDung: true });
    expect(await maLoi(batDau(0))).toBe("TAM_DUNG_KY");
    expect(await soHoaDon()).toBe(0);
    await db.hoaDonKyChinhSach.update({ where: { phapNhanMa: "SATA_ROBO" }, data: { tamDung: false, tamDungLuc: null, tamDungBoiId: null, tamDungLyDo: null } });
    expect(await maLoi(batDau(0))).toBeNull();
  });

  it("[HMN-06] ĐỔI HẠN MỨC CÓ HIỆU LỰC NGAY, không cache/khởi động lại: nâng ⇒ lượt chặn trước đó qua; hạ ⇒ lượt kế bị chặn", async () => {
    await datChinhSach({ soToiDa: 1 });
    expect(await maLoi(batDau(0))).toBeNull();
    expect(await maLoi(batDau(1))).toBe("VUOT_HAN_MUC");
    const nang = await luuHanMucKy({
      actor: quanTri,
      nguoi: QUAN_TRI,
      phapNhanMa: "SATA_ROBO",
      han: { hanMucMoiHoaDon: 10_000_000, hanMucMoiNgay: 100_000_000, soToiDa: 3, cuaSoPhut: 60, nguongTanSuat: null },
      lyDo: "BGĐ duyệt nâng số hoá đơn tối đa",
      xacNhanNoiLong: true,
    });
    expect(nang).toEqual({ ok: true });
    expect(await maLoi(batDau(1))).toBeNull();
    const ha = await luuHanMucKy({
      actor: quanTri,
      nguoi: QUAN_TRI,
      phapNhanMa: "SATA_ROBO",
      han: { hanMucMoiHoaDon: 10_000_000, hanMucMoiNgay: 100_000_000, soToiDa: 2, cuaSoPhut: 60, nguongTanSuat: null },
      lyDo: "Siết lại số hoá đơn tối đa",
    });
    expect(ha).toEqual({ ok: true });
    expect(await maLoi(batDau(2))).toBe("VUOT_HAN_MUC");
  });

  it("[HMN-07] ĐẾM ĐÚNG THỨ: chỉ hoá đơn do HỆ THỐNG tạo ăn vào hạn mức — hoá đơn kế toán bấm tay KHÔNG; hoá đơn đã LỖI (nhà cung cấp từ chối) KHÔNG; hoá đơn của pháp nhân KHÁC không", async () => {
    await datChinhSach({ soToiDa: 1, hanMucMoiNgay: 10_000_000 });
    expect(await maLoi(batDau(0, TIEN, "BAM_TAY"))).toBeNull(); // bấm tay: không cần chính sách, không ăn hạn mức
    expect(await docSuDungHanMuc("SATA_ROBO", 60, NOW)).toEqual({ tongNgay: 0, soTrongCuaSo: 0 });
    expect(await maLoi(batDau(1))).toBeNull(); // hệ thống: vẫn còn chỗ vì hoá đơn tay không tính
    expect(await docSuDungHanMuc("SATA_ROBO", 60, NOW)).toEqual({ tongNgay: TIEN, soTrongCuaSo: 1 });
    // hoá đơn hệ thống bị nhà cung cấp TỪ CHỐI chắc chắn ⇒ nhả chỗ
    await db.hoaDonDienTu.updateMany({ where: { orderId: id("don", 1) }, data: { trangThai: "LOI_PHAT_HANH" } });
    expect(await docSuDungHanMuc("SATA_ROBO", 60, NOW)).toEqual({ tongNgay: 0, soTrongCuaSo: 0 });
    expect(await docSuDungHanMuc("NEW_VISION", 60, NOW)).toEqual({ tongNgay: 0, soTrongCuaSo: 0 });
  });

  it("[HMN-08] TỰ ĐỘNG USB: không có HSM nào để giới hạn — pháp nhân chưa khai gì vẫn LẬP được bản (kế toán ký sau)", async () => {
    expect(await maLoi(batDau(0, TIEN, "TU_DONG_USB"))).toBeNull();
    expect(await soHoaDon()).toBe(1);
  });

  it("[HMN-09] CẢNH BÁO TẦN SUẤT: đạt ngưỡng ⇒ hoá đơn vẫn được tạo nhưng trả `canhBaoTanSuat`; dưới ngưỡng ⇒ null", async () => {
    await datChinhSach({ soToiDa: 10, nguongTanSuat: 2 });
    expect((await batDau(0)).canhBaoTanSuat).toBeNull();
    expect((await batDau(1)).canhBaoTanSuat).toMatch(/Tần suất ký tự động cao/);
    expect(await soHoaDon()).toBe(2);
  });

  it("[HMN-10] RETRY / TIMEOUT KHÔNG TÍNH TRÙNG: gửi KHONG_RO rồi gửi lại cùng refId vẫn là MỘT hoá đơn trong hạn mức; hoá đơn kế tiếp thấy đúng một chỗ đã giữ", async () => {
    await datChinhSach({ soToiDa: 2 });
    const { hoaDonId, refId } = await batDau(0);
    const cong = congGia();
    cong.kichBanPhatHanh.push("NEM"); // timeout: không rõ đã phát hành chưa
    const s = await guiPhatHanh({ nguoiGoiId: null, hoaDonId, cong, now: NOW });
    expect(s.trangThai).toBe("DANG_PHAT_HANH");
    expect(await docSuDungHanMuc("SATA_ROBO", 60, NOW)).toEqual({ tongNgay: TIEN, soTrongCuaSo: 1 });
    // đối soát gửi lại CÙNG refId (lượt trước > 10 phút) — vẫn đúng một bản
    const muon = new Date(NOW.getTime() + 20 * 60_000);
    await doiSoatPhatHanhTreo({ cong, now: muon, slaKhongRoPhut: null });
    expect(cong.daGui).toEqual([refId, refId]);
    expect(await soHoaDon()).toBe(1);
    expect((await docSuDungHanMuc("SATA_ROBO", 60, NOW)).soTrongCuaSo).toBe(1);
    // hoá đơn kế tiếp: còn ĐÚNG một chỗ
    expect(await maLoi(batDau(1))).toBeNull();
    expect(await maLoi(batDau(2))).toBe("VUOT_HAN_MUC");
  });

  it("[HMN-11] KIỂM LẠI TRƯỚC KHI GỬI: bản HỆ THỐNG chưa từng gửi mà hạn mức mỗi hoá đơn vừa bị hạ ⇒ cron KHÔNG gửi (chỉ tra cứu), bản ở lại DANG_PHAT_HANH kèm lý do; nâng lại ⇒ gửi", async () => {
    await datChinhSach({ hanMucMoiHoaDon: 10_000_000 });
    const { hoaDonId } = await batDau(0);
    await db.hoaDonKyChinhSach.update({ where: { phapNhanMa: "SATA_ROBO" }, data: { hanMucMoiHoaDon: 1_000_000 } }); // hạ SAU khi bản đã lập, TRƯỚC khi gửi
    const cong = congGia();
    const muon = new Date(NOW.getTime() + 3 * 60_000);
    await doiSoatPhatHanhTreo({ cong, now: muon, slaKhongRoPhut: null, chanChuaGui: lyDoKhongGuiDuocHoaDonHeThong });
    expect(cong.daGui).toEqual([]);
    const giu = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    expect(giu).toMatchObject({ trangThai: "DANG_PHAT_HANH", misaGuiLuc: null });
    expect(giu.misaLoiThongDiep).toMatch(/Chưa gửi nhà cung cấp/);
    await db.hoaDonKyChinhSach.update({ where: { phapNhanMa: "SATA_ROBO" }, data: { hanMucMoiHoaDon: 10_000_000 } });
    await doiSoatPhatHanhTreo({ cong, now: muon, slaKhongRoPhut: null, chanChuaGui: lyDoKhongGuiDuocHoaDonHeThong });
    expect(cong.daGui).toHaveLength(1);
  });

  it("[HMN-12] KHÔNG GIẢ ĐỊNH THU HỒI ĐƯỢC: bản ĐÃ gửi (có `misaGuiLuc`) mà hạn mức hạ sau đó vẫn được đối soát gửi lại cùng refId — không bị chặn bởi hạn mức; bản do NGƯỜI bấm tay cũng không bị chặn", async () => {
    await datChinhSach({ hanMucMoiHoaDon: 10_000_000 });
    const { hoaDonId: daGui, refId } = await batDau(0);
    await db.hoaDonDienTu.update({ where: { id: daGui }, data: { misaGuiLuc: new Date(NOW.getTime() - 30 * 60_000), misaSoLanGui: 1 } });
    const { hoaDonId: tay } = await batDau(1, TIEN, "BAM_TAY");
    await db.hoaDonKyChinhSach.update({ where: { phapNhanMa: "SATA_ROBO" }, data: { hanMucMoiHoaDon: 1_000_000 } });
    expect(await lyDoKhongGuiDuocHoaDonHeThong(daGui)).not.toBeNull(); // bản chưa gửi cùng cỡ sẽ bị giữ…
    expect(await lyDoKhongGuiDuocHoaDonHeThong(tay)).toBeNull(); // …còn bản của người thì không bao giờ
    const cong = congGia();
    const muon = new Date(NOW.getTime() + 20 * 60_000);
    await doiSoatPhatHanhTreo({ cong, now: muon, slaKhongRoPhut: null, chanChuaGui: lyDoKhongGuiDuocHoaDonHeThong });
    expect(cong.daGui).toContain(refId); // bản đã gửi: tra cứu + gửi lại cùng refId, hạn mức không can thiệp
  });

  it("[HMN-14] HAI đường tự động cùng nhắm MỘT lần thu (lô 23h + tự xuất, hay hai lượt cron chồng nhau) ⇒ đúng MỘT hoá đơn, lượt kia DA_CO_HOA_DON, chỉ MỘT chỗ hạn mức bị giữ", async () => {
    await datChinhSach({ soToiDa: 10 });
    const kq = await Promise.allSettled([batDau(0), batDau(0)]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    const tuChoi = kq.filter((k): k is PromiseRejectedResult => k.status === "rejected");
    expect(tuChoi).toHaveLength(1);
    expect((tuChoi[0]!.reason as LoiPhatHanh).ma).toBe("DA_CO_HOA_DON");
    expect(await soHoaDon()).toBe(1);
    expect(await docSuDungHanMuc("SATA_ROBO", 60, NOW)).toEqual({ tongNgay: TIEN, soTrongCuaSo: 1 });
  });

  it("[HMN-13] tạm dừng giữa chừng chặn cả bản chưa gửi lẫn tạo mới; `tamDungKy` thật ghi đúng dòng mà cổng khoá", async () => {
    await datChinhSach();
    const { hoaDonId } = await batDau(0);
    const t = await tamDungKy({ actor: quanTri, nguoi: QUAN_TRI, phapNhanMa: "SATA_ROBO", lyDo: "Nghi lộ khoá API VIN — fixture", suCo: true, now: NOW });
    expect(t).toEqual({ ok: true });
    expect(await maLoi(batDau(1))).toBe("TAM_DUNG_KY");
    expect(await lyDoKhongGuiDuocHoaDonHeThong(hoaDonId)).toMatch(/tạm dừng/);
  });
});
