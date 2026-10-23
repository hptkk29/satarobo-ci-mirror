// Ca [HUYDB-*] — HUỶ hoá đơn ĐÃ XÁC NHẬN + tự nối bản thay, trên Postgres THẬT (GĐ 8, quyết định (1) 27/09).
//
//   huỷ ⇒ bản cũ THAY_THE (đủ ai / lúc nào / vì sao) · dòng nối hieuLuc=false ⇒ khoản TRỞ LẠI hàng chờ
//        · Payment vẫn CONFIRMED · RCP giữ nguyên · thư đang chờ của bản cũ tự dừng
//   tạo bản kế tiếp (nháp / không xuất) ⇒ tự nối `thayTheChoId` về bản đã huỷ gần nhất của các khoản
//
// Mọi hoá đơn ĐÃ XÁC NHẬN trong bộ này đi qua ĐÚNG đường thật (`chotHoaDon`) — không gõ tay trạng thái.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
  kyUrlTaiVeHoaDon: async (khoa: string) => `https://r2.test/${khoa}`,
}));

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { chotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { COT_NGUOI_MUA } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import {
  goHoaDonChuaChot,
  huyHoaDonDaXacNhan,
  LoiGhiHoaDon,
  taoHoaDonChoLanThu,
} from "@/lib/finance/hoa-don/ghi-hoa-don";
import { khoanDaKhoaHoaDon } from "@/lib/finance/hoa-don/khoa-khoan";
import { giuLuotGuiHoaDon } from "@/lib/finance/hoa-don/gui-email";
import { chuanBiGuiHoaDon } from "@/lib/finance/hoa-don/dinh-kem-email";
import { napHangChoHoaDon } from "@/lib/finance/hoa-don/hang-cho";
import { adjustPayment, rejectPayment } from "@/lib/finance/payment";

if (!RUN_DB_TESTS) console.warn(`[HUYDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-huy-";
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
const P3 = `${T}p3`;
const NOW = new Date("2699-09-26T08:00:00Z");
const LY_DO = "Tải nhầm tờ hoá đơn của khách khác";
const PHAP_NHAN = { ma: "SATA_ROBO", ten: "Công ty CP Sata Robo", maSoThue: "0402301783", diaChi: "Đà Nẵng", bat: true };

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

const khoan = (id: string, amount: number, enrollmentId: string | null = GD) =>
  db.payment.create({
    data: {
      id,
      orderId: DON,
      amount,
      method: "CASH",
      paidDate: new Date("2699-09-20T03:00:00Z"),
      saleStatus: "RECORDED",
      accountantStatus: "PENDING",
      enrollmentId,
      recordedById: SALE,
      centerId: CS,
    },
  });

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture HUY", slug: `${T}co-so`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 5 fixture", slug: `${T}sata-5` } });
  await db.class.create({ data: { id: LOP, name: "Lớp fixture HUY", courseId: KHOA } });
  await db.student.create({ data: { id: HS, name: "Bé HUY" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA, finalPrice: 9_000_000 } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269927-000301",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH HUY",
      customerPhone: "0999000777",
      customerEmail: "phuhuynh.huy@example.com",
      totalAmount: 9_000_000,
      centerId: CS,
    },
  });
}

let dem = 0;
/** Hoá đơn NHÁP qua ĐÚNG đường tạo thật (có tự nối thayTheChoId). Mỗi lần một số hoá đơn mới. */
const taoNhap = (ids: string[], soTien = 3_000_000) =>
  taoHoaDonChoLanThu({
    nguoiGhi: KT,
    orderId: DON,
    centerId: CS,
    lanThuKey: `khoan:${ids.join(",")}`,
    khoan: ids.map((id) => ({ id, soTien })),
    loai: {
      trangThai: "NHAP",
      phapNhan: PHAP_NHAN,
      so: { kyHieu: "1C99TSR", soHoaDon: String(900 + ++dem), ngayPhatHanh: new Date("2699-09-21T00:00:00Z") },
      guiEmailKhach: true,
      pdf: { khoa: `hoa-don/HUY/${DON}/${dem}.pdf`, ten: `hd-${dem}.pdf`, co: 1000, sha256: `sha-${dem}` },
      xml: null,
      theoSoDaThu: null,
      tienTha: 0,
    },
  });

/** Kế toán của cơ sở giữ đơn (`payments:confirm` neo tại CS) — đúng người cổng action cho qua. */
const KT_CS = {
  userId: KT.id,
  isSuperAdmin: false,
  grantsAllow: new Set<string>(),
  permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: [CS] }],
} as unknown as Actor;

/** Như action thật: phiên bản bản nháp + email hiện tại của đơn đọc ngay trước khi bấm. */
async function chot(hoaDonId: string, now: Date = NOW) {
  const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId }, select: { updatedAt: true } });
  const donHt = await db.order.findUniqueOrThrow({ where: { id: DON }, select: COT_NGUOI_MUA });
  return chotHoaDon({
    nguoiChot: KT,
    actor: KT_CS,
    orderId: DON,
    hoaDonId,
    now,
    phienBan: hd.updatedAt,
    emailDuKien: nguoiMuaChoDon(donHt).email,
  });
}

/** Hoá đơn ĐÃ XÁC NHẬN qua đường thật: tạo nháp → chốt. */
async function daXacNhan(ids: string[]): Promise<string> {
  const { id } = await taoNhap(ids);
  await chot(id);
  return id;
}

const huy = (hoaDonId: string, lyDo = LY_DO) =>
  huyHoaDonDaXacNhan({ nguoiHuy: KT, orderId: DON, hoaDonId, lyDo, now: NOW });

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiGhiHoaDon ? e.ma : String(e);
  }
}

const SIEU: Actor = {
  userId: KT.id,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [CS],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
};

describe.skipIf(!RUN_DB_TESTS)("[HUYDB] huỷ hoá đơn đã xác nhận — Postgres thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HUYDB-01] huỷ ⇒ THAY_THE đủ ai/lúc/vì sao · dòng nối hết hiệu lực · khoản VẪN xác nhận · RCP giữ · một nhật ký", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]);
    expect(await db.receipt.count({ where: { paymentId: P1 } })).toBe(1); // tiền đề: chốt đã cấp RCP

    const kq = await huy(id);
    expect(kq.paymentIds).toEqual([P1]);
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({
      trangThai: "THAY_THE",
      huyLyDo: LY_DO,
      huyBoiId: KT.id,
      huyLuc: NOW,
    });
    expect((await db.hoaDonKhoan.findMany({ where: { hoaDonId: id } })).map((k) => k.hieuLuc)).toEqual([false]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).accountantStatus).toBe("CONFIRMED");
    expect(await db.receipt.count({ where: { paymentId: P1, deletedAt: null } })).toBe(1);
    const nk = await db.auditLog.findMany({ where: { entityId: id, action: "HUY_HOA_DON" } });
    expect(nk).toHaveLength(1);
    expect(nk[0]!.reason).toBe(LY_DO);
    expect(await khoanDaKhoaHoaDon(db, [P1])).toEqual([]);
  });

  it("[HUYDB-02] cổng khoá §5 qua ĐƯỜNG THẬT: từ chối khoản bị chặn trước khi huỷ, qua được sau khi huỷ", async () => {
    // Khoản THIẾU ghi danh ⇒ chốt hoá đơn nhưng khoản GIỮ CHỜ ⇒ còn từ chối được về mặt sổ tiền.
    await khoan(P2, 3_000_000, null);
    const id = await daXacNhan([P2]);
    const truoc = await rejectPayment({ paymentId: P2, confirmedById: `${T}ke-toan-2`, reason: "Tiền không về" });
    expect(truoc.ok).toBe(false);
    expect(truoc.ok ? "" : truoc.error).toMatch(/huỷ hoá đơn/);

    await huy(id);
    const sau = await rejectPayment({ paymentId: P2, confirmedById: `${T}ke-toan-2`, reason: "Tiền không về" });
    expect(sau.ok, sau.ok ? "" : sau.error).toBe(true);
  });

  it("[HUYDB-03] chỉ bản ĐÃ XÁC NHẬN của ĐÚNG đơn — nháp / không xuất / đã huỷ / sai đơn ⇒ DA_DOI, không ghi gì", async () => {
    await khoan(P1, 3_000_000);
    await khoan(P2, 3_000_000);
    const nhap = await taoNhap([P1]);
    const kx = await taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: DON,
      centerId: CS,
      lanThuKey: "kx",
      khoan: [{ id: P2, soTien: 3_000_000 }],
      loai: { trangThai: "KHONG_XUAT", lyDo: "Khách không lấy hoá đơn" },
    });
    for (const hoaDonId of [nhap.id, kx.id]) {
      expect(await maLoi(huy(hoaDonId)), hoaDonId).toBe("DA_DOI");
    }
    await goHoaDonChuaChot({ nguoiGhi: KT, orderId: DON, hoaDonId: nhap.id });
    const xn = await daXacNhan([P1]);
    expect(await maLoi(huyHoaDonDaXacNhan({ nguoiHuy: KT, orderId: `${T}don-khac`, hoaDonId: xn, lyDo: LY_DO, now: NOW }))).toBe(
      "DA_DOI",
    );
    await huy(xn);
    expect(await maLoi(huy(xn)), "đã huỷ rồi").toBe("DA_DOI");
    expect(await db.auditLog.count({ where: { entityId: { in: [nhap.id, kx.id, xn] }, action: "HUY_HOA_DON" } })).toBe(1);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: kx.id } })).trangThai).toBe("KHONG_XUAT");
  });

  it("[HUYDB-04] hai người cùng huỷ ⇒ đúng MỘT lượt thắng, một nhật ký", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]);
    const kq = await Promise.allSettled([huy(id), huy(id)]);
    expect(kq.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditLog.count({ where: { entityId: id, action: "HUY_HOA_DON" } })).toBe(1);
  });

  it("[HUYDB-05] lý do trống / quá ngắn ⇒ THIEU_LY_DO, KHÔNG ghi gì", async () => {
    await khoan(P1, 3_000_000);
    const id = await daXacNhan([P1]);
    for (const lyDo of ["", "   ", "nham"]) {
      expect(await maLoi(huy(id, lyDo)), JSON.stringify(lyDo)).toBe("THIEU_LY_DO");
    }
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).trangThai).toBe("DA_XAC_NHAN");
    expect(await db.auditLog.count({ where: { entityId: id, action: "HUY_HOA_DON" } })).toBe(0);
  });

  it("[HUYDB-06] bản kế tiếp TỰ nối thayTheChoId về bản đã huỷ — nháp lẫn không xuất; tiền mới ⇒ null", async () => {
    await khoan(P1, 3_000_000);
    await khoan(P3, 3_000_000);
    const a = await daXacNhan([P1]);
    await huy(a);

    const b = await taoNhap([P1]);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: b.id } })).thayTheChoId).toBe(a);
    const nkTao = await db.auditLog.findFirstOrThrow({ where: { entityId: b.id, action: "TAO_HOA_DON_NHAP" } });
    expect((nkTao.newValues as { thayTheChoId?: string }).thayTheChoId).toBe(a);

    await goHoaDonChuaChot({ nguoiGhi: KT, orderId: DON, hoaDonId: b.id });
    const kx = await taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: DON,
      centerId: CS,
      lanThuKey: "kx",
      khoan: [{ id: P1, soTien: 3_000_000 }],
      loai: { trangThai: "KHONG_XUAT", lyDo: "Đã xuất ngoài hệ thống" },
    });
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: kx.id } })).thayTheChoId).toBe(a);

    const moi = await taoNhap([P3]);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: moi.id } })).thayTheChoId).toBeNull();
  });

  it("[HUYDB-07] chuỗi A → B → C: C nối về B (bản huỷ GẦN NHẤT), không về A", async () => {
    await khoan(P1, 3_000_000);
    const a = await daXacNhan([P1]);
    await huyHoaDonDaXacNhan({ nguoiHuy: KT, orderId: DON, hoaDonId: a, lyDo: LY_DO, now: new Date("2699-09-26T08:00:00Z") });
    const b = await daXacNhan([P1]);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: b } })).thayTheChoId).toBe(a);
    await huyHoaDonDaXacNhan({ nguoiHuy: KT, orderId: DON, hoaDonId: b, lyDo: LY_DO, now: new Date("2699-09-26T09:00:00Z") });
    const c = await taoNhap([P1]);
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: c.id } })).thayTheChoId).toBe(b);
  });

  it("[HUYDB-08] chốt bản kế tiếp ⇒ KHÔNG cấp RCP thứ hai (khoản đã xác nhận từ bản cũ)", async () => {
    await khoan(P1, 3_000_000);
    const a = await daXacNhan([P1]);
    await huy(a);
    const b = await taoNhap([P1]);
    const kq = await chot(b.id);
    expect(kq.daXacNhan).toEqual([]);
    expect(await db.receipt.count({ where: { paymentId: P1 } })).toBe(1);
  });

  it("[HUYDB-09] thư của bản ĐÃ HUỶ không đi: lượt CHO ⇒ handler bỏ qua + đóng LOI; lượt DANG_GUI ⇒ worker CHẶN", async () => {
    await khoan(P1, 3_000_000);
    const a = await daXacNhan([P1]);
    const luot = await db.hoaDonGuiEmail.findFirstOrThrow({ where: { hoaDonId: a } });
    expect(luot.trangThai).toBe("CHO"); // tiền đề: chốt đã giành lượt gửi đầu
    await huy(a);
    expect(await giuLuotGuiHoaDon(luot.id, { hoaDonBat: true })).toBe("bo-qua");
    expect((await db.hoaDonGuiEmail.findUniqueOrThrow({ where: { id: luot.id } })).trangThai).toBe("LOI");
    expect(await db.emailQueue.count({ where: { contextId: luot.id } })).toBe(0);

    // Lượt đã được giành (DANG_GUI) trước lúc huỷ — worker đọc lại hoá đơn và CHẶN.
    const b = await daXacNhan([P1]);
    const luotB = await db.hoaDonGuiEmail.findFirstOrThrow({ where: { hoaDonId: b } });
    await db.hoaDonGuiEmail.update({ where: { id: luotB.id }, data: { trangThai: "DANG_GUI" } });
    await huy(b);
    expect(await chuanBiGuiHoaDon(luotB.id)).toMatchObject({ ok: false, chan: true });
  });

  it("[HUYDB-10] sau khi huỷ, khoản trở lại hàng chờ của màn kế toán — ngăn 'cho', cùng khoá lần thu", async () => {
    await khoan(P1, 3_000_000);
    const a = await daXacNhan([P1]);
    const truoc = await napHangChoHoaDon(SIEU, { canViewPii: true, orderId: DON });
    const dongA = truoc.dong.find((d) => d.hoaDon?.id === a)!;
    expect(dongA.ngan).toBe("da-xuat");

    await huy(a);
    const sau = await napHangChoHoaDon(SIEU, { canViewPii: true, orderId: DON });
    expect(sau.dong.map((d) => d.ngan)).toEqual(["cho"]);
    expect(sau.dong[0]!.khoanIds).toEqual([P1]);
    expect(sau.dong[0]!.key).toBe(dongA.key);
  });
});

// Ca TÍCH HỢP (PLAN §5 + §2.2): cờ "cần điều chỉnh" SUY RA lúc đọc — `adjustPayment` (diện R7) cố ý không
// ghi gì vào bảng hoá đơn ("không chặn, không sửa"). Thứ DUY NHẤT nối hai đầu là loader của màn, nên
// ca này đi đúng đường thật cả hai phía: chốt thật → điều chỉnh thật → nạp hàng chờ thật.
describe.skipIf(!RUN_DB_TESTS)("[HUYDB-11] hoá đơn ĐÃ XÁC NHẬN + adjustPayment THẬT ⇒ ngăn 'Cần điều chỉnh'", () => {
  /** `adjustPayment` sinh bút toán + nhật ký mang id KHÔNG có tiền tố fixture — dọn theo id ghi lại. */
  const butToan: string[] = [];
  beforeEach(dungFixture);
  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { entityId: { in: butToan } } });
    await don();
  });

  it("[HUYDB-11] đối chứng: chưa điều chỉnh ⇒ 'da-xuat'; điều chỉnh GIẢM sau khi xuất ⇒ 'can-dieu-chinh' kèm lý do số tiền lệch tờ", async () => {
    await khoan(P1, 3_000_000);
    const { id } = await taoNhap([P1]);
    // Mốc chốt ở QUÁ KHỨ — bút toán điều chỉnh mang `createdAt` do DB đặt, nên nó đứng SAU mốc như ngoài đời.
    await chot(id, new Date("2026-09-01T02:00:00Z"));
    expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).confirmedById).toBe(KT.id); // tiền đề: chốt đã xác nhận khoản

    const truoc = await napHangChoHoaDon(SIEU, { canViewPii: true, orderId: DON });
    expect(truoc.dong.map((d) => [d.hoaDon?.id, d.ngan])).toEqual([[id, "da-xuat"]]);
    expect(truoc.dong[0]!.canDieuChinh).toEqual([]);

    const dc = await adjustPayment({ paymentId: P1, correctAmount: 2_000_000, reason: "Giảm 1 triệu theo học bổng", actorId: KT.id });
    expect(dc.ok, dc.ok ? "" : dc.error).toBe(true);
    if (dc.ok) butToan.push(dc.adjustmentId);

    const sau = await napHangChoHoaDon(SIEU, { canViewPii: true, orderId: DON });
    expect(sau.dong.map((d) => [d.hoaDon?.id, d.ngan])).toEqual([[id, "can-dieu-chinh"]]);
    expect(sau.dong[0]!.canDieuChinh).toEqual(expect.arrayContaining([expect.stringMatching(/khác tổng trên hoá đơn/)]));
    // Cờ suy ra — bảng hoá đơn KHÔNG bị đường tiền chạm tới.
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({ trangThai: "DA_XAC_NHAN", tongTien: 3_000_000 });
  });
});
