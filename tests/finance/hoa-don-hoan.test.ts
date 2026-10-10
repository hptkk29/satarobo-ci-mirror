// Ca [HDHDB-*] — YÊU CẦU HOÀN HỌC PHÍ (`RefundRequest`) × màn Hoá đơn điện tử, trên Postgres THẬT
// (chủ dự án chốt 29/09 — Q1 + Q3). Luật thuần ở `lib/finance/hoa-don/hoan-tien-don.ts` + `can-dieu-chinh.ts`;
// bộ này canh HAI thứ mà test thuần không chứng minh được:
//   · câu tra NỐI yêu cầu hoàn với ĐƠN (`dieuKienHoanCuaDon` + `chonHoanCuaDon` + `hoanTheoDon`) — nhánh
//     `orderItemId` và nhánh ghi danh — và KHÔNG kéo yêu cầu của đơn khác vào;
//   · bước chốt (`chotHoaDon`) từ chối TRONG transaction, TRƯỚC phép ghi đầu tiên (không ghi gì).
//
// Mọi hoá đơn đi qua ĐÚNG đường thật (`taoHoaDonChoLanThu` → `chotHoaDon`). Mốc thời gian đều TUYỆT ĐỐI
// (luật 19): bản KHONG_XUAT mang `createdAt` do DB đặt (= lúc chạy), nên mốc "sau" là năm 2699 và mốc
// "trước" là năm 2000 — không ca nào phụ thuộc hôm nay là ngày nào.
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
}));

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { SALE_STATUS_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { chotHoaDon, LoiChotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { COT_NGUOI_MUA, taoHoaDonChoLanThu } from "@/lib/finance/hoa-don/ghi-hoa-don";
import { nguoiMuaChoDon } from "@/lib/finance/hoa-don/nguoi-mua";
import { napHangChoHoaDon } from "@/lib/finance/hoa-don/hang-cho";
import { LY_DO_DA_XUAT_NGOAI, LY_DO_KHACH_KHONG_LAY } from "@/lib/finance/hoa-don/ly-do-khong-xuat";
import {
  CAU_HOAN_CHAN_XAC_NHAN,
  chonHoanCuaDon,
  dieuKienHoanCuaDon,
  hoanTheoDon,
  TRANG_THAI_HOAN_CAN_NAP,
} from "@/lib/finance/hoa-don/hoan-tien-don";

if (!RUN_DB_TESTS) console.warn(`[HDHDB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hdh-";
const CS = `${T}center`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HS = `${T}hs`;
const HS2 = `${T}hs2`;
const GD = `${T}gd`;
const GD2 = `${T}gd2`;
const DON = `${T}don`;
const DON2 = `${T}don2`;
const OI = `${T}oi`;
const OI2 = `${T}oi2`;
// 29/09 — bé THỨ HAI trên CÙNG đơn DON (cờ hoàn theo khoản).
const HS_B = `${T}hs-b`;
const GD_B = `${T}gd-b`;
const OI_B = `${T}oi-b`;
const P_B = `${T}p-b`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture" };
const SALE = `${T}sale`;
const P1 = `${T}p1`;
const P_DON2 = `${T}p-don2`;
const XN_QUA_KHU = new Date("2026-09-01T02:00:00Z");
const SAU = new Date("2699-01-15T02:00:00Z");
const TRUOC = new Date("2000-01-15T02:00:00Z");
const PHAP_NHAN = { ma: "SATA_ROBO", ten: "Công ty CP Sata Robo", maSoThue: "0402301783", diaChi: "Đà Nẵng", bat: true };
/** Giá trị `saleStatus` "đã ghi nhận" — đọc từ hằng của trục B, không gõ literal. */
const DA_GHI = SALE_STATUS_DA_GHI_NHAN[0]!;

async function don() {
  const hd = await db.hoaDonDienTu.findMany({ where: { orderId: { in: [DON, DON2] } }, select: { id: true } });
  const gui = await db.hoaDonGuiEmail.findMany({ where: { hoaDonId: { in: hd.map((h) => h.id) } }, select: { id: true } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { in: gui.map((g) => `hoa-don.gui:${g.id}`) } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: [DON, DON2] } } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: hd.map((h) => h.id) } } });
  await db.refundRequest.deleteMany({ where: { reason: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: { in: [DON, DON2] } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: [DON, DON2] } } });
  await db.order.deleteMany({ where: { id: { in: [DON, DON2] } } });
  await db.enrollment.deleteMany({ where: { id: { in: [GD, GD2, GD_B] } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: [HS, HS2, HS_B] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

const khoan = (id: string, orderId: string, enrollmentId: string | null) =>
  db.payment.create({
    data: {
      id,
      orderId,
      amount: 3_000_000,
      method: "CASH",
      paidDate: new Date("2699-09-20T03:00:00Z"),
      saleStatus: DA_GHI,
      accountantStatus: "PENDING",
      enrollmentId,
      recordedById: SALE,
      centerId: CS,
    },
  });

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture HDH", slug: `${T}co-so`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 5 fixture", slug: `${T}sata-5` } });
  await db.class.create({ data: { id: LOP, name: "Lớp fixture HDH", courseId: KHOA } });
  await db.student.create({ data: { id: HS, name: "Bé Hoàn HDH" } });
  await db.student.create({ data: { id: HS2, name: "Bé Đơn Khác HDH" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA, finalPrice: 9_000_000 } });
  await db.enrollment.create({ data: { id: GD2, studentId: HS2, classId: LOP, courseId: KHOA, finalPrice: 9_000_000 } });
  for (const [id, code] of [
    [DON, "ORD-269929-000401"],
    [DON2, "ORD-269929-000402"],
  ] as const) {
    await db.order.create({
      data: {
        id,
        code,
        type: "COURSE",
        status: "CONFIRMED",
        customerName: "PH HDH",
        customerPhone: "0999000666",
        customerEmail: "phuhuynh.hdh@example.com",
        totalAmount: 9_000_000,
        centerId: CS,
      },
    });
  }
  // Dòng đơn KHÔNG gắn ghi danh (đơn tạo tay trước lúc convert) — nhánh `orderItemId` phải tự đủ.
  await db.orderItem.create({
    data: { id: OI, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 5 — Bé Hoàn", quantity: 1, unitPrice: 9_000_000, totalPrice: 9_000_000 },
  });
  await db.orderItem.create({
    data: { id: OI2, orderId: DON2, type: "COURSE_ENROLLMENT", itemName: "Sata 5 — đơn khác", quantity: 1, unitPrice: 9_000_000, totalPrice: 9_000_000 },
  });
  await khoan(P1, DON, GD);
  await khoan(P_DON2, DON2, GD2);
}

type Nguon = { orderItemId: string } | { enrollmentId: string };
const hoan = (nguon: Nguon, status: "PENDING" | "APPROVED" | "PAID" | "REJECTED", approvedAt: Date | null = null) =>
  db.refundRequest.create({
    data: {
      ...nguon,
      centerId: CS,
      trigger: "WITHDRAW",
      reason: `${T}nghỉ học`,
      paidConfirmed: 3_000_000,
      sessionsTotal: 48,
      sessionsLearned: 12,
      unitPrice: 62_500,
      proposedAmount: 1_000_000,
      approvedAmount: status === "PENDING" ? null : 1_000_000,
      status,
      approvedAt,
    },
  });

let dem = 0;
const taoNhap = () =>
  taoHoaDonChoLanThu({
    nguoiGhi: KT,
    orderId: DON,
    centerId: CS,
    lanThuKey: `khoan:${P1}`,
    khoan: [{ id: P1, soTien: 3_000_000 }],
    loai: {
      trangThai: "NHAP",
      phapNhan: PHAP_NHAN,
      so: { kyHieu: "1C99TSR", soHoaDon: String(700 + ++dem), ngayPhatHanh: new Date("2699-09-21T00:00:00Z") },
      guiEmailKhach: false,
      pdf: { khoa: `hoa-don/HDH/${DON}/${dem}.pdf`, ten: `hd-${dem}.pdf`, co: 1000, sha256: `sha-hdh-${dem}` },
      xml: null,
      theoSoDaThu: null,
      tienTha: 0,
    },
  });
const danhDauKhongXuat = (lyDo: string) =>
  taoHoaDonChoLanThu({
    nguoiGhi: KT,
    orderId: DON,
    centerId: CS,
    lanThuKey: `khoan:${P1}`,
    khoan: [{ id: P1, soTien: 3_000_000 }],
    loai: { trangThai: "KHONG_XUAT", lyDo },
  });

const KT_CS = {
  userId: KT.id,
  isSuperAdmin: false,
  grantsAllow: new Set<string>(),
  permissions: [{ action: "payments:confirm", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "X", centerScope: [CS] }],
} as unknown as Actor;

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

async function chot(hoaDonId: string, now: Date = XN_QUA_KHU) {
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

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiChotHoaDon ? e.ma : String(e);
  }
}

/** Không ghi gì: bản nháp vẫn NHAP, khoản vẫn CHỜ, không phiếu thu. */
async function khongGhiGi(hoaDonId: string) {
  expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId } })).trangThai).toBe("NHAP");
  expect((await db.payment.findUniqueOrThrow({ where: { id: P1 } })).accountantStatus).toBe("PENDING");
  expect(await db.receipt.count({ where: { paymentId: P1 } })).toBe(0);
}

const dongCuaDon = async (opts: Parameters<typeof napHangChoHoaDon>[1]) =>
  (await napHangChoHoaDon(SIEU, opts)).dong.filter((d) => d.orderId === DON);

describe.skipIf(!RUN_DB_TESTS)("[HDHDB-01..03] nối yêu cầu hoàn với ĐƠN — câu tra thật", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const nap = async (ids: string[]) =>
    hoanTheoDon(
      await db.refundRequest.findMany({ where: dieuKienHoanCuaDon(ids, TRANG_THAI_HOAN_CAN_NAP), select: chonHoanCuaDon(ids) }),
    );

  it("[HDHDB-01] nhánh orderItemId ⇒ đúng đơn, tên = tên dòng đơn; yêu cầu của ĐƠN KHÁC không lọt vào", async () => {
    const a = await hoan({ orderItemId: OI }, "APPROVED", SAU);
    await hoan({ orderItemId: OI2 }, "APPROVED", SAU);
    const m = await nap([DON]);
    expect([...m.keys()]).toEqual([DON]);
    expect(m.get(DON)!.map((r) => [r.id, r.ten, r.soTien])).toEqual([[a.id, "Sata 5 — Bé Hoàn", 1_000_000]]);
  });

  it("[HDHDB-02] nhánh ghi danh (orderItemId NULL): khoản thu của đơn gắn ghi danh ⇒ thuộc đơn, tên = tên bé; ghi danh của đơn khác ⇒ không", async () => {
    const a = await hoan({ enrollmentId: GD }, "PENDING");
    await hoan({ enrollmentId: GD2 }, "PENDING");
    const m = await nap([DON]);
    expect(m.get(DON)!.map((r) => [r.id, r.ten])).toEqual([[a.id, "Bé Hoàn HDH"]]);
    // Nạp cả hai đơn một lượt (đúng hình dạng loader) ⇒ mỗi đơn đúng yêu cầu của nó.
    const ca2 = await nap([DON, DON2]);
    expect(ca2.get(DON)!.map((r) => r.id)).toEqual([a.id]);
    expect(ca2.get(DON2)!.map((r) => r.ten)).toEqual(["Bé Đơn Khác HDH"]);
  });

  it("[HDHDB-03] REJECTED không nạp; nhánh ghi danh qua DÒNG ĐƠN (OrderItem.enrollmentId) cũng nối được", async () => {
    await hoan({ orderItemId: OI }, "REJECTED", SAU);
    expect((await nap([DON])).size).toBe(0);
    await db.payment.update({ where: { id: P1 }, data: { enrollmentId: null } }); // bỏ đường khoản thu
    await db.orderItem.update({ where: { id: OI }, data: { enrollmentId: GD } }); // chỉ còn đường dòng đơn
    const a = await hoan({ enrollmentId: GD }, "APPROVED", SAU);
    expect((await nap([DON])).get(DON)!.map((r) => r.id)).toEqual([a.id]);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HDHDB-04..06] (Q1b) bản NHÁP của đơn có yêu cầu hoàn CHỜ / ĐÃ DUYỆT — màn và cổng cùng chặn", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HDHDB-04] yêu cầu CHỜ (nhánh dòng đơn) ⇒ nút tắt đúng câu · chotHoaDon ném CO_YEU_CAU_HOAN, KHÔNG ghi gì", async () => {
    const r = await hoan({ orderItemId: OI }, "PENDING");
    const { id } = await taoNhap();
    const dong = (await dongCuaDon({ canViewPii: true, orderId: DON })).find((d) => d.hoaDon?.id === id)!;
    expect(dong.ngan).toBe("nhap");
    expect(dong.hanhDong.xacNhan).toEqual({ bat: false, lyDo: CAU_HOAN_CHAN_XAC_NHAN });

    expect(await maLoi(chot(id))).toBe("CO_YEU_CAU_HOAN");
    await khongGhiGi(id);

    // Đối chứng: yêu cầu bị TỪ CHỐI ⇒ nút sáng, chốt được.
    await db.refundRequest.update({ where: { id: r.id }, data: { status: "REJECTED" } });
    const sau = (await dongCuaDon({ canViewPii: true, orderId: DON })).find((d) => d.hoaDon?.id === id)!;
    expect(sau.hanhDong.xacNhan.bat).toBe(true);
    expect(await maLoi(chot(id))).toBeNull();
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).trangThai).toBe("DA_XAC_NHAN");
  });

  it("[HDHDB-05] yêu cầu ĐÃ DUYỆT qua nhánh ghi danh ⇒ chốt từ chối, KHÔNG ghi gì", async () => {
    await hoan({ enrollmentId: GD }, "APPROVED", SAU);
    const { id } = await taoNhap();
    expect(await maLoi(chot(id))).toBe("CO_YEU_CAU_HOAN");
    await khongGhiGi(id);
  });

  it("[HDHDB-06] yêu cầu ĐÃ CHI (PAID) CŨNG chặn (chốt 29/09, 0b) — màn và cổng; yêu cầu của ĐƠN KHÁC không chặn", async () => {
    const r = await hoan({ enrollmentId: GD }, "PAID", TRUOC);
    await hoan({ orderItemId: OI2 }, "PENDING");
    const { id } = await taoNhap();
    const dong = (await dongCuaDon({ canViewPii: true, orderId: DON })).find((d) => d.hoaDon?.id === id)!;
    expect(dong.hanhDong.xacNhan).toEqual({ bat: false, lyDo: CAU_HOAN_CHAN_XAC_NHAN });
    expect(await maLoi(chot(id))).toBe("CO_YEU_CAU_HOAN");
    await khongGhiGi(id);
    // Đối chứng dương: gỡ yêu cầu ĐÃ CHI của đơn này ⇒ chỉ còn yêu cầu của ĐƠN KHÁC ⇒ chốt được.
    await db.refundRequest.update({ where: { id: r.id }, data: { status: "REJECTED" } });
    expect(await maLoi(chot(id))).toBeNull();
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HDHDB-07..10] (Q1a + Q3) bản ĐÃ XUẤT mà hoàn được duyệt SAU mốc ⇒ 'Cần điều chỉnh'", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HDHDB-07] DA_XAC_NHAN + hoàn duyệt SAU xacNhanLuc ⇒ can-dieu-chinh kèm câu số tiền + tên bé; duyệt TRƯỚC ⇒ da-xuat", async () => {
    const { id } = await taoNhap();
    await chot(id); // xacNhanLuc = 01/09/2026
    const r = await hoan({ enrollmentId: GD }, "PAID", TRUOC);
    const truoc = (await dongCuaDon({ canViewPii: true, orderId: DON })).find((d) => d.hoaDon?.id === id)!;
    expect(truoc.ngan).toBe("da-xuat");

    await db.refundRequest.update({ where: { id: r.id }, data: { approvedAt: SAU } });
    const sau = (await dongCuaDon({ canViewPii: true, orderId: DON })).find((d) => d.hoaDon?.id === id)!;
    expect(sau.ngan).toBe("can-dieu-chinh");
    expect(sau.canDieuChinh).toEqual([
      expect.stringMatching(/^Đã duyệt hoàn 1\.000\.000đ cho Bé Hoàn HDH ngày 15\/01 — lập hoá đơn điều chỉnh ở MISA rồi huỷ/),
    ]);
    // Chỉ bật cờ — không đường nào chạm sổ tiền hay bảng hoá đơn.
    expect(await db.hoaDonDienTu.findUniqueOrThrow({ where: { id } })).toMatchObject({ trangThai: "DA_XAC_NHAN", tongTien: 3_000_000 });
    expect(await db.payment.count({ where: { orderId: DON } })).toBe(1);
  });

  it("[HDHDB-08] KHONG_XUAT 'Đã xuất ngoài hệ thống' + hoàn duyệt SAU lúc đánh dấu ⇒ can-dieu-chinh (việc tiếp: gỡ dấu)", async () => {
    const { id } = await danhDauKhongXuat(LY_DO_DA_XUAT_NGOAI);
    await hoan({ orderItemId: OI }, "APPROVED", SAU);
    const d = (await dongCuaDon({ canViewPii: true, orderId: DON })).find((x) => x.hoaDon?.id === id)!;
    expect(d.ngan).toBe("can-dieu-chinh");
    expect(d.canDieuChinh).toEqual([expect.stringMatching(/gỡ dấu 'Đã xuất ngoài hệ thống'/)]);
    expect(d.huy.bat).toBe(false); // bản không xuất không có nút huỷ
  });

  it("[HDHDB-09] đối chứng: KHONG_XUAT 'Khách không lấy hoá đơn' + đúng yêu cầu hoàn đó ⇒ vẫn khong-xuat", async () => {
    const { id } = await danhDauKhongXuat(LY_DO_KHACH_KHONG_LAY);
    await hoan({ orderItemId: OI }, "APPROVED", SAU);
    const d = (await dongCuaDon({ canViewPii: true, orderId: DON })).find((x) => x.hoaDon?.id === id)!;
    expect(d.ngan).toBe("khong-xuat");
    expect(d.canDieuChinh).toEqual([]);
  });

  it("[HDHDB-10] có bộ lọc THÁNG khác tháng của hoá đơn ⇒ dòng cần điều chỉnh VẪN hiện (nhánh 7 của câu tra); không hoàn ⇒ bị cắt", async () => {
    const { id } = await taoNhap();
    await chot(id);
    const boLoc = { coSo: CS, thang: "2026-01" };
    expect((await dongCuaDon({ canViewPii: true, boLoc })).map((d) => d.hoaDon?.id)).toEqual([]);
    await hoan({ enrollmentId: GD }, "APPROVED", SAU);
    const ds = await dongCuaDon({ canViewPii: true, boLoc });
    expect(ds.map((d) => [d.hoaDon?.id, d.ngan])).toEqual([[id, "can-dieu-chinh"]]);
  });
});

// ── 29/09 — CỜ HOÀN THEO KHOẢN, KHÔNG THEO CẢ ĐƠN ──────────────────────────────────────────────────────
// Đơn DON có HAI bé: bé A (dòng OI ↔ ghi danh GD, khoản P1) và bé B (dòng OI_B ↔ ghi danh GD_B, khoản P_B).
// Yêu cầu hoàn cho bé A không được cờ / chặn hoá đơn chỉ chứa khoản của bé B — ở CẢ màn lẫn bước chốt.
describe.skipIf(!RUN_DB_TESTS)("[HDHDB-11..14] đơn 2 bé — hoàn bé A chỉ ảnh hưởng hoá đơn chứa khoản bé A", () => {
  async function haiBe() {
    await dungFixture();
    await db.student.create({ data: { id: HS_B, name: "Bé Bình HDH" } });
    await db.enrollment.create({ data: { id: GD_B, studentId: HS_B, classId: LOP, courseId: KHOA, finalPrice: 9_000_000 } });
    await db.orderItem.update({ where: { id: OI }, data: { enrollmentId: GD } });
    await db.orderItem.create({
      data: { id: OI_B, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 5 — Bé Bình", quantity: 1, unitPrice: 9_000_000, totalPrice: 9_000_000, enrollmentId: GD_B },
    });
    await db.payment.update({ where: { id: P1 }, data: { orderItemId: OI } });
    await khoan(P_B, DON, GD_B);
    await db.payment.update({ where: { id: P_B }, data: { orderItemId: OI_B, paidDate: new Date("2699-09-22T03:00:00Z") } });
  }
  beforeEach(haiBe);
  afterAll(don);

  const taoNhapCho = (ids: string[]) =>
    taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: DON,
      centerId: CS,
      lanThuKey: `khoan:${ids.join("+")}`,
      khoan: ids.map((id) => ({ id, soTien: 3_000_000 })),
      loai: {
        trangThai: "NHAP",
        phapNhan: PHAP_NHAN,
        so: { kyHieu: "1C99TSR", soHoaDon: String(800 + ++dem), ngayPhatHanh: new Date("2699-09-21T00:00:00Z") },
        guiEmailKhach: false,
        pdf: { khoa: `hoa-don/HDH/${DON}/b${dem}.pdf`, ten: `hd-b${dem}.pdf`, co: 1000, sha256: `sha-hdh-b${dem}` },
        xml: null,
        theoSoDaThu: null,
        tienTha: 0,
      },
    });
  const dongHd = async (id: string) => (await dongCuaDon({ canViewPii: true, orderId: DON })).find((d) => d.hoaDon?.id === id)!;

  it("[HDHDB-11] hoàn bé A CHỜ (theo dòng đơn) ⇒ nháp bé B: nút KHÔNG tắt vì hoàn, chốt ĐƯỢC; nháp bé A: tắt + chốt từ chối", async () => {
    await hoan({ orderItemId: OI }, "PENDING");
    const b = await taoNhapCho([P_B]);
    const dongB = await dongHd(b.id);
    expect(dongB.hanhDong.xacNhan.lyDo).not.toBe(CAU_HOAN_CHAN_XAC_NHAN);
    expect(dongB.hanhDong.canhBao).not.toContain(CAU_HOAN_CHAN_XAC_NHAN);
    expect(await maLoi(chot(b.id))).toBeNull();
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: b.id } })).trangThai).toBe("DA_XAC_NHAN");

    const a = await taoNhapCho([P1]);
    expect((await dongHd(a.id)).hanhDong.xacNhan).toEqual({ bat: false, lyDo: CAU_HOAN_CHAN_XAC_NHAN });
    expect(await maLoi(chot(a.id))).toBe("CO_YEU_CAU_HOAN");
    await khongGhiGi(a.id);
  });

  it("[HDHDB-12] đã xác nhận + hoàn bé A ĐÃ DUYỆT sau mốc (theo ghi danh) ⇒ hoá đơn bé A 'can-dieu-chinh', bé B 'da-xuat'", async () => {
    const a = await taoNhapCho([P1]);
    await chot(a.id);
    const b = await taoNhapCho([P_B]);
    await chot(b.id);
    await hoan({ enrollmentId: GD }, "APPROVED", SAU);
    expect((await dongHd(a.id)).ngan).toBe("can-dieu-chinh");
    const dongB = await dongHd(b.id);
    expect(dongB.ngan).toBe("da-xuat");
    expect(dongB.canDieuChinh).toEqual([]);
  });

  it("[HDHDB-13] hoá đơn GỘP cả hai bé ⇒ hoàn bé A chặn chốt; sau khi chốt (hoàn bị từ chối rồi duyệt lại) ⇒ cần điều chỉnh", async () => {
    const r = await hoan({ orderItemId: OI }, "PENDING");
    const g = await taoNhapCho([P1, P_B]);
    expect(await maLoi(chot(g.id))).toBe("CO_YEU_CAU_HOAN");
    await khongGhiGi(g.id);
    await db.refundRequest.update({ where: { id: r.id }, data: { status: "REJECTED" } });
    expect(await maLoi(chot(g.id))).toBeNull();
    await db.refundRequest.update({ where: { id: r.id }, data: { status: "APPROVED", approvedAt: SAU } });
    expect((await dongHd(g.id)).ngan).toBe("can-dieu-chinh");
  });

  it("[HDHDB-14] yêu cầu MƠ HỒ (dòng đơn không ghi danh, khoản bé B không móc dòng đơn — không so được) ⇒ theo cả đơn: chặn cả hoá đơn bé B", async () => {
    await db.orderItem.update({ where: { id: OI }, data: { enrollmentId: null } });
    await db.payment.update({ where: { id: P_B }, data: { orderItemId: null } });
    await hoan({ orderItemId: OI }, "PENDING");
    const b = await taoNhapCho([P_B]);
    expect((await dongHd(b.id)).hanhDong.xacNhan).toEqual({ bat: false, lyDo: CAU_HOAN_CHAN_XAC_NHAN });
    expect(await maLoi(chot(b.id))).toBe("CO_YEU_CAU_HOAN");
  });
});
