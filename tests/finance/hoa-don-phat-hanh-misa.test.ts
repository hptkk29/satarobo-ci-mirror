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
  /** Pháp nhân THỬ thêm vào danh sách phát hành (mặc định `null` ⇒ danh sách THẬT, không đổi gì). Ca [HMC-36b]. */
  themPhapNhan: null as null | import("@/lib/finance/hoa-don/phap-nhan").PhapNhan,
}));
vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  luuTepHoaDon: h.luu,
  xoaTepHoaDon: h.xoa,
}));
// Danh sách pháp nhân phát hành THẬT chỉ có MỘT pháp nhân dùng MISA (SATA_ROBO) nên không ca nào phân biệt được "ghi pháp nhân
// của cấu hình" với "ghi cứng SATA_ROBO". Ca [HMC-36b] thêm MỘT pháp nhân MISA thử qua `h.themPhapNhan`; ngoài ca đó hàm trả
// nguyên danh sách thật. Dòng cấu hình vẫn là dòng THẬT trong Postgres — chỉ sổ pháp nhân được nới.
vi.mock("@/lib/finance/hoa-don/phap-nhan-theo-moi-truong", async (goc) => {
  const m = await goc<typeof import("@/lib/finance/hoa-don/phap-nhan-theo-moi-truong")>();
  return {
    ...m,
    cauHinhHoaDonChoMoiTruong: (...a: Parameters<typeof m.cauHinhHoaDonChoMoiTruong>) => {
      const c = m.cauHinhHoaDonChoMoiTruong(...a);
      return h.themPhapNhan ? { ...c, phapNhan: [...c.phapNhan, h.themPhapNhan] } : c;
    },
  };
});

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
import { quetCacDon } from "@/lib/finance/hoa-don/quet-nghia-vu-db";
import { guiThongTinPhuHuynh, taoYeuCau } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-db";
import { apDungYeuCauVaoDon } from "@/lib/finance/hoa-don/yeu-cau-nguoi-mua-ap-dung-db";
import { LoiGhiHoaDon, taoHoaDonChoLanThu } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { khoanDaKhoaHoaDon } from "@/lib/finance/hoa-don/khoa-khoan";
import { khoaThuocDon } from "@/lib/finance/hoa-don/kho-tep";
import { docCauHinhDangBatTrongTx } from "@/lib/finance/hoa-don/cau-hinh-co-so-db";
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
  await db.hoaDonNgoaiLe.deleteMany({ where: { centerId: { in: [CS, CS2] } } });
  await db.hoaDonNghiaVu.deleteMany({ where: { orderId: DON } });
  await db.hoaDonYeuCauNguoiMua.deleteMany({ where: { orderId: DON } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem"] } } });
  await db.orgUnit.deleteMany({ where: { code: { startsWith: `${T}ou` } } });
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
  // Cấu hình hoá đơn trỏ cơ sở bằng `onDelete: Restrict` ⇒ gỡ trước khi xoá cơ sở.
  await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: { in: [CS, CS2] } } });
  await db.center.deleteMany({ where: { id: { in: [CS, CS2] } } });
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

/**
 * Một dòng cấu hình hoá đơn của CS phủ cả năm 2699 (NOW = 30/09/2699). Ghi thẳng bằng Prisma — cố ý KHÔNG đi qua
 * `luuCauHinh` (kiểm hợp lệ) vì ca [HMC-3x] cần cả dòng bị tắt lẫn dòng hết hạn.
 */
const datCauHinh = (o: { phapNhanMa?: string; kyHieu?: string; dangBat?: boolean; tu?: string; den?: string } = {}) =>
  db.cauHinhHoaDonCoSo.create({
    data: {
      centerId: CS,
      phapNhanMa: o.phapNhanMa ?? "SATA_ROBO",
      kyHieu: o.kyHieu ?? "1C99TSR",
      hieuLucTu: new Date(`${o.tu ?? "2699-01-01"}T00:00:00Z`),
      hieuLucDen: new Date(`${o.den ?? "2699-12-31"}T00:00:00Z`),
      dangBat: o.dangBat ?? true,
      taoBoiId: KT.id,
      capNhatBoiId: KT.id,
    },
  });

async function dungFixture() {
  await donDep();
  await db.center.create({ data: { id: CS, code: MA_CS, name: "Cơ sở fixture PHM", slug: `${T}co-so`, address: "211 NHT" } });
  // Cơ sở đã khai cấu hình hoá đơn (đúng thứ [HMC] đòi trước khi phát hành). Ký hiệu trùng ký hiệu ghi trong các ca PHM cũ.
  await datCauHinh();
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
  // `NguonPhieu` KHÔNG mang pháp nhân (máy đọc cấu hình cơ sở) — `phapNhan` ở đây chỉ để in đầu tờ phiếu THU của trang.
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
    h.themPhapNhan = null;
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

  it("[PHM-12c] TU_CHOI + cờ Hub BẬT ⇒ ngoại lệ NGAY ở đúng cơ sở của hoá đơn (không chờ cron); phát hành lại rồi bị từ chối lần nữa ⇒ ngoại lệ THỨ HAI (khoá theo refId)", async () => {
    // Cơ sở PHM phải có đơn vị tổ chức thì mới bật thí điểm được (không có ⇒ coi như TẮT, fail-closed).
    await db.orgUnit.create({ data: { id: `${T}ou-cs`, type: "CENTER", code: `${T}ou-cs`, name: "ĐV PHM", centerId: CS, path: `/${T}ou-cs/`, depth: 1 } });
    for (const key of ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem"]) await db.systemSetting.upsert({ where: { key }, create: { key, valueJson: true }, update: { valueJson: true } });
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "TU_CHOI", ma: "InvalidTaxCode", thongDiep: "MST người mua sai" }, { loai: "TU_CHOI", ma: "InvalidTaxCode", thongDiep: "MST người mua sai" });
    const { hoaDonId, refId } = await batDau();
    expect((await guiPhatHanh({ hoaDonId, cong, now: NOW })).trangThai).toBe("LOI_PHAT_HANH");
    const dau = await db.hoaDonNgoaiLe.findMany({ where: { hoaDonId } });
    expect(dau).toHaveLength(1);
    expect(dau[0]).toMatchObject({ centerId: CS, orderId: DON, loai: "TU_CHOI_NHA_CUNG_CAP", muc: "CAN_XU_LY", trangThai: "MO", dedupeKey: `TU_CHOI_NHA_CUNG_CAP:${hoaDonId}:${refId}` });
    // Thông điệp của nhà cung cấp KHÔNG được chép vào ngoại lệ (nó nằm ở hoá đơn, sau cổng quyền).
    expect(JSON.stringify(dau[0])).not.toContain("MST người mua sai");
    const loi = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    const { refId: refMoi } = await phatHanhLai({ nguoiBam: KT, actor: KT_CS, orderId: DON, hoaDonId, phienBan: loi.updatedAt, nguon: nguon([3_000_000]), cheDo: "HSM", now: NOW });
    expect((await guiPhatHanh({ hoaDonId, cong, now: NOW })).trangThai).toBe("LOI_PHAT_HANH");
    const sau = await db.hoaDonNgoaiLe.findMany({ where: { hoaDonId }, orderBy: { dedupeKey: "asc" } });
    expect(sau.map((x) => x.dedupeKey).sort()).toEqual([`TU_CHOI_NHA_CUNG_CAP:${hoaDonId}:${refId}`, `TU_CHOI_NHA_CUNG_CAP:${hoaDonId}:${refMoi}`].sort());
  });

  it("[PHM-12d] đối chứng của [PHM-12c]: cờ Hub TẮT (mặc định) ⇒ TU_CHOI chạy y như cũ và KHÔNG tạo ngoại lệ", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "TU_CHOI", ma: "InvalidTaxCode", thongDiep: "MST người mua sai" });
    const { hoaDonId } = await batDau();
    expect(await guiPhatHanh({ hoaDonId, cong, now: NOW })).toMatchObject({ trangThai: "LOI_PHAT_HANH", ma: "InvalidTaxCode" });
    expect(await db.hoaDonNgoaiLe.count({ where: { centerId: CS } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: hoaDonId, action: "MISA_TU_CHOI_PHAT_HANH" } })).toBe(1);
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
    const kq = await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 3 * PHUT), slaKhongRoPhut: null });
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

    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 1 * PHUT), slaKhongRoPhut: null });
    expect(cong.daTraCuu).toEqual([]);

    cong.kichBanTraCuu.push({ loai: "CHUA_CO" });
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 5 * PHUT), slaKhongRoPhut: null });
    expect(cong.daTraCuu).toEqual([refId]);
    expect(cong.daGui).toHaveLength(1);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).trangThai).toBe("DANG_PHAT_HANH");

    cong.kichBanTraCuu.push({ loai: "CHUA_CO" });
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 11 * PHUT), slaKhongRoPhut: null });
    expect(cong.daGui.map((p) => p.refId)).toEqual([refId, refId]);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).trangThai).toBe("DA_XAC_NHAN");
  });

  it("[PHM-18] không cổng ⇒ đối soát bỏ qua, không ném", async () => {
    expect(await doiSoatPhatHanhTreo({ cong: null, now: NOW, slaKhongRoPhut: null })).toMatchObject({ boQua: expect.any(String), quet: 0 });
  });

  // ── [PHM-SLA-*] báo NGOẠI LỆ ngay khi bản đang phát hành kẹt quá ngưỡng cấu hình (Invoice Hub §6, hợp đồng 08) ──────────────────────────────────────────────
  async function batThiDiemChoCs() {
    await db.orgUnit.create({ data: { id: `${T}ou-sla`, type: "CENTER", code: `${T}ou-sla`, name: "ĐV PHM SLA", centerId: CS, path: `/${T}ou-sla/`, depth: 1 } });
    for (const key of ["billing.hoaDonEnabled", "hoaDon.hubQuet", "hoaDon.hubThiDiem"]) await db.systemSetting.upsert({ where: { key }, create: { key, valueJson: true }, update: { valueJson: true } });
  }
  const ngoaiLeCs = () => db.hoaDonNgoaiLe.findMany({ where: { centerId: CS }, orderBy: { dedupeKey: "asc" } });

  it("[PHM-SLA-01] chưa có số, kẹt QUÁ ngưỡng ⇒ ngoại lệ KHONG_RO_QUA_HAN (KHẨN) ngay lượt đối soát; CHƯA tới ngưỡng ⇒ không có; lượt sau không đẻ trùng", async () => {
    await batThiDiemChoCs();
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    const { hoaDonId, refId } = await batDau();
    await guiPhatHanh({ hoaDonId, cong, now: NOW });
    cong.kichBanTraCuu.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 30 * PHUT), slaKhongRoPhut: 60 });
    expect(await ngoaiLeCs()).toHaveLength(0);
    cong.kichBanTraCuu.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 61 * PHUT), slaKhongRoPhut: 60 });
    const nl = await ngoaiLeCs();
    expect(nl).toHaveLength(1);
    expect(nl[0]).toMatchObject({ loai: "KHONG_RO_QUA_HAN", muc: "KHAN", hoaDonId, orderId: DON, trangThai: "MO", dedupeKey: `KHONG_RO_QUA_HAN:${hoaDonId}:${refId}` });
    cong.kichBanTraCuu.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 75 * PHUT), slaKhongRoPhut: 60 });
    expect(await ngoaiLeCs()).toHaveLength(1);
  });

  it("[PHM-SLA-02] đã CÓ SỐ mà tệp chưa lưu được, kẹt quá ngưỡng ⇒ LOI_TEP_QUA_HAN (không phải KHONG_RO)", async () => {
    await batThiDiemChoCs();
    const cong = congGia();
    cong.kichBanTaiTep.push("NEM", "NEM", "NEM", "NEM");
    const { hoaDonId } = await batDau();
    await guiPhatHanh({ hoaDonId, cong, now: NOW });
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).soHoaDon).toBeTruthy();
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 61 * PHUT), slaKhongRoPhut: 60 });
    const nl = await ngoaiLeCs();
    expect(nl.map((x) => x.loai)).toEqual(["LOI_TEP_QUA_HAN"]);
    expect(nl[0]).toMatchObject({ muc: "CAN_XU_LY", hoaDonId });
  });

  it("[PHM-SLA-03] ngưỡng null (không cấu hình) ⇒ không báo dù kẹt rất lâu; cờ thí điểm TẮT ⇒ không báo dù quá ngưỡng — đối chứng của hai ca trên", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    const { hoaDonId } = await batDau();
    await guiPhatHanh({ hoaDonId, cong, now: NOW });
    await batThiDiemChoCs();
    cong.kichBanTraCuu.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 600 * PHUT), slaKhongRoPhut: null });
    expect(await ngoaiLeCs()).toHaveLength(0);
    await db.systemSetting.update({ where: { key: "hoaDon.hubThiDiem" }, data: { valueJson: false } });
    cong.kichBanTraCuu.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 600 * PHUT), slaKhongRoPhut: 60 });
    expect(await ngoaiLeCs()).toHaveLength(0);
    await db.systemSetting.update({ where: { key: "hoaDon.hubThiDiem" }, data: { valueJson: true } });
    cong.kichBanTraCuu.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    await doiSoatPhatHanhTreo({ cong, now: new Date(NOW.getTime() + 600 * PHUT), slaKhongRoPhut: 60 });
    expect(await ngoaiLeCs()).toHaveLength(1);
  });

  // ── [LTD-*] LUỒNG TỰ ĐỘNG đi qua nhiều lát thật, chỉ nhà cung cấp là GIẢ: khoản thu → nghĩa vụ (scanner) → thông tin người mua (QR / áp dụng) → hoá đơn → phát hành → bản chiếu cập nhật ──
  it("[LTD-01] khoản thu ⇒ scanner dựng nghĩa vụ ⇒ phụ huynh điền thông tin người mua qua QR ⇒ áp dụng vào đơn ⇒ hoá đơn mang ĐÚNG người mua đó ⇒ phát hành ⇒ scanner chiếu nghĩa vụ thành ĐÃ XUẤT", async () => {
    await batThiDiemChoCs();
    const quet = () => quetCacDon({ orderIds: [DON], now: NOW, conThoiGian: () => true, coSoDuocQuet: new Set([CS]) });
    // 1) scanner: nghĩa vụ của khoản thu xuất hiện, CHƯA xuất
    await quet();
    const truoc = await db.hoaDonNghiaVu.findMany({ where: { orderId: DON } });
    expect(truoc.length).toBeGreaterThan(0);
    expect(truoc.every((n) => n.trangThai !== "DA_XUAT" && n.hoaDonId === null)).toBe(true);
    // 2) QR: kế toán tạo, phụ huynh gửi, kế toán áp dụng vào đơn
    const t = await taoYeuCau({ actor: KT_CS, nguoi: KT, orderId: DON, phamVi: "DON", ttlPhut: 240, now: NOW });
    if (!t.ok) throw new Error(`tạo yêu cầu: ${t.ma}`);
    const TEN = "Công ty TNHH Người Mua QR LTD";
    const g = await guiThongTinPhuHuynh({ id: t.id, token: t.token, gioiHan: { toiDaSaiToken: 5, toiDaLanMo: 30, khoaPhut: 15 }, du: { loai: "DOANH_NGHIEP", ten: TEN, diaChi: "88 Trần Phú, Đà Nẵng", maSoThue: "0401234567", email: "ketoan.ltd@example.com" }, donY: { phienBanDieuKhoan: "dk-test" }, now: NOW });
    expect(g.ok).toBe(true);
    const ad = await apDungYeuCauVaoDon({ actor: KT_CS, nguoi: KT, id: t.id, khiDonDaDoi: "TU_CHOI", now: NOW });
    expect(ad).toMatchObject({ ok: true, orderId: DON });
    expect(await db.order.findUniqueOrThrow({ where: { id: DON } })).toMatchObject({ invoiceCompanyName: TEN, invoiceTaxCode: "0401234567", invoiceEmail: "ketoan.ltd@example.com", customerAddress: "88 Trần Phú, Đà Nẵng" });
    // 3) hoá đơn + phát hành (nhà cung cấp GIẢ): phiếu gửi đi mang người mua từ QR
    const cong = congGia();
    const { hoaDonId } = await batDau();
    const s = await guiPhatHanh({ hoaDonId, cong, now: NOW });
    expect(s.trangThai).toBe("DA_XAC_NHAN");
    const phieu = JSON.stringify(cong.daGui[0]);
    expect(phieu).toContain(TEN);
    expect(phieu).toContain("0401234567");
    expect(phieu).toContain("88 Trần Phú");
    // 4) scanner chiếu lại: nghĩa vụ gắn hoá đơn, ĐÃ XUẤT; không ngoại lệ nào được mở
    await quet();
    const sau = await db.hoaDonNghiaVu.findMany({ where: { orderId: DON } });
    expect(sau.length).toBe(truoc.length);
    expect(sau.every((n) => n.trangThai === "DA_XUAT" && n.hoaDonId === hoaDonId)).toBe(true);
    expect(await ngoaiLeCs()).toHaveLength(0);
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
      ten: "pháp nhân không khai phần mềm phát hành qua API (STEM_ROBOTICS_AI)",
      ma: "PHAP_NHAN_KHONG_MISA",
      // Từ 01/11/2026 pháp nhân quyết bởi CẤU HÌNH cơ sở (S1). Từ 02/11/2026 VIN HOADON CŨNG phát hành được qua API (cổng VIN) — ca VIN ở
      // [VINW-DB-01b]; ca này dùng pháp nhân KHÔNG có `phanMem` (không MISA, không VIN) để giữ cổng từ chối.
      dung: async () => {
        await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
        await datCauHinh({ phapNhanMa: "STEM_ROBOTICS_AI", kyHieu: "1C99STM" });
        return {};
      },
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

  // ─── [HMC] Đường phát hành đọc CẤU HÌNH CƠ SỞ (S1 Invoice Hub, 01/11/2026) ─────────────────────────────────
  // Trước đây pháp nhân + ký hiệu lấy từ hằng (`phapNhanChoDon` + `kyHieuTheoNam`), KHÔNG đọc `CauHinhHoaDonCoSo` —
  // trong khi nút hiện và luồng tải-lên (D1) đều theo cấu hình.
  it("[HMC-30] cấu hình khai ký hiệu 1C99MAI ⇒ bản phát hành + phiếu GỬI MISA mang đúng 1C99MAI (không phải ký hiệu hằng đổi năm)", async () => {
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    await datCauHinh({ kyHieu: "1C99MAI" });
    const cong = congGia();
    const { hoaDonId } = await batDau();
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    expect(hd).toMatchObject({ kyHieu: "1C99MAI", phapNhanMa: "SATA_ROBO", phapNhanMst: "0402301783" });
    expect((hd.misaPhieu as unknown as PhieuPhatHanh).kyHieu).toBe("1C99MAI");
    await guiPhatHanh({ hoaDonId, cong, now: NOW });
    expect(cong.daGui.map((p) => p.kyHieu)).toEqual(["1C99MAI"]);
  });

  it("[HMC-31] cơ sở KHÔNG có dòng cấu hình ⇒ CAU_HINH_CO_SO, KHÔNG tạo bản, KHÔNG ghi nhật ký", async () => {
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    const truoc = await db.auditLog.count({ where: { action: "BAT_DAU_PHAT_HANH_MISA", orgUnitId: CS } });
    expect(await maLoi(batDau())).toBe("CAU_HINH_CO_SO");
    expect(await hdCuaDon()).toHaveLength(0);
    expect(await db.auditLog.count({ where: { action: "BAT_DAU_PHAT_HANH_MISA", orgUnitId: CS } })).toBe(truoc);
  });

  it("[HMC-31b] cơ sở KHÔNG có pháp nhân hợp lệ mà cơ sở KHÁC có đầy đủ ⇒ vẫn CAU_HINH_CO_SO: không mượn MST / ký hiệu của cơ sở khác; đối chứng: khai cấu hình cho ĐÚNG cơ sở thì phát hành được", async () => {
    await db.center.create({ data: { id: CS2, code: "FXPHM2", name: "Cơ sở khác fixture PHM", slug: `${T}co-so-2`, address: "114 HD" } });
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    await db.cauHinhHoaDonCoSo.create({
      data: {
        centerId: CS2,
        phapNhanMa: "SATA_ROBO",
        kyHieu: "1C99KHAC",
        hieuLucTu: new Date("2699-01-01T00:00:00Z"),
        hieuLucDen: new Date("2699-12-31T00:00:00Z"),
        dangBat: true,
        taoBoiId: KT.id,
        capNhatBoiId: KT.id,
      },
    });
    expect(await maLoi(batDau())).toBe("CAU_HINH_CO_SO");
    expect(await hdCuaDon()).toHaveLength(0);
    expect(await db.auditLog.count({ where: { action: "BAT_DAU_PHAT_HANH_MISA", orgUnitId: CS } })).toBe(0);
    await datCauHinh();
    const { hoaDonId } = await batDau();
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    expect(hd.kyHieu).toBe("1C99TSR");
    expect(hd.kyHieu).not.toBe("1C99KHAC");
  });

  it("[HMC-32] dòng cấu hình đã TẮT hoặc hết hạn trước ngày phát hành ⇒ coi như thiếu: CAU_HINH_CO_SO; câu lỗi nêu NGÀY + màn Cấu hình ký hiệu", async () => {
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    await datCauHinh({ dangBat: false });
    expect(await maLoi(batDau())).toBe("CAU_HINH_CO_SO");
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    await datCauHinh({ den: "2699-06-30" });
    let cau = "";
    try {
      await batDau();
    } catch (e) {
      cau = e instanceof Error ? e.message : String(e);
    }
    expect(cau).toContain("2699-09-30");
    expect(cau).toContain("Cấu hình ký hiệu");
    expect(await hdCuaDon()).toHaveLength(0);
  });

  it("[HMC-33] cấu hình trỏ pháp nhân KHÔNG khai phần mềm phát hành API (STEM_ROBOTICS_AI) ⇒ PHAP_NHAN_KHONG_MISA — pháp nhân quyết bởi CẤU HÌNH, không bởi `nguon`", async () => {
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    await datCauHinh({ phapNhanMa: "STEM_ROBOTICS_AI", kyHieu: "1C99STM" });
    expect(await maLoi(batDau())).toBe("PHAP_NHAN_KHONG_MISA");
    expect(await hdCuaDon()).toHaveLength(0);
  });

  // ── [VINW-DB-*] VIN-HOADON nối vào luồng phát hành (02/11/2026) ──────────────────────────────────────────────────────────────────────────────────────────────
  it("[VINW-DB-01a] đối chứng: cấu hình mặc định của fixture (SATA_ROBO, MISA) ⇒ bản tạo ra ghi nhaCungCapMa = MISA_MEINVOICE", async () => {
    const m = await batDau();
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: m.hoaDonId } })).nhaCungCapMa).toBe("MISA_MEINVOICE");
  });

  it("[VINW-DB-01b] pháp nhân NEW_VISION (VIN HOADON) ⇒ bản tạo ra ghi nhaCungCapMa = VIN_HOADON + đúng pháp nhân", async () => {
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    await datCauHinh({ phapNhanMa: "NEW_VISION", kyHieu: "1C99MNV" });
    const v = await batDau();
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: v.hoaDonId } });
    expect(hd.nhaCungCapMa).toBe("VIN_HOADON");
    expect(hd.phapNhanMa).toBe("NEW_VISION");
    expect(hd.trangThai).toBe("DANG_PHAT_HANH");
  });

  it("[VINW-DB-02] đối soát theo NHÀ CUNG CẤP của từng bản: bản VIN chỉ đi qua cổng VIN; cổng MISA KHÔNG được gọi cho nó", async () => {
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    await datCauHinh({ phapNhanMa: "NEW_VISION", kyHieu: "1C99MNV" });
    const congVin = congGia();
    congVin.kichBanPhatHanh.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    const { hoaDonId, refId } = await batDau();
    await guiPhatHanh({ hoaDonId, cong: congVin, now: NOW });

    const congMisaGia = congGia();
    const kq = await doiSoatPhatHanhTreo({
      cong: congMisaGia,
      congTheo: (ncc) => (ncc === "VIN_HOADON" ? congVin : congMisaGia),
      now: new Date(NOW.getTime() + 3 * PHUT),
      slaKhongRoPhut: null,
    });
    expect(congVin.daTraCuu).toEqual([refId]);
    expect(congMisaGia.daTraCuu).toEqual([]);
    expect(congMisaGia.daGui).toEqual([]);
    expect(kq.quet).toBeGreaterThanOrEqual(1);
  });

  it("[VINW-DB-03] cổng VIN CHƯA cấu hình (congTheo trả null cho VIN) ⇒ bản VIN bị BỎ QUA, KHÔNG rơi sang cổng MISA và không bị đụng", async () => {
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    await datCauHinh({ phapNhanMa: "NEW_VISION", kyHieu: "1C99MNV" });
    const congVin = congGia();
    congVin.kichBanPhatHanh.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    const { hoaDonId } = await batDau();
    await guiPhatHanh({ hoaDonId, cong: congVin, now: NOW });
    const antes = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });

    const congMisaGia = congGia();
    const kq = await doiSoatPhatHanhTreo({
      cong: congMisaGia,
      congTheo: (ncc) => (ncc === "VIN_HOADON" ? null : congMisaGia),
      now: new Date(NOW.getTime() + 3 * PHUT),
      slaKhongRoPhut: null,
    });
    expect(congMisaGia.daTraCuu).toEqual([]);
    expect(congMisaGia.daGui).toEqual([]);
    expect(kq.quet).toBe(0);
    const sau = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    expect(sau.trangThai).toBe("DANG_PHAT_HANH");
    expect(sau.updatedAt.getTime()).toBe(antes.updatedAt.getTime());
  });

  it("[VINW-DB-04] bản MISA cũ (nhaCungCapMa NULL) vẫn đối soát qua cổng MISA — tương thích ngược", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "KHONG_RO", thongDiep: "5xx" });
    const { hoaDonId, refId } = await batDau();
    await guiPhatHanh({ hoaDonId, cong, now: NOW });
    await db.hoaDonDienTu.update({ where: { id: hoaDonId }, data: { nhaCungCapMa: null } });
    const congVin = congGia();
    await doiSoatPhatHanhTreo({
      cong,
      congTheo: (ncc) => (ncc === "VIN_HOADON" ? congVin : cong),
      now: new Date(NOW.getTime() + 3 * PHUT),
      slaKhongRoPhut: null,
    });
    expect(cong.daTraCuu).toEqual([refId]);
    expect(congVin.daTraCuu).toEqual([]);
  });

  it("[HMC-34] 'Phát hành lại' khi cấu hình đã bị TẮT ⇒ CAU_HINH_CO_SO trước khi ghi: vẫn LOI_PHAT_HANH, refId cũ, updatedAt cũ", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "TU_CHOI", ma: "X", thongDiep: "sai" });
    const { hoaDonId, refId } = await batDau();
    await guiPhatHanh({ hoaDonId, cong, now: NOW });
    const loi = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    await db.cauHinhHoaDonCoSo.updateMany({ where: { centerId: CS }, data: { dangBat: false } });
    expect(
      await maLoi(
        phatHanhLai({ nguoiBam: KT, actor: KT_CS, orderId: DON, hoaDonId, phienBan: loi.updatedAt, nguon: nguon([3_000_000]), cheDo: "HSM", now: NOW }),
      ),
    ).toBe("CAU_HINH_CO_SO");
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).toMatchObject({
      trangThai: "LOI_PHAT_HANH",
      misaRefId: refId,
      updatedAt: loi.updatedAt,
    });
    expect(cong.daGui).toHaveLength(1);
  });

  it("[HMC-35] 'Phát hành lại' sau khi kế toán ĐỔI ký hiệu trong cấu hình ⇒ phiếu mới mang ký hiệu MỚI (refId mới)", async () => {
    const cong = congGia();
    cong.kichBanPhatHanh.push({ loai: "TU_CHOI", ma: "X", thongDiep: "sai" });
    const { hoaDonId, refId } = await batDau();
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).kyHieu).toBe("1C99TSR");
    await guiPhatHanh({ hoaDonId, cong, now: NOW });
    const loi = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    await db.cauHinhHoaDonCoSo.updateMany({ where: { centerId: CS }, data: { kyHieu: "1C99MAI" } });
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
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    expect(hd.kyHieu).toBe("1C99MAI");
    expect((hd.misaPhieu as unknown as PhieuPhatHanh).kyHieu).toBe("1C99MAI");
  });

  // [HMC-36] Nhật ký kiểm toán `BAT_DAU_PHAT_HANH_MISA` PHẢI nói đúng pháp nhân + ký hiệu mà hoá đơn pháp lý đứng tên. Cột
  // `HoaDonDienTu.phapNhanMa/kyHieu` đã canh ở [HMC-30]; nhưng nhật ký là dấu vết RIÊNG (một câu `newValues` tách khỏi `create`),
  // nên ghi cứng một pháp nhân vào nhật ký không làm ca nào ở trên đỏ — dấu vết kiểm toán nói dối mà không ai biết.
  const nhatKyBatDau = async (hoaDonId: string) => {
    const dong = await db.auditLog.findMany({ where: { entityId: hoaDonId, action: "BAT_DAU_PHAT_HANH_MISA" } });
    expect(dong).toHaveLength(1);
    return dong[0]!;
  };

  it("[HMC-36a] nhật ký bắt đầu phát hành ghi ĐÚNG pháp nhân + ký hiệu của cấu hình (khớp cột trên hoá đơn), kèm refId + chế độ", async () => {
    const { hoaDonId, refId } = await batDau();
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    const nk = await nhatKyBatDau(hoaDonId);
    expect(nk.newValues).toMatchObject({ phapNhanMa: "SATA_ROBO", kyHieu: "1C99TSR", misaRefId: refId, cheDo: "HSM", orderId: DON });
    // Nhật ký và cột hoá đơn là HAI bản ghi của cùng một sự thật — không được lệch nhau.
    expect(nk.newValues).toMatchObject({ phapNhanMa: hd.phapNhanMa, kyHieu: hd.kyHieu });
  });

  it("[HMC-36b] đối chứng: cấu hình khai pháp nhân MISA KHÁC + ký hiệu khác ⇒ nhật ký ghi đúng pháp nhân/ký hiệu ĐÓ (không ghi cứng SATA_ROBO / 1C99TSR)", async () => {
    h.themPhapNhan = {
      ma: "FX_PHM_MISA2",
      ten: "CÔNG TY THỬ MISA FIXTURE PHM",
      maSoThue: "0300588569",
      diaChi: "1 Đường Thử, Đà Nẵng",
      phanMem: "MISA meInvoice",
      bat: true,
    };
    await db.cauHinhHoaDonCoSo.deleteMany({ where: { centerId: CS } });
    await datCauHinh({ phapNhanMa: "FX_PHM_MISA2", kyHieu: "1C99MAI" });
    const { hoaDonId, refId } = await batDau();
    const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } });
    // Cột hoá đơn + phiếu gửi MISA đứng tên pháp nhân thử (fixture thật, không phải SATA_ROBO)…
    expect(hd).toMatchObject({ phapNhanMa: "FX_PHM_MISA2", kyHieu: "1C99MAI", phapNhanMst: "0300588569" });
    expect((hd.misaPhieu as unknown as PhieuPhatHanh).mstNguoiBan).toBe("0300588569");
    // …và nhật ký nói ĐÚNG như vậy.
    const nk = await nhatKyBatDau(hoaDonId);
    expect(nk.newValues).toMatchObject({ phapNhanMa: "FX_PHM_MISA2", kyHieu: "1C99MAI", misaRefId: refId });
  });

  // [HMC-37] Đọc cấu hình TRONG transaction phát hành: chỉ dòng ĐANG BẬT của ĐÚNG cơ sở. Resolver thuần đã tự lọc cơ sở/dangBat
  // nên ở mức `batDauPhatHanh` lọc ở truy vấn là phòng thủ chồng lớp (không quan sát được); nhưng đây là hàm export với hợp đồng
  // riêng — đọc thừa dòng của cơ sở khác / dòng đã tắt là rò cấu hình qua ranh giới cơ sở và nuôi lại các tầng sau bằng dữ liệu
  // không nên thấy. Khẳng định ở ĐÚNG ranh giới hợp đồng đó, trên Postgres thật.
  it("[HMC-37] docCauHinhDangBatTrongTx: chỉ trả dòng ĐANG BẬT của ĐÚNG cơ sở (không dòng cơ sở khác, không dòng đã tắt)", async () => {
    await db.center.create({ data: { id: CS2, code: "FXPHM2", name: "Cơ sở fixture PHM 2", slug: `${T}co-so-2`, address: "114 HD" } });
    await datCauHinh({ dangBat: false, tu: "2698-01-01", den: "2698-12-31", kyHieu: "1C98OFF" });
    await db.cauHinhHoaDonCoSo.create({
      data: {
        centerId: CS2,
        phapNhanMa: "SATA_ROBO",
        kyHieu: "1C99KHC",
        hieuLucTu: new Date("2699-01-01T00:00:00Z"),
        hieuLucDen: new Date("2699-12-31T00:00:00Z"),
        dangBat: true,
        taoBoiId: KT.id,
        capNhatBoiId: KT.id,
      },
    });
    // Đầu vào thật sự có đủ ba loại dòng (nếu không, ca xanh vì không có gì để lọc).
    expect(await db.cauHinhHoaDonCoSo.count({ where: { centerId: CS } })).toBe(2);
    expect(await db.cauHinhHoaDonCoSo.count({ where: { centerId: CS2 } })).toBe(1);

    const cuaCs = await docCauHinhDangBatTrongTx(db, CS);
    expect(cuaCs.map((c) => [c.centerId, c.kyHieu, c.dangBat])).toEqual([[CS, "1C99TSR", true]]);
    // Đối chứng dương: hỏi cơ sở kia ⇒ ra dòng của nó (hàm không "trả rỗng cho an toàn").
    const cuaCs2 = await docCauHinhDangBatTrongTx(db, CS2);
    expect(cuaCs2.map((c) => [c.centerId, c.kyHieu, c.dangBat])).toEqual([[CS2, "1C99KHC", true]]);
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
