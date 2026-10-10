// Ca [HDG-*] — GỘP nhiều lần thu của CÙNG MỘT ĐƠN thành MỘT hoá đơn (chủ dự án chốt 29/09 — Q2,
// PLAN §3.4 (i) "khoản chưa xuất của cùng đơn") trên Postgres THẬT.
//
// Hình dạng thật: đợt 1 = 5.000.000đ; phụ huynh chuyển khoản 3.000.000đ (webhook SePay, rót vào đợt) +
// nộp tiền mặt 2.000.000đ (tiền mặt KHÔNG BAO GIỜ sinh PaymentAllocation) ⇒ mặc định HAI dòng: một dòng
// THIẾU 2tr + một dòng tiền mặt `k:`. Bộ này canh những thứ test thuần không chứng minh được:
//   · đường server của action (`napHangChoHoaDon` thu hẹp theo đơn + tập gộp đọc từ KHOÁ + tìm theo khoá)
//     ra đúng dòng gộp — và KHÔNG ra khi khoá mang lần thu của đơn khác / lần thu đã khoá hoá đơn khác;
//   · lưu nháp gộp ghi đủ HoaDonKhoan của cả tập; hàng chờ sau đó còn MỘT dòng mang đúng khoá gộp;
//   · bước chốt dựng lần thu GỘP từ HoaDonKhoan trong transaction ⇒ DU; gộp xong vẫn THIẾU ⇒ từ chối
//     trừ khi "xuất theo số đã thu".
// Mọi hoá đơn đi qua ĐÚNG đường thật (`taoHoaDonChoLanThu` → `chotHoaDon`). Không gọi `resetDb()`:
// fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
}));

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { SALE_STATUS_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { gatewayMarker } from "@/lib/finance/payment-markers";
import { chotHoaDon, LoiChotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { COT_NGUOI_MUA, taoHoaDonChoLanThu } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import { napHangChoHoaDon } from "@/lib/finance/hoa-don/hang-cho";
import { gopTuKhoa, khoaGop } from "@/lib/finance/hoa-don/lan-thu";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";

if (!RUN_DB_TESTS) console.warn(`[HDG] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hdg-";
const CS = `${T}center`;
const KHOA_HOC = `${T}khoa`;
const LOP = `${T}lop`;
const HS = `${T}hs`;
const GD = `${T}gd`;
const DON = `${T}don`;
const DON2 = `${T}don2`;
const DOT = `${T}dot1`;
const BT = `${T}bt1`;
const TXN = `${T}txn-dot1`;
const P_CK = `${T}p-ck`;
const P_TM = `${T}p-tm`;
const P2_TM = `${T}p2-tm`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture" };
const SALE = `${T}sale`;
const PHAP_NHAN = { ma: "SATA_ROBO", ten: "Công ty CP Sata Robo", maSoThue: "0402301783", diaChi: "Đà Nẵng", bat: true };
/** Giá trị `saleStatus` "đã ghi nhận" — đọc từ hằng của trục B, không gõ literal. */
const DA_GHI = SALE_STATUS_DA_GHI_NHAN[0]!;
const K_CK = `dot:${DOT}`;
const K_TM = `k:${P_TM}`;
const K_GOP = khoaGop([K_CK, K_TM]);

async function don() {
  const hd = await db.hoaDonDienTu.findMany({ where: { orderId: { in: [DON, DON2] } }, select: { id: true } });
  const gui = await db.hoaDonGuiEmail.findMany({ where: { hoaDonId: { in: hd.map((h) => h.id) } }, select: { id: true } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { in: gui.map((g) => `hoa-don.gui:${g.id}`) } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: [DON, DON2] } } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: hd.map((h) => h.id) } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: [DON, DON2] } } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: [DON, DON2] } } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: { in: [DON, DON2] } } });
  await db.order.deleteMany({ where: { id: { in: [DON, DON2] } } });
  await db.enrollment.deleteMany({ where: { id: GD } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA_HOC } });
  await db.student.deleteMany({ where: { id: HS } });
  await db.center.deleteMany({ where: { id: CS } });
}

const tienMat = (id: string, orderId: string, amount: number) =>
  db.payment.create({
    data: {
      id,
      orderId,
      amount,
      method: "CASH",
      paidDate: new Date("2699-09-12T03:00:00Z"),
      saleStatus: DA_GHI,
      accountantStatus: "PENDING",
      enrollmentId: orderId === DON ? GD : null,
      recordedById: SALE,
      centerId: CS,
    },
  });

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture HDG", slug: `${T}co-so`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: KHOA_HOC, name: "Sata 5 fixture", slug: `${T}sata-5` } });
  await db.class.create({ data: { id: LOP, name: "Lớp fixture HDG", courseId: KHOA_HOC } });
  await db.student.create({ data: { id: HS, name: "Bé Gộp HDG" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA_HOC, finalPrice: 5_000_000 } });
  for (const [id, code] of [
    [DON, "ORD-269929-000501"],
    [DON2, "ORD-269929-000502"],
  ] as const) {
    await db.order.create({
      data: {
        id,
        code,
        type: "COURSE",
        status: "CONFIRMED",
        customerName: "PH HDG",
        customerPhone: "0999000555",
        customerEmail: "phuhuynh.hdg@example.com",
        totalAmount: 5_000_000,
        centerId: CS,
      },
    });
  }
  // Đợt 1 = 5tr · CK 3tr rót vào đợt ⇒ đợt PARTIAL vĩnh viễn (tiền mặt không sinh phân bổ).
  await db.paymentRequest.create({
    data: { id: DOT, orderId: DON, installmentNo: 1, amountDue: 5_000_000, status: "PARTIAL", sortOrder: 1, centerId: CS },
  });
  await db.bankTransaction.create({
    data: {
      id: BT,
      provider: "SEPAY",
      providerTxnId: TXN,
      amount: 3_000_000,
      transferredAt: new Date("2699-09-10T10:00:00Z"),
      status: "MATCHED",
      centerId: CS,
    },
  });
  await db.paymentAllocation.create({
    data: { bankTransactionId: BT, paymentRequestId: DOT, amount: 3_000_000, roundingWaived: 0, centerId: CS },
  });
  await db.payment.create({
    data: {
      id: P_CK,
      orderId: DON,
      amount: 3_000_000,
      method: "BANK_TRANSFER",
      note: gatewayMarker("SEPAY", TXN),
      paidDate: new Date("2699-09-10T03:00:00Z"),
      saleStatus: DA_GHI,
      accountantStatus: "PENDING",
      enrollmentId: GD,
      recordedById: SALE,
      centerId: CS,
    },
  });
  await tienMat(P_TM, DON, 2_000_000);
  await tienMat(P2_TM, DON2, 2_000_000);
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
const KT_CS = {
  userId: KT.id,
  isSuperAdmin: false,
  grantsAllow: new Set<string>(),
  permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: [CS] }],
} as unknown as Actor;

/** ĐÚNG đường server của action (`dongCuaLanThu` trong `_actions.ts`): thu hẹp theo đơn + tập gộp từ khoá. */
async function dongCuaLanThu(orderId: string, key: string): Promise<DongHangCho | null> {
  const { dong } = await napHangChoHoaDon(SIEU, { canViewPii: true, orderId, gop: gopTuKhoa(key) });
  return dong.find((d) => d.key === key && d.orderId === orderId) ?? null;
}
const dongCuaDon = async (orderId: string = DON) =>
  (await napHangChoHoaDon(SIEU, { canViewPii: true, orderId })).dong.filter((d) => d.orderId === orderId);

let dem = 0;
/** Lưu nháp như action: tập khoản + khoá + số THIẾU từ DÒNG LOADER dựng lại. */
const luuNhap = (row: DongHangCho, theoSo: string | null = null) =>
  taoHoaDonChoLanThu({
    nguoiGhi: KT,
    orderId: row.orderId,
    centerId: CS,
    lanThuKey: row.key,
    khoan: row.khoan,
    loai: {
      trangThai: "NHAP",
      phapNhan: PHAP_NHAN,
      so: { kyHieu: "1C99TSR", soHoaDon: String(800 + ++dem), ngayPhatHanh: new Date("2699-09-21T00:00:00Z") },
      guiEmailKhach: false,
      pdf: { khoa: `hoa-don/HDG/${row.orderId}/${dem}.pdf`, ten: `hd-${dem}.pdf`, co: 1000, sha256: `sha-hdg-${dem}` },
      xml: null,
      theoSoDaThu: theoSo ? { lyDo: theoSo, thieu: row.thieu, nhanDot: row.nhanDot } : null,
      tienTha: row.tienTha,
    },
  });

async function chot(hoaDonId: string) {
  const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId }, select: { updatedAt: true } });
  const donHt = await db.order.findUniqueOrThrow({ where: { id: DON }, select: COT_NGUOI_MUA });
  return chotHoaDon({
    nguoiChot: KT,
    actor: KT_CS,
    orderId: DON,
    hoaDonId,
    now: new Date("2699-09-26T08:00:00Z"),
    phienBan: hd.updatedAt,
    emailDuKien: nguoiMuaChoDon(donHt).email,
  });
}

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiChotHoaDon ? e.ma : String(e);
  }
}

describe.skipIf(!RUN_DB_TESTS)("[HDG-01..03] đường server tìm dòng GỘP theo khoá", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HDG-01] mặc định HAI dòng (THIẾU 2tr + tiền mặt); khoá gộp ⇒ MỘT dòng đủ 5tr, 'Chờ xuất', tải lên mở", async () => {
    const hai = await dongCuaDon();
    expect(hai.map((d) => [d.key, d.ngan, d.soTien, d.thieu]).sort()).toEqual(
      [
        [K_CK, "lech", 3_000_000, 2_000_000],
        [K_TM, "cho", 2_000_000, 0],
      ].sort(),
    );
    expect(hai.find((d) => d.key === K_CK)!.gopVoi.map((g) => g.key)).toEqual([K_TM]);

    const gop = (await dongCuaLanThu(DON, K_GOP))!;
    expect(gop).toMatchObject({ key: K_GOP, ngan: "cho", soTien: 5_000_000, thieu: 0 });
    expect(gop.khoan.map((k) => [k.id, k.soTien]).sort()).toEqual(
      [
        [P_CK, 3_000_000],
        [P_TM, 2_000_000],
      ].sort(),
    );
    expect(gop.hanhDong.taiLen.bat).toBe(true);
  });

  it("[HDG-02] khoá gộp mang lần thu của ĐƠN KHÁC ⇒ không có dòng (dù đơn đích có đủ phần của nó)", async () => {
    expect(await dongCuaLanThu(DON, khoaGop([K_CK, `k:${P2_TM}`]))).toBeNull();
    expect(await dongCuaLanThu(DON2, khoaGop([K_CK, `k:${P2_TM}`]))).toBeNull();
    // Đối chứng dương: đúng tập của đơn ⇒ có dòng.
    expect(await dongCuaLanThu(DON, K_GOP)).not.toBeNull();
  });

  it("[HDG-03] một thành phần đã KHOÁ vào hoá đơn khác (không xuất) ⇒ không có dòng gộp", async () => {
    const tm = (await dongCuaDon()).find((d) => d.key === K_TM)!;
    await taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: DON,
      centerId: CS,
      lanThuKey: tm.key,
      khoan: tm.khoan,
      loai: { trangThai: "KHONG_XUAT", lyDo: "Khách không lấy hoá đơn" },
    });
    expect(await dongCuaLanThu(DON, K_GOP)).toBeNull();
    // Đối chứng: phần CK vẫn tìm được theo khoá của nó.
    expect(await dongCuaLanThu(DON, K_CK)).not.toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HDG-04..06] lưu nháp gộp + chốt gộp", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HDG-04] lưu nháp cho dòng gộp ⇒ HoaDonKhoan ĐỦ tập; hàng chờ còn MỘT dòng 'nhap' cùng khoá; chốt ⇒ DU, xác nhận cả hai khoản", async () => {
    const row = (await dongCuaLanThu(DON, K_GOP))!;
    const { id } = await luuNhap(row);
    const khoan = await db.hoaDonKhoan.findMany({ where: { hoaDonId: id, hieuLuc: true }, select: { paymentId: true, soTien: true } });
    expect(khoan.map((k) => [k.paymentId, k.soTien]).sort()).toEqual(
      [
        [P_CK, 3_000_000],
        [P_TM, 2_000_000],
      ].sort(),
    );
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).tongTien).toBe(5_000_000);

    // Mở lại màn (không mang tập gộp): thành phần không còn hiện riêng, dòng nháp giữ đúng khoá gộp.
    const sau = await dongCuaDon();
    expect(sau.map((d) => [d.key, d.ngan, d.soTien])).toEqual([[K_GOP, "nhap", 5_000_000]]);
    expect(sau[0]!.hanhDong.xacNhan.bat).toBe(true);

    const kq = await chot(id);
    expect(kq.daXacNhan.map((x) => x.paymentId).sort()).toEqual([P_CK, P_TM].sort());
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).trangThai).toBe("DA_XAC_NHAN");
  });

  it("[HDG-05] đối chứng: nháp CHỈ phần chuyển khoản (không gộp) ⇒ bước chốt dựng lần thu THIẾU ⇒ LAN_THU_THIEU, không ghi gì", async () => {
    const ck = (await dongCuaLanThu(DON, K_CK))!;
    expect(ck.ngan).toBe("lech");
    const { id } = await luuNhap(ck);
    expect(await maLoi(chot(id))).toBe("LAN_THU_THIEU");
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).trangThai).toBe("NHAP");
    expect(await db.receipt.count({ where: { paymentId: { in: [P_CK, P_TM] } } })).toBe(0);
  });

  it("[HDG-06] gộp xong vẫn THIẾU (đợt 6tr) ⇒ dòng 'lech' đòi 'xuất theo số đã thu'; nháp không chọn ⇒ chốt từ chối; có lý do ⇒ chốt được", async () => {
    await db.paymentRequest.update({ where: { id: DOT }, data: { amountDue: 6_000_000 } });
    const row = (await dongCuaLanThu(DON, K_GOP))!;
    expect(row).toMatchObject({ ngan: "lech", thieu: 1_000_000, soTien: 5_000_000 });
    expect(row.hanhDong.ngoaiLe?.loai).toBe("THEO_SO_DA_THU");

    const { id } = await luuNhap(row);
    expect(await maLoi(chot(id))).toBe("LAN_THU_THIEU");
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).trangThai).toBe("NHAP");

    await db.hoaDonDienTu.update({
      where: { id },
      data: { xuatTheoSoDaThu: true, xuatTheoSoDaThuLyDo: "Phụ huynh báo không đóng nốt phần thiếu" },
    });
    expect(await maLoi(chot(id))).toBeNull();
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).trangThai).toBe("DA_XAC_NHAN");
  });
});
