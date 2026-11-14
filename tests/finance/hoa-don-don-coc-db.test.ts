// tests/finance/hoa-don-don-coc-db.test.ts — [HDCOC-*] ĐƠN CỌC trên Postgres THẬT: hàng chờ hoá đơn giữ cả đơn khi chưa trả đủ, và gộp cọc + phần còn lại
// thành MỘT dòng khi trả đủ (chủ dự án chốt 08/11/2026: «tự động gộp đơn cọc + khoản thu còn lại thành 1, tránh kế toán quên tick gộp»).
//
// Đi qua ĐƯỜNG THẬT: nhật ký cọc `THU_TRUOC_TAO` + phiếu đợt + phân bổ + giao dịch ngân hàng → `docDonCoc` (client trần) → `napHangChoHoaDon` → dòng. Test thuần
// (`dong-hang-cho.test.ts` [DHC-60..63]) cấp `coc` bằng tay; ca này chứng minh LOADER cấp đúng thứ đó (luật 9 — cổng phải được cho ăn bằng thứ đường thật cho nó ăn).
//   A  cọc 3tr đã vào, phần còn lại 2tr chưa đóng  ⇒ MỘT dòng (cọc), mang cờ `cocChuaTraDu` (hai bộ chọn tự động PHẢI giữ)
//   B  cọc 3tr + phần còn lại 2tr đã vào, đơn trả đủ ⇒ MỘT dòng GỘP 5tr, `cocChuaTraDu = false`
//   C  cùng hình dạng B nhưng KHÔNG có nhật ký cọc    ⇒ vẫn HAI dòng, không cờ (gộp tự động chỉ dành cho đơn cọc)
// Chạy: `pnpm test:finance-db`. KHÔNG `resetDb()`.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => ({
  ...(await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>()),
  khoHoaDonDaCauHinh: () => true,
}));

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { SALE_STATUS_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { gatewayMarker } from "@/lib/finance/payment-markers";
import { HANH_DONG_THU_TRUOC_TAO } from "@/lib/finance/doanh-thu-coc";
import { napHangChoHoaDon } from "@/lib/finance/hoa-don/hang-cho";
import { taoHoaDonChoLanThu } from "@/lib/finance/hoa-don/ghi-hoa-don";

if (!RUN_DB_TESTS) console.warn(`[HDCOC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hdcoc-";
const CS = `${T}cs`;
const KHOA_HOC = `${T}khoa`;
const LOP = `${T}lop`;
const HS = `${T}hs`;
const GD = `${T}gd`;
const ORD = { A: `${T}don-a`, B: `${T}don-b`, C: `${T}don-c` } as const;
const DA_GHI = SALE_STATUS_DA_GHI_NHAN[0]!;
const SIEU: Actor = {
  userId: `${T}kt`,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [CS],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
};
const TRA_DU = new Date("2699-09-20T03:00:00Z");
const KT = { id: `${T}kt`, name: "Kế toán fixture" };
const PHAP_NHAN = { ma: "SATA_ROBO", ten: "Công ty CP Sata Robo", maSoThue: "0402301783", diaChi: "Đà Nẵng", bat: true };

async function don() {
  const ids = Object.values(ORD);
  const hd = await db.hoaDonDienTu.findMany({ where: { orderId: { in: ids } }, select: { id: true } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { contains: T } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: hd.map((h) => h.id) } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await db.paymentAllocation.deleteMany({ where: { paymentRequest: { orderId: { in: ids } } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: ids } } });
  await db.bankTransaction.deleteMany({ where: { id: { startsWith: T } } });
  await db.payment.deleteMany({ where: { orderId: { in: ids } } });
  await db.order.deleteMany({ where: { id: { in: ids } } });
  await db.enrollment.deleteMany({ where: { id: GD } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA_HOC } });
  await db.student.deleteMany({ where: { id: HS } });
  await db.center.deleteMany({ where: { id: CS } });
}

/** Một đơn 5tr: đợt 1 (3tr) đã đóng; đợt 2 (2tr) đã đóng khi `traDu`. `coNhatKyCoc` = đơn do nút «Thu trước (cọc)» tạo. */
async function dungDon(k: keyof typeof ORD, o: { traDu: boolean; coNhatKyCoc: boolean }) {
  const orderId = ORD[k];
  await db.order.create({
    data: {
      id: orderId,
      code: `ORD-269929-0006${k.charCodeAt(0) - 64}0`,
      type: "COURSE",
      status: o.traDu ? "CONFIRMED" : "PENDING_PAYMENT",
      paidAt: o.traDu ? TRA_DU : null,
      customerName: "PH HDCOC",
      customerPhone: "0999000666",
      totalAmount: 5_000_000,
      centerId: CS,
    },
  });
  const dot1 = `${T}${k}-dot1`;
  const dot2 = `${T}${k}-dot2`;
  await db.paymentRequest.create({ data: { id: dot1, orderId, installmentNo: 1, amountDue: 3_000_000, status: "PAID", sortOrder: 1, centerId: CS } });
  await db.paymentRequest.create({
    data: { id: dot2, orderId, installmentNo: 2, amountDue: 2_000_000, status: o.traDu ? "PAID" : "PENDING", sortOrder: 2, centerId: CS },
  });
  const gd = async (so: 1 | 2, amount: number, ngay: string, dot: string) => {
    const bt = `${T}${k}-bt${so}`;
    const txn = `${T}${k}-txn${so}`;
    await db.bankTransaction.create({
      data: { id: bt, provider: "SEPAY", providerTxnId: txn, amount, transferredAt: new Date(`${ngay}T10:00:00Z`), status: "MATCHED", centerId: CS },
    });
    await db.paymentAllocation.create({ data: { bankTransactionId: bt, paymentRequestId: dot, amount, roundingWaived: 0, centerId: CS } });
    await db.payment.create({
      data: {
        id: `${T}${k}-p${so}`,
        orderId,
        amount,
        method: "BANK_TRANSFER",
        note: gatewayMarker("SEPAY", txn),
        paidDate: new Date(`${ngay}T03:00:00Z`),
        saleStatus: DA_GHI,
        accountantStatus: "CONFIRMED",
        enrollmentId: GD,
        centerId: CS,
      },
    });
  };
  await gd(1, 3_000_000, "2699-09-10", dot1);
  if (o.traDu) await gd(2, 2_000_000, "2699-09-20", dot2);
  if (o.coNhatKyCoc) {
    await db.auditLog.create({
      data: { module: "orders", entityType: "Order", entityId: orderId, action: HANH_DONG_THU_TRUOC_TAO, newValues: { soTien: 3_000_000 }, actorName: "Sale fixture" },
    });
  }
}

const dongCuaDon = async (orderId: string) => (await napHangChoHoaDon(SIEU, { canViewPii: true, orderId })).dong.filter((d) => d.orderId === orderId);

beforeAll(async () => {
  if (!RUN_DB_TESTS) return;
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở fixture HDCOC", slug: `${T}co-so`, address: "114 Hoàng Diệu" } });
  await db.course.create({ data: { id: KHOA_HOC, name: "Sata 5 fixture", slug: `${T}sata-5` } });
  await db.class.create({ data: { id: LOP, name: "Lớp fixture HDCOC", courseId: KHOA_HOC } });
  await db.student.create({ data: { id: HS, name: "Bé Cọc HDCOC" } });
  await db.enrollment.create({ data: { id: GD, studentId: HS, classId: LOP, courseId: KHOA_HOC, finalPrice: 5_000_000 } });
  await dungDon("A", { traDu: false, coNhatKyCoc: true });
  await dungDon("B", { traDu: true, coNhatKyCoc: true });
  await dungDon("C", { traDu: true, coNhatKyCoc: false });
});
afterAll(async () => {
  if (RUN_DB_TESTS) await don();
});

describe.skipIf(!RUN_DB_TESTS)("[HDCOC] hàng chờ hoá đơn — đơn cọc (Postgres thật)", () => {
  it("[HDCOC-01] A: cọc đã vào, phần còn lại chưa đóng ⇒ MỘT dòng mang cờ `cocChuaTraDu` (bộ chọn tự động giữ)", async () => {
    const dong = await dongCuaDon(ORD.A);
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({ soTien: 3_000_000, cocChuaTraDu: true });
  });

  it("[HDCOC-02] B: cọc + phần còn lại, đơn trả đủ ⇒ MỘT dòng GỘP 5tr, không cờ giữ, đủ cả hai khoản", async () => {
    const dong = await dongCuaDon(ORD.B);
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({ ngan: "cho", soTien: 5_000_000, cocChuaTraDu: false });
    expect(dong[0]!.key.startsWith("gop:")).toBe(true);
    expect([...dong[0]!.khoanIds].sort()).toEqual([`${T}B-p1`, `${T}B-p2`]);
  });

  it("[HDCOC-04] đường PHÁT HÀNH nhận dòng tự gộp: lưu nháp trên dòng `gop:…` của đơn B ghi ĐỦ HoaDonKhoan của cả cọc + phần còn lại (cùng hàm bộ chọn tự động gọi)", async () => {
    const [row] = await dongCuaDon(ORD.B);
    expect(row!.gopTuDongDonCoc).toBe(true);
    const r = await taoHoaDonChoLanThu({
      nguoiGhi: KT,
      orderId: ORD.B,
      centerId: CS,
      lanThuKey: row!.key,
      khoan: row!.khoan,
      loai: {
        trangThai: "NHAP",
        phapNhan: PHAP_NHAN,
        so: { kyHieu: "1C99TSR", soHoaDon: "901", ngayPhatHanh: new Date("2699-09-21T00:00:00Z") },
        guiEmailKhach: false,
        pdf: { khoa: `hoa-don/HDCOC/${ORD.B}/1.pdf`, ten: "hd-1.pdf", co: 1000, sha256: "sha-hdcoc-1" },
        xml: null,
        theoSoDaThu: null,
        tienTha: row!.tienTha,
        xacMinhSo: "KHONG_CAN",
        xmlTrangThai: "KHONG_CO",
        ngoaiLeKyHieu: null,
      },
    });
    expect(r.id).toBeTruthy();
    const hd = await db.hoaDonDienTu.findMany({ where: { orderId: ORD.B }, select: { khoan: { select: { paymentId: true } } } });
    expect(hd).toHaveLength(1);
    expect(hd[0]!.khoan.map((k) => k.paymentId).sort()).toEqual([`${T}B-p1`, `${T}B-p2`]);
  });

  it("[HDCOC-03] C: cùng hình dạng nhưng KHÔNG có nhật ký cọc ⇒ vẫn HAI dòng, không cờ (gộp tự động chỉ dành cho đơn cọc)", async () => {
    const dong = await dongCuaDon(ORD.C);
    expect(dong).toHaveLength(2);
    expect(dong.every((d) => d.cocChuaTraDu === false)).toBe(true);
  });
});
