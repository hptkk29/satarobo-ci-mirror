// Ca [PHM-1x..3x] — MÁY TRẠNG THÁI "Phát hành qua MISA" (bước 1, 30/09/2026) trên Postgres THẬT, cổng MISA GIẢ.
// docs/ke-toan-hoa-don/PLAN.md mục "Bước 1 — Phát hành qua MISA".
//
//   · DA_PHAT_HANH ⇒ số ghi NGAY → PDF + XML vào kho → DA_XAC_NHAN + ĐÚNG hệ quả của `chotHoaDon` (email, RCP, nhật ký).
//   · GIA_LAP ⇒ không bao giờ email khách.
//   · TU_CHOI ⇒ LOI_PHAT_HANH; "Phát hành lại" refId MỚI; "Bỏ, làm tay" nhả khoản.
//   · KHONG_RO ⇒ giữ; kiểm tra lại: CHUA_CO ⇒ gửi lại CÙNG refId; DA_PHAT_HANH ⇒ hoàn tất.
//   · Tải tệp hỏng ⇒ giữ số; đối soát tải lại, KHÔNG phát hành lần hai.
//   · Hai lượt bấm song song ⇒ MỘT bản ghi. Luồng tay không tạo được bản thứ hai khi đang phát hành.
//   · MỌI cổng của `chotHoaDon` cũng chặn `batDauPhatHanh` (bảng ca dùng chung) — không ghi gì.
//
// Kho tệp (R2) GIẢ ở tầng `luuTepHoaDon` — khuôn `hoa-don-*` khác: bộ DB không chạm mạng. Khoá tệp vẫn dựng
// bằng `khoaTepHoaDon` THẬT (ca kiểm khoá thuộc đúng đơn + cơ sở).
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  luu: vi.fn(async (i: { khoa: string; loai: "pdf" | "xml"; than: Uint8Array }) => ({
    ok: true as const,
    co: i.than.length,
    sha256: `sha-${i.loai}-${i.than.length}`,
  })),
  xoa: vi.fn(async (_k: string) => undefined),
}));
vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  luuTepHoaDon: h.luu,
  xoaTepHoaDon: h.xoa,
}));

import { PaymentAccountantStatus as AccountantStatus, PaymentSaleStatus as SaleStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { CongHoaDon, DaPhatHanh, KetQuaPhatHanh, KetQuaTraCuu, PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import {
  batDauPhatHanh,
  boPhatHanhLamTay,
  doiSoatPhatHanhTreo,
  guiPhatHanh,
  kiemTraMotBan,
  LoiPhatHanh,
  phatHanhLai,
  type NguonPhieu,
} from "@/lib/finance/hoa-don/phat-hanh-misa";
import { LoiChotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { LoiGhiHoaDon, taoHoaDonChoLanThu } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { khoanDaKhoaHoaDon } from "@/lib/finance/hoa-don/khoa-khoan";
import { khoaThuocDon } from "@/lib/finance/hoa-don/kho-tep";
import { CAU_HINH_HOA_DON_MAC_DINH, type PhapNhan } from "@/lib/finance/hoa-don/phap-nhan";
import { dungPhieuThuData } from "@/lib/finance/hoa-don/phieu-thu-data";
import { gatewayMarker, installmentMarker } from "@/lib/finance/payment-markers";

if (!RUN_DB_TESTS) console.warn(`[PHM] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-phm-";
const CS = `${T}center`;
const MA_CS = "FXPHM";
const CS2 = `${T}center-2`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HS = `${T}hs`;
const GD = `${T}gd`;
const DON = `${T}don`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture PHM" };
const SALE = `${T}sale`;
const P1 = `${T}p1`;
const NOW = new Date("2699-09-30T03:00:00Z");
const PHUT = 60_000;
const SATA = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "SATA_ROBO")!;
const NEW_VISION = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.find((p) => p.ma === "NEW_VISION")!;
const PDF = new TextEncoder().encode("%PDF-1.7 hoa don gia");
const XML = new TextEncoder().encode("<?xml version='1.0'?><HDon/>");

const keToan = (centerScope: "ALL" | string[]): Actor =>
  ({
    userId: KT.id,
    isSuperAdmin: false,
    grantsAllow: new Set<string>(),
    permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope }],
  }) as unknown as Actor;
const KT_CS = keToan([CS]);

// ─── Cổng MISA giả: kịch bản theo lượt gọi, ghi lại MỌI phiếu đã gửi ──────────────────────────────────
type CongGia = CongHoaDon & {
  daGui: PhieuPhatHanh[];
  daTraCuu: string[];
  kichBanPhatHanh: (KetQuaPhatHanh | "NEM")[];
  kichBanTraCuu: (KetQuaTraCuu | "NEM")[];
  kichBanTaiTep: ("OK" | "NEM")[];
};
let soGia = 0;
function congGia(cheDo: CongHoaDon["cheDo"] = "HSM"): CongGia {
  const c: CongGia = {
    cheDo,
    moiTruong: cheDo === "GIA_LAP" ? "gia-lap" : "sandbox",
    daGui: [],
    daTraCuu: [],
    kichBanPhatHanh: [],
    kichBanTraCuu: [],
    kichBanTaiTep: [],
    async phatHanh(phieu) {
      c.daGui.push(phieu);
      const k = c.kichBanPhatHanh.shift() ?? daPhatHanh(phieu.refId);
      if (k === "NEM") throw new Error("ECONNRESET giả");
      return k;
    },
    async traCuu(refId) {
      c.daTraCuu.push(refId);
      const k = c.kichBanTraCuu.shift() ?? { loai: "CHUA_CO" };
      if (k === "NEM") throw new Error("timeout giả");
      return k;
    },
    async taiTep(_ma, loai) {
      const k = c.kichBanTaiTep.shift() ?? "OK";
      if (k === "NEM") throw new Error("MISA 503 giả");
      return loai === "pdf" ? PDF : XML;
    },
  };
  return c;
}
const daPhatHanh = (refId: string, so = `${++soGia + 900}`): DaPhatHanh => ({
  loai: "DA_PHAT_HANH",
  refId,
  kyHieu: "1C99TSR",
  soHoaDon: so,
  ngayPhatHanh: new Date("2699-09-30T02:00:00Z"),
  maTraCuu: `TRA-${so}`,
});

// ─── Fixture ───────────────────────────────────────────────────────────────────────────────────────
async function donDep() {
  const hds = await db.hoaDonDienTu.findMany({ where: { orderId: DON }, select: { id: true, guiEmail: { select: { id: true } } } });
  const hdIds = hds.map((x) => x.id);
  const guiIds = hds.flatMap((x) => x.guiEmail.map((g) => g.id));
  await db.domainEvent.deleteMany({
    where: {
      OR: [
        { dedupeKey: { in: guiIds.map((g) => `hoa-don.gui:${g}`) } },
        { dedupeKey: { in: hdIds.map((x) => `hoa-don.khong-email:${x}`) } },
        { dedupeKey: { contains: T } },
      ],
    },
  });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: hdIds } }, { entityId: { startsWith: T } }] } });
  // Chuỗi thay thế tự trỏ ⇒ gỡ con trỏ trước (NO ACTION).
  await db.hoaDonDienTu.updateMany({ where: { orderId: DON }, data: { thayTheChoId: null } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.refundRequest.deleteMany({ where: { reason: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollment.deleteMany({ where: { id: GD } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HS } });
  await db.center.deleteMany({ where: { id: CS } });
}

const khoan = (id: string, amount: number, o: { note?: string | null } = {}) =>
  db.payment.create({
    data: {
      id,
      orderId: DON,
      amount,
      method: "CASH",
      note: o.note ?? null,
      paidDate: new Date("2699-09-29T03:00:00Z"),
      saleStatus: SaleStatus.RECORDED,
      accountantStatus: AccountantStatus.PENDING,
      enrollmentId: GD,
      recordedById: SALE,
      centerId: CS,
    },
  });

async function dungFixture() {
  await donDep();
  await db.center.create({ data: { id: CS, code: MA_CS, name: "Cơ sở fixture PHM", slug: `${T}co-so`, address: "211 NHT" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 4 fixture", slug: `${T}sata-4` } });
  await db.class.create({ data: { id: LOP, name: "Lớp PHM", courseId: KHOA } });
  await db.student.create({ data: { id: HS, name: "Bé PHM" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA, finalPrice: 9_000_000 } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269930-000301",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH PHM",
      customerPhone: "0999000301",
      customerAddress: "12 Lê Lợi, Đà Nẵng",
      invoiceEmail: "ph-phm@example.com",
      totalAmount: 9_000_000,
      centerId: CS,
    },
  });
  await khoan(P1, 3_000_000);
}

/** Trang phiếu chờ — ĐÚNG hàm `napTrangPhieuCho` gọi (phần nạp DB của nó canh ở route test + [PTD-03]). */
const nguon = (soTien: readonly number[], phapNhan: PhapNhan = SATA): NguonPhieu => ({
  phapNhan,
  trang: soTien.map((s) =>
    dungPhieuThuData({
      maPhieu: null,
      ngayLap: "29/09/2699",
      phapNhan,
      cauHinh: CAU_HINH_HOA_DON_MAC_DINH,
      don: {
        code: "ORD-269930-000301",
        type: "COURSE",
        customerName: "PH PHM",
        customerPhone: "0999000301",
        customerEmail: null,
        customerAddress: "12 Lê Lợi, Đà Nẵng",
        customerWard: null,
        customerCity: null,
        customerCccd: null,
        invoiceBuyerName: null,
        invoiceCompanyName: null,
        invoiceTaxCode: null,
        invoiceEmail: "ph-phm@example.com",
      },
      soTien: s,
      hinhThucThanhToan: "Tiền mặt",
      tenKhoa: "Sata 4 fixture",
      tenHocVien: "Bé PHM",
      tenLop: "Lớp PHM",
      nguoiThu: null,
      dongDon: [],
    }),
  ),
  phuongThuc: soTien.map(() => ({ ma: "CASH", nhan: "Tiền mặt" })),
});

const batDau = (
  o: Partial<Parameters<typeof batDauPhatHanh>[0]> = {},
  cong: CongHoaDon["cheDo"] = "HSM",
) =>
  batDauPhatHanh({
    nguoiBam: KT,
    actor: KT_CS,
    orderId: DON,
    centerId: CS,
    lanThuKey: `khoan:${P1}`,
    khoan: [{ id: P1, soTien: 3_000_000 }],
    nguon: nguon([3_000_000]),
    cheDo: cong,
    now: NOW,
    ...o,
  });

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiChotHoaDon || e instanceof LoiPhatHanh || e instanceof LoiGhiHoaDon ? e.ma : String(e);
  }
}

const hdCuaDon = () => db.hoaDonDienTu.findMany({ where: { orderId: DON }, include: { khoan: true } });

describe.skipIf(!RUN_DB_TESTS)("[PHM] phát hành qua MISA — Postgres thật, cổng giả", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await dungFixture();
  });
  afterAll(donDep);

  it("[PHM-10] DA_PHAT_HANH ⇒ DA_XAC_NHAN đủ số + tệp trong kho + email xếp hàng + khoản xác nhận (RCP) — refId đã lưu", async () => {
    const cong = congGia();
    const { hoaDonId, refId } = await batDau();
    const dang = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    expect(dang).toMatchObject({ trangThai: "DANG_PHAT_HANH", misaRefId: refId, nguonPhatHanh: "MISA_API", soHoaDon: null, guiEmailKhach: true });

    const s = await guiPhatHanh({ hoaDonId, cong, now: NOW });
    expect(s.trangThai).toBe("DA_XAC_NHAN");
    expect(cong.daGui.map((p) => p.refId)).toEqual([refId]);
    expect(cong.daGui[0]!.tongThanhToan).toBe(3_000_000);

    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    expect(hd).toMatchObject({
      trangThai: "DA_XAC_NHAN",
      kyHieu: "1C99TSR",
      maTraCuu: expect.stringMatching(/^TRA-/),
      xacNhanBoiId: KT.id,
      misaSoLanGui: 1,
      emailNhan: "ph-phm@example.com",
    });
    expect(hd.ngayPhatHanh?.toISOString().slice(0, 10)).toBe("2699-09-30");
    expect(hd.soHoaDon).toBeTruthy();
    // Tệp: khoá theo ĐÚNG quy ước luồng tải lên (thuộc đơn + cơ sở), cỡ + vân tay chụp lên bản ghi.
    expect(khoaThuocDon(hd.tepPdfKey!, MA_CS, DON) && hd.tepPdfKey!.endsWith(".pdf")).toBe(true);
    expect(khoaThuocDon(hd.tepXmlKey!, MA_CS, DON) && hd.tepXmlKey!.endsWith(".xml")).toBe(true);
    expect(hd.tepPdfCo).toBe(PDF.length);
    expect(hd.tepPdfSha256).toBe(`sha-pdf-${PDF.length}`);
    expect(h.luu).toHaveBeenCalledTimes(2);
    // Hệ quả sau-xác-nhận của `chotHoaDon`: lượt email + khoản xác nhận + RCP + nhật ký.
    const email = await db.hoaDonGuiEmail.findMany({ where: { hoaDonId } });
    expect(email.map((e) => [e.lanGui, e.toi, e.trangThai])).toEqual([[1, "ph-phm@example.com", "CHO"]]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).accountantStatus).toBe(AccountantStatus.CONFIRMED);
    expect(await db.receipt.count({ where: { paymentId: P1 } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: hoaDonId, action: "XAC_NHAN_HOA_DON" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: hoaDonId, action: "BAT_DAU_PHAT_HANH_MISA" } })).toBe(1);
  });

  it("[PHM-11] GIA_LAP ⇒ nguồn MISA_GIA_LAP, KHÔNG có lượt email nào (kể cả khách có email)", async () => {
    const cong = congGia("GIA_LAP");
    const { hoaDonId } = await batDau({}, "GIA_LAP");
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).guiEmailKhach).toBe(false);
    // Ép lần hai lúc hoàn tất: ai đó bật lại cột cũng không gửi.
    await db.hoaDonDienTu.update({ where: { id: hoaDonId }, data: { guiEmailKhach: true } });
    expect((await guiPhatHanh({ hoaDonId, cong, now: NOW })).trangThai).toBe("DA_XAC_NHAN");
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).toMatchObject({
      trangThai: "DA_XAC_NHAN",
      nguonPhatHanh: "MISA_GIA_LAP",
    });
    expect(await db.hoaDonGuiEmail.count({ where: { hoaDonId } })).toBe(0);
  });

  it("[PHM-12] TU_CHOI ⇒ LOI_PHAT_HANH (mã + thông điệp), khoản VẪN bị giữ; Phát hành lại ⇒ refId MỚI rồi hoàn tất", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "TU_CHOI", ma: "InvalidTaxCode", thongDiep: "MST người mua sai" });
    const { hoaDonId, refId } = await batDau();
    const s = await guiPhatHanh({ hoaDonId, cong, now: NOW });
    expect(s).toMatchObject({ trangThai: "LOI_PHAT_HANH", ma: "InvalidTaxCode", thongDiep: "MST người mua sai" });
    expect((await khoanDaKhoaHoaDon(db, [P1])).map((k) => k.trangThai)).toEqual(["LOI_PHAT_HANH"]);
    expect(await db.auditLog.count({ where: { entityId: hoaDonId, action: "MISA_TU_CHOI_PHAT_HANH" } })).toBe(1);

    const loi = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    const { refId: refMoi } = await phatHanhLai({
      nguoiBam: KT,
      actor: KT_CS,
      orderId: DON,
      hoaDonId,
      phienBan: loi.updatedAt,
      nguon: nguon([3_000_000]),
      cheDo: "HSM",
      now: NOW,
    });
    expect(refMoi).not.toBe(refId);
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).toMatchObject({
      trangThai: "DANG_PHAT_HANH",
      misaRefId: refMoi,
      misaLoiMa: null,
      misaSoLanGui: 0,
    });
    expect((await guiPhatHanh({ hoaDonId, cong, now: NOW })).trangThai).toBe("DA_XAC_NHAN");
    expect(cong.daGui.map((p) => p.refId)).toEqual([refId, refMoi]);
    // Phiên bản cũ ⇒ không phát hành lại được lần nữa (đã đổi).
    expect(
      await maLoi(
        phatHanhLai({ nguoiBam: KT, actor: KT_CS, orderId: DON, hoaDonId, phienBan: loi.updatedAt, nguon: nguon([3_000_000]), cheDo: "HSM", now: NOW }),
      ),
    ).toBe("DA_DOI");
  });

  it("[PHM-13] TU_CHOI ⇒ 'Bỏ, làm tay' gỡ bản lỗi, NHẢ khoản ⇒ luồng tay tạo được bản nháp", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "TU_CHOI", ma: "X", thongDiep: "sai" });
    const { hoaDonId } = await batDau();
    await guiPhatHanh({ hoaDonId, cong, now: NOW });
    const loi = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    await boPhatHanhLamTay({ nguoiBam: KT, orderId: DON, hoaDonId, phienBan: loi.updatedAt });
    expect(await db.hoaDonDienTu.count({ where: { id: hoaDonId } })).toBe(0);
    expect(await khoanDaKhoaHoaDon(db, [P1])).toEqual([]);
    expect(await db.auditLog.count({ where: { entityId: hoaDonId, action: "BO_PHAT_HANH_MISA" } })).toBe(1);
    const nhap = await taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: DON,
      centerId: CS,
      lanThuKey: `khoan:${P1}`,
      khoan: [{ id: P1, soTien: 3_000_000 }],
      loai: { trangThai: "KHONG_XUAT", lyDo: "Đã xuất ngoài hệ thống" },
    });
    expect(nhap.id).toBeTruthy();
  });

  it("[PHM-14] KHONG_RO ⇒ giữ DANG_PHAT_HANH; kiểm tra lại CHUA_CO ⇒ gửi lại CÙNG refId; lần sau DA_PHAT_HANH ⇒ hoàn tất", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "KHONG_RO", thongDiep: "Hết thời gian chờ MISA" });
    const { hoaDonId, refId } = await batDau();
    const s1 = await guiPhatHanh({ hoaDonId, cong, now: NOW });
    expect(s1).toMatchObject({ trangThai: "DANG_PHAT_HANH", thongDiep: "Hết thời gian chờ MISA" });

    cong.kichBanTraCuu.push({ loai: "CHUA_CO" });
    const s2 = await kiemTraMotBan({ hoaDonId, cong, now: NOW, choGuiLai: () => true });
    expect(s2.trangThai).toBe("DA_XAC_NHAN");
    expect(cong.daTraCuu).toEqual([refId]);
    // Gửi lại CÙNG refId — không bao giờ sinh refId mới cho bản đã gửi.
    expect(cong.daGui.map((p) => p.refId)).toEqual([refId, refId]);
    expect(cong.daGui[1]).toEqual(cong.daGui[0]);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).misaSoLanGui).toBe(2);
  });

  it("[PHM-15] KHONG_RO (cổng NÉM) ⇒ giữ; kiểm tra lại DA_PHAT_HANH ⇒ hoàn tất, KHÔNG gửi lần hai", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push("NEM");
    const { hoaDonId, refId } = await batDau();
    expect((await guiPhatHanh({ hoaDonId, cong, now: NOW })).trangThai).toBe("DANG_PHAT_HANH");
    // Câu cho kế toán là câu NGHIỆP VỤ; chi tiết kỹ thuật ("ECONNRESET giả") chỉ vào log server.
    const giu = (await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).misaLoiThongDiep ?? "";
    expect(giu).toMatch(/tự tra cứu lại/);
    expect(giu).not.toMatch(/ECONNRESET/);
    cong.kichBanTraCuu.push(daPhatHanh(refId, "777"));
    expect((await kiemTraMotBan({ hoaDonId, cong, now: NOW, choGuiLai: () => true })).trangThai).toBe("DA_XAC_NHAN");
    expect(cong.daGui).toHaveLength(1);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).soHoaDon).toBe("777");
  });

  it("[PHM-16] tải tệp hỏng ⇒ GIỮ số ở DANG_PHAT_HANH; đối soát sau tải lại và hoàn tất, không phát hành lần hai", async () => {
    const cong = congGia();
    cong.kichBanTaiTep.push("NEM");
    const { hoaDonId } = await batDau();
    const s = await guiPhatHanh({ hoaDonId, cong, now: NOW });
    expect(s.trangThai).toBe("DANG_PHAT_HANH");
    const giu = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    expect(giu.soHoaDon).toBeTruthy();
    expect(giu.tepPdfKey).toBeNull();
    expect(giu.misaLoiThongDiep).toMatch(/chưa tải được tệp PDF/);

    // Lượt đối soát 3 phút sau (quá mốc 2 phút).
    const kq = await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 3 * PHUT) });
    expect(kq.daXacNhan).toBeGreaterThanOrEqual(1);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).trangThai).toBe("DA_XAC_NHAN");
    expect(cong.daGui).toHaveLength(1);
    expect(cong.daTraCuu).toEqual([]);
  });

  it("[PHM-17] đối soát: chưa quá 2 phút ⇒ không đụng; CHUA_CO mà lượt trước < 10 phút ⇒ KHÔNG gửi lại; > 10 phút ⇒ gửi lại CÙNG refId", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    const { hoaDonId, refId } = await batDau();
    await guiPhatHanh({ hoaDonId, cong, now: NOW });

    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 1 * PHUT) });
    expect(cong.daTraCuu).toEqual([]);

    cong.kichBanTraCuu.push({ loai: "CHUA_CO" });
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 5 * PHUT) });
    expect(cong.daTraCuu).toEqual([refId]);
    expect(cong.daGui).toHaveLength(1);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).trangThai).toBe("DANG_PHAT_HANH");

    cong.kichBanTraCuu.push({ loai: "CHUA_CO" });
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 11 * PHUT) });
    expect(cong.daGui.map((p) => p.refId)).toEqual([refId, refId]);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).trangThai).toBe("DA_XAC_NHAN");
  });

  it("[PHM-18] không cổng ⇒ đối soát bỏ qua, không ném", async () => {
    expect(await doiSoatPhatHanhTreo({ cong: null, now: NOW })).toMatchObject({ boQua: expect.any(String), quet: 0 });
  });

  it("[PHM-19] hai lượt bấm SONG SONG ⇒ đúng MỘT bản ghi, lượt kia DA_CO_HOA_DON", async () => {
    const kq = await Promise.allSettled([batDau(), batDau()]);
    expect(kq.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const thua = kq.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(thua.reason).toBeInstanceOf(LoiPhatHanh);
    expect((thua.reason as LoiPhatHanh).ma).toBe("DA_CO_HOA_DON");
    expect(await db.hoaDonDienTu.count({ where: { orderId: DON } })).toBe(1);
  });

  it("[PHM-20] đang DANG_PHAT_HANH ⇒ luồng TAY không tạo được bản thứ hai (khoá khoản ở DB)", async () => {
    await batDau();
    expect((await khoanDaKhoaHoaDon(db, [P1])).map((k) => k.trangThai)).toEqual(["DANG_PHAT_HANH"]);
    expect(
      await maLoi(
        taoHoaDonChoLanThu({
          nguoiGhi: KT,
          orderId: DON,
          centerId: CS,
          lanThuKey: `khoan:${P1}`,
          khoan: [{ id: P1, soTien: 3_000_000 }],
          loai: { trangThai: "KHONG_XUAT", lyDo: "Đã xuất ngoài hệ thống" },
        }),
      ),
    ).toBe("DA_CO_NGUOI_XU_LY");
    expect(await db.hoaDonDienTu.count({ where: { orderId: DON } })).toBe(1);
  });

  // ─── Bảng cổng: MỌI cổng của `chotHoaDon` (kiemCongChotTrongTx) + cổng riêng API chặn batDau, KHÔNG ghi gì ──
  type CaCong = { ten: string; ma: string; dung: () => Promise<Partial<Parameters<typeof batDauPhatHanh>[0]>> };
  const CA_CONG: CaCong[] = [
    {
      ten: "đơn đã huỷ",
      ma: "DON_DA_HUY",
      dung: async () => (await db.order.update({ where: { id: DON }, data: { status: "CANCELLED" } }), {}),
    },
    {
      ten: "yêu cầu hoàn CHỜ chạm khoản",
      ma: "CO_YEU_CAU_HOAN",
      dung: async () => {
        await db.refundRequest.create({
          data: {
            enrollmentId: GD,
            centerId: CS,
            trigger: "WITHDRAW",
            reason: `${T}nghỉ học`,
            paidConfirmed: 3_000_000,
            sessionsTotal: 48,
            sessionsLearned: 12,
            unitPrice: 62_500,
            proposedAmount: 1_000_000,
            status: "PENDING",
          },
        });
        return {};
      },
    },
    { ten: "kế toán cơ sở KHÁC (phạm vi từng khoản)", ma: "NGOAI_PHAM_VI", dung: async () => ({ actor: keToan([CS2]) }) },
    { ten: "số ròng đổi sau khi xem", ma: "TIEN_DA_DOI", dung: async () => ({ khoan: [{ id: P1, soTien: 2_999_000 }] }) },
    {
      ten: "lần thu đã có hoá đơn (nháp tay)",
      ma: "DA_CO_HOA_DON",
      dung: async () => {
        await taoHoaDonChoLanThu({
          nguoiGhi: KT,
          orderId: DON,
          centerId: CS,
          lanThuKey: `khoan:${P1}`,
          khoan: [{ id: P1, soTien: 3_000_000 }],
          loai: { trangThai: "KHONG_XUAT", lyDo: "Đã xuất ngoài hệ thống" },
        });
        return {};
      },
    },
    {
      ten: "người mua là đơn vị mà thiếu MST",
      ma: "NGUOI_MUA_THIEU",
      dung: async () => (await db.order.update({ where: { id: DON }, data: { invoiceCompanyName: "Công ty ABC" } }), {}),
    },
    {
      ten: "khoản khai tay nghi trùng khoản chuyển khoản cùng đơn",
      ma: "NGHI_TRUNG",
      dung: async () => {
        await db.payment.delete({ where: { id: P1 } });
        await khoan(P1, 3_000_000, { note: installmentMarker(1) });
        await khoan(`${T}p-ck`, 3_000_000, { note: gatewayMarker("SEPAY", "FT-PHM-NT") });
        return {};
      },
    },
    {
      ten: "hoá đơn THAY THẾ (khoản từng nằm trong bản đã huỷ)",
      ma: "THAY_THE",
      dung: async () => {
        await db.hoaDonDienTu.create({
          data: {
            orderId: DON,
            centerId: CS,
            trangThai: "THAY_THE",
            kyHieu: "1C99TSR",
            soHoaDon: "1",
            tongTien: 3_000_000,
            taoBoiId: KT.id,
            huyLyDo: "Sai tên người mua trên tờ cũ",
            huyBoiId: KT.id,
            huyLuc: NOW,
            khoan: { create: [{ paymentId: P1, soTien: 3_000_000, hieuLuc: false }] },
          },
        });
        return {};
      },
    },
    {
      // Smoke 30/09: cổng người mua cũ (`thieuChoHoaDon`) không soi email ⇒ nút sáng, MISA từ chối lúc gửi.
      ten: "email người mua sai luật MISA (đuôi tên miền 1 chữ)",
      ma: "PHIEU_KHONG_HOP_LE",
      dung: async () => (await db.order.update({ where: { id: DON }, data: { invoiceEmail: "ph-phm@example.c" } }), {}),
    },
    {
      // Cổng cũ nhận MST 12 số (CCCD chủ hộ); MISA chỉ nhận 10 số / 10 số-3 số.
      ten: "MST người mua 12 số (cổng cũ nhận, MISA không)",
      ma: "PHIEU_KHONG_HOP_LE",
      dung: async () => (
        await db.order.update({ where: { id: DON }, data: { invoiceCompanyName: "Hộ KD PHM", invoiceTaxCode: "049189012543" } }), {}
      ),
    },
    {
      ten: "pháp nhân không dùng MISA (VIN HOADON)",
      ma: "PHAP_NHAN_KHONG_MISA",
      dung: async () => ({ nguon: nguon([3_000_000], NEW_VISION) }),
    },
  ];
  for (const ca of CA_CONG) {
    it(`[PHM-21] cổng: ${ca.ten} ⇒ ${ca.ma}, KHÔNG tạo bản phát hành nào`, async () => {
      const o = await ca.dung();
      const sauDung = (await hdCuaDon()).length;
      expect(await maLoi(batDau(o))).toBe(ca.ma);
      expect((await hdCuaDon()).length).toBe(sauDung);
      expect(await db.hoaDonDienTu.count({ where: { orderId: DON, trangThai: "DANG_PHAT_HANH" } })).toBe(0);
    });
  }
  it("[PHM-21] đối chứng dương: cùng fixture, không cấy gì ⇒ batDau tạo đúng một bản", async () => {
    await batDau();
    expect(await db.hoaDonDienTu.count({ where: { orderId: DON, trangThai: "DANG_PHAT_HANH" } })).toBe(1);
  });

  it("[PHM-23] kho tệp hỏng (ECONNREFUSED) ⇒ câu NGHIỆP VỤ trên bản ghi + màn; chi tiết kỹ thuật CHỈ vào log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const loiKho = new Error("connect ECONNREFUSED 127.0.0.1:9");
      h.luu.mockRejectedValueOnce(loiKho);
      const cong = congGia();
      const { hoaDonId } = await batDau();
      const s = await guiPhatHanh({ hoaDonId, cong, now: NOW });
      const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
      expect(hd.trangThai).toBe("DANG_PHAT_HANH");
      expect(hd.soHoaDon).toBeTruthy();
      const tb = hd.misaLoiThongDiep ?? "";
      expect(tb).toMatch(/^Đã có số hoá đơn .+ nhưng chưa lưu được tệp PDF vào kho — hệ thống sẽ tự thử lại$/);
      for (const cam of [/ECONNREFUSED/, /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, /\bat\s+\S+\s*\(/, /:\d{2,5}\b/]) {
        expect(tb).not.toMatch(cam);
      }
      // Màn đọc thông điệp qua `SauBuoc` — cùng câu.
      expect(s).toMatchObject({ trangThai: "DANG_PHAT_HANH", thongDiep: tb });
      // Chi tiết cho người vận hành: log server có mã lỗi thật.
      expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/ECONNREFUSED 127\.0\.0\.1:9/);

      // Tải tệp từ MISA hỏng (cổng NÉM) ⇒ cùng luật.
      const cong2 = congGia();
      cong2.kichBanTaiTep.push("NEM");
      const s2 = await kiemTraMotBan({ hoaDonId, cong: cong2, now: NOW, choGuiLai: () => true });
      expect(s2).toMatchObject({ trangThai: "DANG_PHAT_HANH" });
      const tb2 = (await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).misaLoiThongDiep ?? "";
      expect(tb2).toMatch(/^Đã có số hoá đơn .+ nhưng chưa tải được tệp PDF từ MISA — hệ thống sẽ tự thử lại$/);
      expect(tb2).not.toMatch(/503/);
    } finally {
      log.mockRestore();
    }
  });

  it("[PHM-23b] đối chứng: TU_CHOI của MISA (lỗi dữ liệu có nghĩa với kế toán) GIỮ NGUYÊN thông điệp MISA", async () => {
    const cong = congGia();
    const cau = "Mã số thuế không hợp lệ (InvalidTaxCode). Chi tiết: [\"BuyerTaxCode\"]";
    cong.kichBanPhatHanh.push({ loai: "TU_CHOI", ma: "InvalidTaxCode", thongDiep: cau });
    const { hoaDonId } = await batDau();
    expect(await guiPhatHanh({ hoaDonId, cong, now: NOW })).toMatchObject({ trangThai: "LOI_PHAT_HANH", thongDiep: cau });
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).misaLoiThongDiep).toBe(cau);
  });

  it("[PHM-24] 'Phát hành lại' sau khi đơn sửa thành email sai luật MISA ⇒ từ chối TRƯỚC khi ghi: vẫn LOI_PHAT_HANH, refId cũ", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "TU_CHOI", ma: "X", thongDiep: "sai" });
    const { hoaDonId, refId } = await batDau();
    await guiPhatHanh({ hoaDonId, cong, now: NOW });
    const loi = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    await db.order.update({ where: { id: DON }, data: { invoiceEmail: "ph-phm@example.c" } });
    expect(
      await maLoi(
        phatHanhLai({ nguoiBam: KT, actor: KT_CS, orderId: DON, hoaDonId, phienBan: loi.updatedAt, nguon: nguon([3_000_000]), cheDo: "HSM", now: NOW }),
      ),
    ).toBe("PHIEU_KHONG_HOP_LE");
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).toMatchObject({
      trangThai: "LOI_PHAT_HANH",
      misaRefId: refId,
      updatedAt: loi.updatedAt,
    });
    expect(cong.daGui).toHaveLength(1);
  });

  it("[PHM-22] phiếu đã lưu (misaPhieu) mang đúng tiền + người mua chụp dưới khoá", async () => {
    const { hoaDonId } = await batDau();
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    const p = hd.misaPhieu as unknown as PhieuPhatHanh;
    expect(p.tongThanhToan).toBe(3_000_000);
    expect(p.nguoiMua).toMatchObject({ hoTen: "PH PHM", email: "ph-phm@example.com" });
    expect(hd.nguoiMuaTen).toBe("PH PHM");
    expect(hd.phapNhanMst).toBe("0402301783");
  });
});
