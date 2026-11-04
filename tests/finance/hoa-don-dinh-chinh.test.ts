// Ca [DCDB-*] — ĐÍNH CHÍNH ký hiệu / số của hoá đơn ĐÃ XÁC NHẬN, trên Postgres THẬT (24/10/2026).
//
// Ca sinh ra tính năng: kế toán gõ ký hiệu `1C26MVS` cho tờ `1C26MNV-37`; trước đây chỉ sửa được bằng SQL trên DB.
// Thứ phải đo ở DB (test thuần không nói được gì):
//   · sửa xong: hoá đơn VẪN đã xác nhận, ký hiệu / số / ngày mới, nhật ký đủ cũ / mới / lý do / ai;
//   · KHÔNG đụng sổ tiền: Payment · Receipt · HoaDonKhoan · HoaDonGuiEmail · Order · pháp nhân · tệp — không đổi một byte;
//   · cổng chống trùng số trong DÃY (kể cả hoá đơn cũ lưu sai MST) và loại CHÍNH hoá đơn đang sửa;
//   · chỉ bản ĐÃ XÁC NHẬN do kế toán TẢI LÊN; bản nháp / không xuất / đã huỷ / phát hành qua MISA ⇒ từ chối;
//   · XML đính kèm đọc được mà lệch số mới ⇒ từ chối; hai lượt sửa cùng lúc ⇒ đúng một bên thắng.
// Mọi hoá đơn ĐÃ XÁC NHẬN đi qua ĐÚNG đường thật (`chotHoaDon`) — trừ ca dựng dãy cũ lưu sai MST (tạo thẳng dòng).
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const kho = vi.hoisted(() => ({ docXml: vi.fn(async (_khoa: string) => null as string | null) }));
vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
  kyUrlTaiVeHoaDon: async (khoa: string) => `https://r2.test/${khoa}`,
  docNoiDungXmlHoaDon: kho.docXml,
}));

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { chotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import {
  COT_NGUOI_MUA,
  dinhChinhSoHoaDon,
  goHoaDonChuaChot,
  huyHoaDonDaXacNhan,
  LoiGhiHoaDon,
  taoHoaDonChoLanThu,
  type SoDaThay,
} from "@/lib/finance/hoa-don/ghi-hoa-don";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";

if (!RUN_DB_TESTS) console.warn(`[DCDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-dc-";
const CS = `${T}center`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HS = `${T}hs`;
const GD = `${T}gd`;
const DON = `${T}don`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture" };
const SALE = `${T}sale`;
const P1 = `${T}p1`;
const P2 = `${T}p2`;
const NOW = new Date("2699-09-26T08:00:00Z");
const LY_DO = "Gõ nhầm ký hiệu — tờ hoá đơn in 1C26MNV";
const SATA = { ma: "SATA_ROBO", ten: "Công ty CP Sata Robo", maSoThue: "0402301783", diaChi: "Đà Nẵng", bat: true };
const NGAY = "2026-09-12";
const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function don() {
  const hd = await db.hoaDonDienTu.findMany({ where: { orderId: DON }, select: { id: true } });
  const gui = await db.hoaDonGuiEmail.findMany({ where: { hoaDonId: { in: hd.map((h) => h.id) } }, select: { id: true } });
  await db.emailQueue.deleteMany({ where: { contextId: { in: gui.map((g) => g.id) } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { in: gui.map((g) => `hoa-don.gui:${g.id}`) } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: hd.map((h) => h.id) } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollment.deleteMany({ where: { id: GD } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HS } });
  await db.center.deleteMany({ where: { id: CS } });
}

const khoan = (id: string, amount: number) =>
  db.payment.create({
    data: {
      id,
      orderId: DON,
      amount,
      method: "CASH",
      paidDate: new Date("2699-09-20T03:00:00Z"),
      saleStatus: "RECORDED",
      accountantStatus: "PENDING",
      enrollmentId: GD,
      recordedById: SALE,
      centerId: CS,
    },
  });

async function dungFixture() {
  await don();
  kho.docXml.mockReset();
  kho.docXml.mockResolvedValue(null);
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture DC", slug: `${T}co-so`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 5 fixture", slug: `${T}sata-5` } });
  await db.class.create({ data: { id: LOP, name: "Lớp fixture DC", courseId: KHOA } });
  await db.student.create({ data: { id: HS, name: "Bé DC" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA, finalPrice: 9_000_000 } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269927-000302",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH DC",
      customerPhone: "0999000778",
      customerEmail: "phuhuynh.dc@example.com",
      totalAmount: 9_000_000,
      centerId: CS,
    },
  });
}

let dem = 0;
const taoNhap = (ids: string[], o: { ky: string; so: string; xml?: boolean }) => {
  dem += 1;
  return taoHoaDonChoLanThu({
    nguoiGhi: KT,
    orderId: DON,
    centerId: CS,
    lanThuKey: `khoan:${ids.join(",")}`,
    khoan: ids.map((id) => ({ id, soTien: 3_000_000 })),
    loai: {
      trangThai: "NHAP",
      phapNhan: SATA,
      so: { kyHieu: o.ky, soHoaDon: o.so, ngayPhatHanh: D(NGAY) },
      guiEmailKhach: true,
      pdf: { khoa: `hoa-don/DC/${DON}/${dem}.pdf`, ten: `hd-${dem}.pdf`, co: 1000, sha256: `sha-dc-${dem}` },
      xml: o.xml ? { khoa: `hoa-don/DC/${DON}/${dem}.xml`, ten: `hd-${dem}.xml`, co: 500, sha256: `sha-dc-xml-${dem}` } : null,
      theoSoDaThu: null,
      tienTha: 0,
      xacMinhSo: "KHONG_CAN",
      xmlTrangThai: o.xml ? "KHOP_SO" : "KHONG_CO",
      ngoaiLeKyHieu: null,
    },
  });
};

const KT_CS = {
  userId: KT.id,
  isSuperAdmin: false,
  grantsAllow: new Set<string>(),
  permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: [CS] }],
} as unknown as Actor;

async function chot(hoaDonId: string) {
  const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId }, select: { updatedAt: true } });
  const donHt = await db.order.findUniqueOrThrow({ where: { id: DON }, select: COT_NGUOI_MUA });
  return chotHoaDon({
    nguoiChot: KT,
    actor: KT_CS,
    orderId: DON,
    hoaDonId,
    now: NOW,
    phienBan: hd.updatedAt,
    emailDuKien: nguoiMuaChoDon(donHt).email,
  });
}

/** Hoá đơn ĐÃ XÁC NHẬN qua đường thật, mang SAI ký hiệu như ca sinh ra tính năng (1C26MVS-37). */
async function daXacNhan(ids: string[], o: { ky: string; so: string; xml?: boolean } = { ky: "1C26MVS", so: "37" }): Promise<string> {
  const { id } = await taoNhap(ids, o);
  await chot(id);
  return id;
}

const THAY_GOC: SoDaThay = { kyHieu: "1C26MVS", soHoaDon: "37", ngayPhatHanh: NGAY };
const sua = (
  hoaDonId: string,
  so: { kyHieu: string; soHoaDon: string; ngay?: string },
  o: { daThay?: SoDaThay; lyDo?: string; daDoiChieuChungTu?: boolean } = {},
) =>
  dinhChinhSoHoaDon({
    nguoiSua: KT,
    orderId: DON,
    hoaDonId,
    so: { kyHieu: so.kyHieu, soHoaDon: so.soHoaDon, ngayPhatHanh: D(so.ngay ?? NGAY) },
    daThay: o.daThay ?? THAY_GOC,
    lyDo: o.lyDo ?? LY_DO,
    daDoiChieuChungTu: o.daDoiChieuChungTu ?? true,
    ngoaiLeKyHieu: null,
    doiChieuCauHinh: "KHOP",
  });

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiGhiHoaDon ? e.ma : String(e);
  }
}

const nhatKy = (id: string) => db.auditLog.findMany({ where: { entityId: id, action: "DINH_CHINH_SO_HOA_DON" } });

/** Mọi thứ KHÔNG ĐƯỢC đổi khi đính chính — chụp để so từng byte. */
async function chupSoTien() {
  return JSON.stringify({
    payments: await db.payment.findMany({ where: { orderId: DON }, orderBy: { id: "asc" } }),
    receipts: await db.receipt.findMany({ where: { paymentId: { startsWith: T } }, orderBy: { id: "asc" } }),
    khoan: await db.hoaDonKhoan.findMany({ where: { hoaDon: { orderId: DON } }, orderBy: [{ hoaDonId: "asc" }, { paymentId: "asc" }] }),
    guiEmail: await db.hoaDonGuiEmail.findMany({ where: { hoaDon: { orderId: DON } }, orderBy: { id: "asc" } }),
    order: await db.order.findUniqueOrThrow({ where: { id: DON } }),
  });
}

const XML = (o: { so: string; kh?: string; ngay?: string }) => `<?xml version="1.0" encoding="UTF-8"?>
<HDon><DLHDon><TTChung><PBan>2.0.1</PBan><KHMSHDon>1</KHMSHDon><KHHDon>${o.kh ?? "C26MNV"}</KHHDon>
<SHDon>${o.so}</SHDon><NLap>${o.ngay ?? NGAY}</NLap></TTChung>
<NDHDon><NBan><Ten>CÔNG TY</Ten><MST>0402341070</MST></NBan><NMua><Ten>A</Ten></NMua></NDHDon></DLHDon></HDon>`;

describe.skipIf(!RUN_DB_TESTS)("[DCDB] đính chính hoá đơn đã xác nhận — Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[DCDB-01] sửa ký hiệu 1C26MVS→1C26MNV: vẫn ĐÃ XÁC NHẬN, số mới, nhật ký đủ cũ/mới/lý do/ai · sổ tiền, RCP, khoản, thư, pháp nhân, tệp KHÔNG đổi", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]);
    // Chốt đã tạo lượt gửi email (guiEmailKhach=true); coi như thư ĐÃ ĐI để đo phần "thư mang số cũ".
    const daGui = (await db.hoaDonGuiEmail.updateMany({ where: { hoaDonId: id }, data: { trangThai: "DA_GUI" } })).count;
    expect(daGui).toBeGreaterThan(0);
    const truoc = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } });
    const soTienTruoc = await chupSoTien();
    expect(truoc).toMatchObject({ trangThai: "DA_XAC_NHAN", kyHieu: "1C26MVS", soHoaDon: "37" }); // tiền đề: đúng ca sinh ra tính năng
    expect(await db.receipt.count({ where: { paymentId: P1 } })).toBe(1);

    const kq = await sua(id, { kyHieu: "1C26MNV", soHoaDon: "37" });
    expect(kq).toEqual({
      truoc: THAY_GOC,
      sau: { kyHieu: "1C26MNV", soHoaDon: "37", ngayPhatHanh: NGAY },
      daGuiEmail: daGui,
    });

    const sau = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } });
    expect(sau).toMatchObject({ trangThai: "DA_XAC_NHAN", kyHieu: "1C26MNV", soHoaDon: "37" });
    // Từng cột khác của hoá đơn giữ nguyên (trừ updatedAt) — pháp nhân, tệp, tiền, người mua, email, nguồn.
    const { updatedAt: _a, kyHieu: _k, ...conLaiSau } = sau;
    const { updatedAt: _b, kyHieu: _l, ...conLaiTruoc } = truoc;
    expect(conLaiSau).toEqual(conLaiTruoc);
    expect(await chupSoTien()).toBe(soTienTruoc);

    const nk = await nhatKy(id);
    expect(nk).toHaveLength(1);
    expect(nk[0]).toMatchObject({ reason: LY_DO, actorId: KT.id, actorName: KT.name, module: "finance", entityType: "HoaDonDienTu" });
    expect(nk[0]!.oldValues).toMatchObject({ kyHieu: "1C26MVS", soHoaDon: "37", ngayPhatHanh: NGAY });
    expect(nk[0]!.newValues).toMatchObject({ kyHieu: "1C26MNV", soHoaDon: "37", ngayPhatHanh: NGAY, xmlTrangThai: "KHONG_CO", doiChieuCauHinh: "KHOP" });
  });

  it("[DCDB-02] sửa SỐ và NGÀY cũng được; ngoại lệ ký hiệu được ghi vào nhật ký kèm lý do", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]);
    await dinhChinhSoHoaDon({
      nguoiSua: KT,
      orderId: DON,
      hoaDonId: id,
      so: { kyHieu: "1C26MNV", soHoaDon: "41", ngayPhatHanh: D("2026-09-13") },
      daThay: THAY_GOC,
      lyDo: LY_DO,
      daDoiChieuChungTu: true,
      ngoaiLeKyHieu: { kyHieuNhap: "1C26MNV", kyHieuCauHinh: "1C26TSR", lyDo: "Theo biên bản kế toán trưởng" },
      doiChieuCauHinh: "NGOAI_LE",
    });
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({
      kyHieu: "1C26MNV",
      soHoaDon: "41",
      ngayPhatHanh: D("2026-09-13"),
    });
    const nk = (await nhatKy(id))[0]!;
    expect(nk.reason).toBe(`${LY_DO} | Theo biên bản kế toán trưởng`);
    expect(nk.newValues).toMatchObject({
      doiChieuCauHinh: "NGOAI_LE",
      ngoaiLeKyHieu: { kyHieuNhap: "1C26MNV", kyHieuCauHinh: "1C26TSR", lyDo: "Theo biên bản kế toán trưởng" },
    });
  });

  it("[DCDB-03] CHỈ bản ĐÃ XÁC NHẬN do kế toán TẢI LÊN: nháp · không xuất · đã huỷ · phát hành qua MISA ⇒ DA_DOI, không ghi gì", async () => {
    await khoan(P1, 3_000_000);
    await khoan(P2, 3_000_000);
    const nhap = await taoNhap([P1], { ky: "1C26MVS", so: "37" });
    const kx = await taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: DON,
      centerId: CS,
      lanThuKey: "kx",
      khoan: [{ id: P2, soTien: 3_000_000 }],
      loai: { trangThai: "KHONG_XUAT", lyDo: "Khách không lấy hoá đơn" },
    });
    for (const hoaDonId of [nhap.id, kx.id]) expect(await maLoi(sua(hoaDonId, { kyHieu: "1C26MNV", soHoaDon: "37" })), hoaDonId).toBe("DA_DOI");

    await chot(nhap.id);
    // MISA_API: số / ký hiệu do MISA cấp — nguồn sự thật là MISA, không sửa ở đây.
    await db.hoaDonDienTu.update({ where: { id: nhap.id }, data: { nguonPhatHanh: "MISA_API" } });
    expect(await maLoi(sua(nhap.id, { kyHieu: "1C26MNV", soHoaDon: "37" })), "MISA_API").toBe("DA_DOI");
    await db.hoaDonDienTu.update({ where: { id: nhap.id }, data: { nguonPhatHanh: "MISA_GIA_LAP" } });
    expect(await maLoi(sua(nhap.id, { kyHieu: "1C26MNV", soHoaDon: "37" })), "MISA_GIA_LAP").toBe("DA_DOI");
    await db.hoaDonDienTu.update({ where: { id: nhap.id }, data: { nguonPhatHanh: "TAI_LEN" } });

    // Đã huỷ ⇒ THAY_THE ⇒ không sửa được; sai đơn ⇒ không thấy.
    await huyHoaDonDaXacNhan({ nguoiHuy: KT, orderId: DON, hoaDonId: nhap.id, lyDo: "Tải nhầm tờ của khách khác", now: NOW });
    expect(await maLoi(sua(nhap.id, { kyHieu: "1C26MNV", soHoaDon: "37" })), "đã huỷ").toBe("DA_DOI");
    const xn = await daXacNhan([P1], { ky: "1C26MVS", so: "38" });
    expect(
      await maLoi(
        dinhChinhSoHoaDon({
          nguoiSua: KT,
          orderId: `${T}don-khac`,
          hoaDonId: xn,
          so: { kyHieu: "1C26MNV", soHoaDon: "38", ngayPhatHanh: D(NGAY) },
          daThay: { ...THAY_GOC, soHoaDon: "38" },
          lyDo: LY_DO,
          daDoiChieuChungTu: true,
          ngoaiLeKyHieu: null,
          doiChieuCauHinh: "KHOP",
        }),
      ),
      "sai đơn",
    ).toBe("DA_DOI");
    expect(await db.auditLog.count({ where: { entityId: { in: [nhap.id, kx.id, xn] }, action: "DINH_CHINH_SO_HOA_DON" } })).toBe(0);
  });

  it("[DCDB-04] ĐÃ ĐỔI: ba ô người dùng thấy lệch giá trị đang lưu (có người sửa trước) ⇒ DA_DOI, không ghi", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]);
    for (const daThay of [
      { ...THAY_GOC, kyHieu: "1C26XXX" },
      { ...THAY_GOC, soHoaDon: "36" },
      { ...THAY_GOC, ngayPhatHanh: "2026-09-11" },
      { kyHieu: null, soHoaDon: null, ngayPhatHanh: null },
    ]) {
      expect(await maLoi(sua(id, { kyHieu: "1C26MNV", soHoaDon: "37" }, { daThay })), JSON.stringify(daThay)).toBe("DA_DOI");
    }
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({ kyHieu: "1C26MVS" });
    expect(await nhatKy(id)).toHaveLength(0);
  });

  it("[DCDB-05] không đổi gì / thiếu ô / lý do ngắn ⇒ KHONG_DOI · THIEU_SO · THIEU_LY_DO, không ghi", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]);
    expect(await maLoi(sua(id, { kyHieu: "1C26MVS", soHoaDon: "37" }))).toBe("KHONG_DOI");
    for (const lyDo of ["", "   ", "nham"]) {
      expect(await maLoi(sua(id, { kyHieu: "1C26MNV", soHoaDon: "37" }, { lyDo })), JSON.stringify(lyDo)).toBe("THIEU_LY_DO");
    }
    expect(
      await maLoi(
        dinhChinhSoHoaDon({
          nguoiSua: KT,
          orderId: DON,
          hoaDonId: id,
          so: { kyHieu: "1C26MNV", soHoaDon: null, ngayPhatHanh: D(NGAY) },
          daThay: THAY_GOC,
          lyDo: LY_DO,
          daDoiChieuChungTu: true,
          ngoaiLeKyHieu: null,
          doiChieuCauHinh: "KHOP",
        }),
      ),
    ).toBe("THIEU_SO");
    expect(await nhatKy(id)).toHaveLength(0);
  });

  it("[DCDB-06] TRÙNG SỐ trong dãy (MST, ký hiệu) ⇒ TRUNG_SO — kể cả khi hoá đơn kia lưu MST SAI (kiểu 19 hoá đơn CS2) và là bản ĐÃ HUỶ", async () => {
    // Dãy cũ lưu sai MST: CS2 + 1C26MNV nhưng snapshot Sata (đúng hình dạng PROD). Rule "CS2 + 1C26MNV ⇒ New Vision" chỉ áp khi mã cơ sở
    // là CS2: dùng cơ sở CS2 CÓ SẴN trong DB dùng chung, chưa có thì gán mã cho cơ sở fixture.
    const thuc = await db.center.findFirst({ where: { code: "CS2" }, select: { id: true } });
    if (!thuc) await db.center.update({ where: { id: CS }, data: { code: "CS2" } });
    const cs2 = thuc?.id ?? CS;
    const dong = (so: string, ky: string, trangThai: "DA_XAC_NHAN" | "THAY_THE", mst = SATA.maSoThue) =>
      db.hoaDonDienTu.create({
        data: {
          orderId: DON,
          centerId: cs2,
          trangThai,
          kyHieu: ky,
          soHoaDon: so,
          ngayPhatHanh: D(NGAY),
          phapNhanMa: "SATA_ROBO",
          phapNhanTen: SATA.ten,
          phapNhanMst: mst,
          tongTien: 1000,
          taoBoiId: KT.id,
          ...(trangThai === "THAY_THE" ? { huyLyDo: "huỷ để test", huyBoiId: KT.id, huyLuc: NOW } : {}),
        },
        select: { id: true },
      });
    const a = await dong("9936", "1C26MNV", "DA_XAC_NHAN"); // số 36 của dãy, lưu sai MST Sata
    await dong("9938", "1C26MNV", "THAY_THE", "0402341070"); // số 38 đã huỷ, lưu đúng MST New Vision
    const b = await dong("9937", "1C26MVS", "DA_XAC_NHAN"); // bản nhập sai ký hiệu
    const thayB: SoDaThay = { kyHieu: "1C26MVS", soHoaDon: "9937", ngayPhatHanh: NGAY };

    // Sửa B sang đúng ký hiệu NHƯNG số của A ⇒ phải đụng A dù A lưu MST khác dòng B.
    expect(await maLoi(sua(b.id, { kyHieu: "1C26MNV", soHoaDon: "9936" }, { daThay: thayB })), "trùng bản lưu sai MST").toBe("TRUNG_SO");
    // Số của bản ĐÃ HUỶ vẫn đã tiêu ở phần mềm phát hành.
    expect(await maLoi(sua(b.id, { kyHieu: "1C26MNV", soHoaDon: "9938" }, { daThay: thayB })), "trùng bản đã huỷ").toBe("TRUNG_SO");
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ kyHieu: "1C26MVS", soHoaDon: "9937" });
    expect(await nhatKy(b.id)).toHaveLength(0);

    // Số chưa ai dùng ⇒ qua.
    expect(await maLoi(sua(b.id, { kyHieu: "1C26MNV", soHoaDon: "9937" }, { daThay: thayB }))).toBeNull();

    // Loại CHÍNH hoá đơn đang sửa: A đổi riêng NGÀY (cùng ký hiệu + số) không được tự va vào chính mình.
    const thayA: SoDaThay = { kyHieu: "1C26MNV", soHoaDon: "9936", ngayPhatHanh: NGAY };
    expect(await maLoi(sua(a.id, { kyHieu: "1C26MNV", soHoaDon: "9936", ngay: "2026-09-13" }, { daThay: thayA })), "tự trùng").toBeNull();
  });

  it("[DCDB-07] XML đính kèm: lệch số mới ⇒ XML_LECH (không ghi) · khớp ⇒ ghi, nhật ký 'KHOP_SO' · không đọc được ⇒ ghi, nhật ký 'KHONG_DOC_DUOC'", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1], { ky: "1C26MVS", so: "37", xml: true });

    kho.docXml.mockResolvedValue(XML({ so: "00000037" })); // XML nói MNV-37
    expect(await maLoi(sua(id, { kyHieu: "1C26MNV", soHoaDon: "38" })), "XML ghi 37, đang sửa 38").toBe("XML_LECH");
    expect(await nhatKy(id)).toHaveLength(0);
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({ kyHieu: "1C26MVS", soHoaDon: "37" });

    expect(await maLoi(sua(id, { kyHieu: "1C26MNV", soHoaDon: "37" }))).toBeNull(); // XML là bằng chứng của việc sửa này
    expect((await nhatKy(id))[0]!.newValues).toMatchObject({ xmlTrangThai: "KHOP_SO", xacMinh: "XML" });

    await khoan(P2, 3_000_000);
    const id2 = await daXacNhan([P2], { ky: "1C26MVS", so: "39", xml: true });
    kho.docXml.mockResolvedValue(null); // lỗi mạng / không thấy tệp
    expect(await maLoi(sua(id2, { kyHieu: "1C26MNV", soHoaDon: "39" }, { daThay: { ...THAY_GOC, soHoaDon: "39" } }))).toBeNull();
    expect((await nhatKy(id2))[0]!.newValues).toMatchObject({ xmlTrangThai: "KHONG_DOC_DUOC" });
  });

  it("[DCDB-08] hai người cùng sửa MỘT hoá đơn ⇒ đúng MỘT lượt thắng, bên kia DA_DOI, một nhật ký", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]);
    const kq = await Promise.allSettled([sua(id, { kyHieu: "1C26MNV", soHoaDon: "37" }), sua(id, { kyHieu: "1C26MXX", soHoaDon: "37" })]);
    expect(kq.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const thua = kq.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((thua.reason as LoiGhiHoaDon).ma).toBe("DA_DOI");
    expect(await nhatKy(id)).toHaveLength(1);
  });

  it("[DCDB-10] ghi CÓ ĐIỀU KIỆN theo phiên bản: người khác đang giữ dòng hoá đơn rồi commit XEN GIỮA lúc đọc và lúc ghi ⇒ DA_DOI, không đè lên thay đổi của họ", async () => {
    // Người khác sửa dòng này mà KHÔNG qua khoá đơn (vd một đường ghi chưa tồn tại). Giữ khoá hàng 700ms; lõi đọc phiên bản cũ
    // (MVCC), qua mọi cổng, rồi chặn ở `updateMany` tới khi họ commit — khi đó điều kiện `updatedAt` mới bắt được.
    // Nếu lõi đọc SAU khi họ commit thì `daThay` lệch ⇒ cũng DA_DOI: ca không bao giờ đỏ oan vì chậm.
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]);
    const nguoiKhac = db.$transaction(async (tx) => {
      await tx.hoaDonDienTu.update({ where: { id }, data: { maTraCuu: "NGUOI-KHAC" } });
      await new Promise((r) => setTimeout(r, 700));
    });
    await new Promise((r) => setTimeout(r, 150));
    const loi = await maLoi(sua(id, { kyHieu: "1C26MNV", soHoaDon: "37" }));
    await nguoiKhac;
    expect(loi).toBe("DA_DOI");
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({ kyHieu: "1C26MVS", maTraCuu: "NGUOI-KHAC" });
    expect(await nhatKy(id)).toHaveLength(0);
  });

  it("[DCDB-11] xếp hàng với mọi đường ghi khác trên CÙNG đơn: đang có người giữ khoá đơn ⇒ lõi ĐỢI, không chen ngang", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]);
    let nguoiKhacXong = 0;
    const nguoiKhac = db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, DON);
      await new Promise((r) => setTimeout(r, 600));
      nguoiKhacXong = Date.now();
    });
    await new Promise((r) => setTimeout(r, 150));
    await sua(id, { kyHieu: "1C26MNV", soHoaDon: "37" });
    const loiXong = Date.now();
    await nguoiKhac;
    // Lõi chỉ được xong SAU khi người giữ khoá nhả (commit). Không có khoá đơn thì nó xong trong vài chục ms.
    expect(loiXong).toBeGreaterThanOrEqual(nguoiKhacXong);
  });

  it("[DCDB-12] không có XML phủ ô vừa đổi ⇒ BẮT BUỘC lời khai đối chiếu chứng từ gốc (THIEU_DOI_CHIEU), nhật ký ghi 'lời khai' ≠ 'XML'", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]); // không XML
    const khongKhai = { daDoiChieuChungTu: false };
    expect(await maLoi(sua(id, { kyHieu: "1C26MNV", soHoaDon: "37" }, khongKhai)), "không XML, không khai").toBe("THIEU_DOI_CHIEU");
    expect(await nhatKy(id)).toHaveLength(0);
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({ kyHieu: "1C26MVS" });

    expect(await maLoi(sua(id, { kyHieu: "1C26MNV", soHoaDon: "37" }))).toBeNull(); // có khai
    expect((await nhatKy(id))[0]!.newValues).toMatchObject({ xmlTrangThai: "KHONG_CO", xacMinh: "KE_TOAN_DA_DOI_CHIEU" });
  });

  it("[DCDB-13] XML chỉ phủ SỐ mà ký hiệu cũng đổi ⇒ vẫn đòi lời khai · XML không đọc được ⇒ đòi lời khai · XML phủ đủ mọi ô đổi ⇒ KHÔNG đòi", async () => {
    const XML_CHI_SO = `<?xml version="1.0"?><HDon><DLHDon><TTChung><SHDon>00000037</SHDon></TTChung></DLHDon></HDon>`;
    await khoan(P1, 3_000_000);
    await khoan(P2, 3_000_000);
    const khongKhai = { daDoiChieuChungTu: false };

    // XML chỉ có SHDon: đổi riêng SỐ (37→38 ⇒ lệch XML nên từ chối) — dùng ca đổi ký hiệu: XML không nói gì về ký hiệu.
    const a = await daXacNhan([P1], { ky: "1C26MVS", so: "37", xml: true });
    kho.docXml.mockResolvedValue(XML_CHI_SO);
    expect(await maLoi(sua(a, { kyHieu: "1C26MNV", soHoaDon: "37" }, khongKhai)), "XML phủ số, ký hiệu đổi").toBe("THIEU_DOI_CHIEU");
    kho.docXml.mockResolvedValue(null); // không đọc được
    expect(await maLoi(sua(a, { kyHieu: "1C26MNV", soHoaDon: "37" }, khongKhai)), "XML không đọc được").toBe("THIEU_DOI_CHIEU");
    expect(await nhatKy(a)).toHaveLength(0);

    // XML chỉ phủ SỐ (khớp số MỚI 38) mà KÝ HIỆU cũng đổi ⇒ một ô được phủ, một ô không ⇒ vẫn đòi lời khai (phủ MỘT ô không đủ).
    kho.docXml.mockResolvedValue(`<?xml version="1.0"?><HDon><DLHDon><TTChung><SHDon>00000038</SHDon></TTChung></DLHDon></HDon>`);
    expect(await maLoi(sua(a, { kyHieu: "1C26MNV", soHoaDon: "38" }, khongKhai)), "XML phủ số mới, không phủ ký hiệu").toBe("THIEU_DOI_CHIEU");
    expect(await nhatKy(a)).toHaveLength(0);

    // XML phủ đủ ký hiệu + số + ngày: không cần khai.
    const b = await daXacNhan([P2], { ky: "1C26MVS", so: "39", xml: true });
    kho.docXml.mockResolvedValue(XML({ so: "00000039" }));
    expect(await maLoi(sua(b, { kyHieu: "1C26MNV", soHoaDon: "39" }, { ...khongKhai, daThay: { ...THAY_GOC, soHoaDon: "39" } }))).toBeNull();
    expect((await nhatKy(b))[0]!.newValues).toMatchObject({ xacMinh: "XML", xmlTrangThai: "KHOP_SO" });
  });

  it("[DCDB-09] sửa CHẶN gỡ sai: sau khi sửa, số cũ (ký hiệu cũ) TRỐNG lại và số mới bị giữ — tạo bản khác trùng số mới ⇒ TRUNG_SO", async () => {
    await khoan(P1, 3_000_000);
    await khoan(P2, 3_000_000);
    const id = await daXacNhan([P1]);
    await sua(id, { kyHieu: "1C26MNV", soHoaDon: "37" });
    // Một lần thu khác không được gõ lại đúng 1C26MNV-37 nữa.
    expect(await maLoi(taoNhap([P2], { ky: "1C26MNV", so: "37" }))).toBe("TRUNG_SO");
    // Còn số cũ 1C26MVS-37 thì không còn bị giữ.
    const moi = await taoNhap([P2], { ky: "1C26MVS", so: "37" });
    expect(moi.id).toBeTruthy();
    await goHoaDonChuaChot({ nguoiGhi: KT, orderId: DON, hoaDonId: moi.id });
  });
});
