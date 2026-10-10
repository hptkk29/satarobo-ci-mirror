// Ca [HDCK-*] — NGHI TRÙNG theo GIAO DỊCH CHƯA KHỚP cùng SĐT (PLAN GĐ 8 mục 13a) trên Postgres THẬT.
//
// Khoản KHAI TAY (lời khai theo đợt, không có giao dịch ngân hàng nào đứng sau) mà ngân hàng đang có một giao
// dịch UNMATCHED cùng SỐ TIỀN mang SĐT của đơn trong nội dung CK ⇒ rất có thể là CÙNG một khoản tiền (khách
// chuyển khoản, sale lại khai tay) ⇒ NGHI_TRUNG. Hai tầng, cùng một luật bóc (`chuaKhopTheoSdt`):
//   · loader màn (`napHangChoHoaDon`) — đo xem vế này ĐÃ SỐNG thật (nạp giao dịch UNMATCHED, bóc SĐT, khớp
//     SĐT của đơn) chứ không chỉ có trong hàm thuần;
//   · bước chốt (`chotHoaDon`) — kiểm LẠI trong transaction, TRƯỚC phép ghi đầu tiên (trước 29/09 truyền `[]`).
// Đối chứng: khác số tiền / khác SĐT / giao dịch giả BACKFILL / đã ghi "không trùng" ⇒ không nghi.
//
// Mốc tuyệt đối (luật 19). Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
}));

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { SALE_STATUS_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { installmentMarker } from "@/lib/finance/payment-markers";
import { chotHoaDon, LoiChotHoaDon } from "@/lib/finance/hoa-don/chot-hoa-don";
import { napHangChoHoaDon } from "@/lib/finance/hoa-don/hang-cho";

if (!RUN_DB_TESTS) console.warn(`[HDCK] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hdck-";
const CS = `${T}center`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HS = `${T}hs`;
const GD = `${T}gd`;
const DON = `${T}don`;
const HD = `${T}hd`;
const P_KHAI = `${T}p-khai`;
const BT = `${T}bt`;
const KT = { id: `${T}ke-toan`, name: "Kế toán fixture" };
const SALE = `${T}sale`;
const SDT = "0911222777";
const NOW = new Date("2699-09-26T08:00:00Z");
/** Giá trị `saleStatus` "đã ghi nhận" — đọc từ hằng của trục B, không gõ literal. */
const DA_GHI = SALE_STATUS_DA_GHI_NHAN[0]!;

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

async function don() {
  await db.hoaDonDienTu.deleteMany({ where: { orderId: DON } });
  await db.receipt.deleteMany({ where: { paymentId: { startsWith: T } } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.enrollment.deleteMany({ where: { id: GD } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HS } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dungFixture() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture HDCK", slug: `${T}co-so`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 5 fixture", slug: `${T}sata-5` } });
  await db.class.create({ data: { id: LOP, name: "Lớp fixture HDCK", courseId: KHOA } });
  await db.student.create({ data: { id: HS, name: "Bé HDCK" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA, finalPrice: 9_000_000 } });
  await db.order.create({
    data: {
      id: DON,
      code: "ORD-269926-000701",
      type: "COURSE",
      status: "CONFIRMED",
      customerName: "PH HDCK",
      customerPhone: SDT,
      customerAddress: "12 Lê Lợi",
      customerCity: "Đà Nẵng",
      totalAmount: 9_000_000,
      centerId: CS,
    },
  });
  // Khoản KHAI TAY theo đợt — không giao dịch ngân hàng nào đứng sau, đơn không có khoản chuyển khoản nào
  // ⇒ vế "đơn có chuyển khoản" KHÔNG bắn; chỉ còn vế giao dịch chưa khớp.
  await db.payment.create({
    data: {
      id: P_KHAI,
      orderId: DON,
      amount: 3_000_000,
      method: "auto",
      note: installmentMarker(1),
      paidDate: new Date("2699-09-19T03:00:00Z"),
      saleStatus: DA_GHI,
      accountantStatus: "PENDING",
      enrollmentId: GD,
      recordedById: SALE,
      centerId: CS,
    },
  });
}

/** Giao dịch ngân hàng CHƯA KHỚP (chưa về cơ sở nào — đúng hình dạng tiền vừa về). */
const chuaKhop = (o: Partial<{ amount: number; content: string; provider: string; centerId: string | null }> = {}) =>
  db.bankTransaction.create({
    data: {
      id: BT,
      provider: o.provider ?? "SEPAY",
      providerTxnId: `${T}txn`,
      amount: o.amount ?? 3_000_000,
      transferredAt: new Date("2699-09-19T05:00:00Z"),
      content: o.content ?? `NGUYEN VAN A ${SDT} HOC PHI`,
      status: "UNMATCHED",
      centerId: o.centerId === undefined ? null : o.centerId,
    },
  });

const nhap = (khongTrungLyDo: string | null = null) =>
  db.hoaDonDienTu.create({
    data: {
      id: HD,
      orderId: DON,
      centerId: CS,
      trangThai: "NHAP",
      kyHieu: "1C26TSR",
      soHoaDon: "951",
      ngayPhatHanh: new Date("2026-09-20T00:00:00Z"),
      tepPdfKey: `hoa-don/CS1/2026/${DON}/u.pdf`,
      tepPdfTen: "hd.pdf",
      guiEmailKhach: false,
      tongTien: 3_000_000,
      taoBoiId: KT.id,
      ...(khongTrungLyDo ? { khongTrungLyDo, khongTrungBoiId: KT.id, khongTrungLuc: NOW } : {}),
      khoan: { create: [{ paymentId: P_KHAI, soTien: 3_000_000 }] },
    },
  });

async function chot() {
  const hd = await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD }, select: { updatedAt: true } });
  return chotHoaDon({ nguoiChot: KT, actor: KT_CS, orderId: DON, hoaDonId: HD, now: NOW, phienBan: hd.updatedAt, emailDuKien: null });
}

async function maLoi(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiChotHoaDon ? e.ma : String(e);
  }
}

const dongCuaDon = async () => (await napHangChoHoaDon(SIEU, { canViewPii: true, orderId: DON })).dong.filter((d) => d.orderId === DON);

describe.skipIf(!RUN_DB_TESTS)("[HDCK-01..02] loader màn — vế giao dịch chưa khớp ĐÃ SỐNG", () => {
  beforeEach(dungFixture);
  afterAll(don);

  it("[HDCK-01] khai tay 3.000.000đ + giao dịch UNMATCHED 3.000.000đ mang SĐT đơn ⇒ dòng 'Nghi trùng', lý do nói giao dịch chưa khớp", async () => {
    // Đối chứng trước: chưa có giao dịch ⇒ khai tay bình thường.
    expect((await dongCuaDon()).map((d) => [d.ngan, d.nhan])).toEqual([["cho", "Khai tay"]]);
    await chuaKhop();
    const [d] = await dongCuaDon();
    expect([d!.ngan, d!.nhan]).toEqual(["lech", "Nghi trùng"]);
    expect(d!.hanhDong.xacNhan.lyDo).toMatch(/giao dịch chưa khớp cùng số tiền/);
  });

  it("[HDCK-02] đối chứng: khác số tiền / khác SĐT / giao dịch giả BACKFILL ⇒ KHÔNG nghi", async () => {
    for (const o of [
      { amount: 2_999_000 },
      { content: "NGUYEN VAN A 0911222778 HOC PHI" },
      { provider: "BACKFILL" },
    ]) {
      await db.bankTransaction.deleteMany({ where: { id: BT } });
      await chuaKhop(o);
      expect((await dongCuaDon()).map((d) => [d.ngan, d.nhan]), JSON.stringify(o)).toEqual([["cho", "Khai tay"]]);
    }
  });
});

describe.skipIf(!RUN_DB_TESTS)("[HDCK-03..05] bước chốt — kiểm LẠI trong transaction", () => {
  beforeEach(dungFixture);
  afterAll(don);

  const khongGhiGi = async () => {
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("NHAP");
    expect((await db.payment.findUniqueOrThrow({ where: { id: P_KHAI } })).accountantStatus).toBe("PENDING");
    expect(await db.receipt.count({ where: { paymentId: P_KHAI } })).toBe(0);
  };

  it("[HDCK-03] bản nháp giữ khoản khai tay; giao dịch chưa khớp cùng SĐT + cùng số xuất hiện SAU khi lưu nháp ⇒ NGHI_TRUNG, KHÔNG ghi gì", async () => {
    await nhap();
    await chuaKhop();
    expect(await maLoi(chot())).toBe("NGHI_TRUNG");
    await khongGhiGi();
  });

  it("[HDCK-04] đối chứng: khác số tiền / khác SĐT / BACKFILL ⇒ chốt được", async () => {
    for (const o of [{ amount: 2_999_000 }, { content: "CK 0911222778" }, { provider: "BACKFILL" }]) {
      await don();
      await dungFixture();
      await nhap();
      await chuaKhop(o);
      expect(await maLoi(chot()), JSON.stringify(o)).toBeNull();
      expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
    }
  });

  it("[HDCK-05] kế toán đã ghi 'Không trùng — vẫn xuất' ⇒ chốt được dù giao dịch còn đó", async () => {
    await nhap("Đối chiếu sao kê: giao dịch kia là của đơn khác");
    await chuaKhop();
    expect(await maLoi(chot())).toBeNull();
    expect((await db.hoaDonDienTu.findUniqueOrThrow({ where: { id: HD } })).trangThai).toBe("DA_XAC_NHAN");
  });
});
