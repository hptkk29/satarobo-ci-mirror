// Ca [HDL-*] — bộ lọc cơ sở + tháng của màn Hoá đơn điện tử, đo CÂU TRA trên Postgres THẬT.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §10. Test thuần `lib/finance/hoa-don/loc-hang-cho.test.ts`
// ([LHC-04]) đã khoá "câu tra ⇔ phép lọc dòng" bằng một bộ chấm tự viết — bộ chấm ấy KHÔNG phải
// Postgres. Thứ chỉ DB trả lời được:
//   · cột `ngayPhatHanh` là `@db.Date` còn `xacNhanLuc`/`createdAt` là timestamptz — biên tháng của hai
//     kiểu cột khác nhau 7 giờ;
//   · lọc lồng qua quan hệ (`khoan.payment.adjustments`, `status` đơn) ra đúng tập đơn;
//   · việc tồn (khoản chờ, nháp, cần điều chỉnh) KHÔNG bị cắt theo tháng.
//
// Bộ này KHÔNG gọi `resetDb()`: fixture tự dựng, tự dọn theo tiền tố id. Năm 2699 — không đụng dữ
// liệu nào có thật.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dieuKienDonHangCho } from "@/lib/finance/hoa-don/loc-hang-cho";

if (!RUN_DB_TESTS) console.warn(`[HDL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-hdl-";
const CS = `${T}center`;
const CS2 = `${T}center2`;
const NGUOI = `${T}ke-toan`;

const DON = {
  thang8: `${T}thang8`, // đã xác nhận, ngày phát hành 31/08
  thang9Luc: `${T}thang9-luc`, // đã xác nhận, KHÔNG ngày phát hành, xác nhận 00:30 ngày 01/09 giờ VN
  khongXuat10: `${T}kx10`, // không xuất, đánh dấu 00:00 ngày 01/10 giờ VN
  nhap: `${T}nhap`, // nháp (tháng nào cũng phải thấy)
  huy: `${T}huy`, // đơn huỷ, còn bản đã xác nhận tháng 1 ⇒ cần điều chỉnh
  dieuChinh: `${T}dieu-chinh`, // bản đã xác nhận tháng 1, khoản bị điều chỉnh ⇒ cần điều chỉnh
  cu: `${T}cu`, // bản đã xác nhận tháng 1, không đổi gì ⇒ CHỈ thấy khi lọc tháng 1
  cho: `${T}cho`, // khoản chờ, chưa hoá đơn
  choCs2: `${T}cho-cs2`, // khoản chờ ở CS2
} as const;
const TAT_CA = Object.values(DON);

async function don() {
  await db.hoaDonKhoan.deleteMany({ where: { hoaDon: { orderId: { in: TAT_CA } } } });
  await db.hoaDonDienTu.deleteMany({ where: { orderId: { in: TAT_CA } } });
  // Dòng điều chỉnh trỏ về dòng gốc — xoá trước.
  await db.payment.deleteMany({ where: { orderId: { in: TAT_CA }, adjustmentOfId: { not: null } } });
  await db.payment.deleteMany({ where: { orderId: { in: TAT_CA } } });
  await db.order.deleteMany({ where: { id: { in: TAT_CA } } });
  await db.center.deleteMany({ where: { id: { in: [CS, CS2] } } });
}

async function dungFixture() {
  await don();
  for (const id of [CS, CS2]) {
    await db.center.create({ data: { id, name: `HDL ${id}`, slug: `${id}-slug`, address: "không có thật" } });
  }
  let n = 0;
  for (const id of TAT_CA) {
    n += 1;
    await db.order.create({
      data: {
        id,
        code: `ORD-269928-${String(n).padStart(6, "0")}`,
        type: "COURSE",
        status: id === DON.huy ? "CANCELLED" : "CONFIRMED",
        customerName: "HDL phụ huynh",
        customerPhone: "0999000555",
        totalAmount: 1_000_000,
        centerId: id === DON.choCs2 ? CS2 : CS,
      },
    });
  }
  const khoan = (id: string, orderId: string, o: { amount?: number; paymentType?: "PAYMENT" | "ADJUSTMENT"; adjustmentOfId?: string } = {}) =>
    db.payment.create({
      data: {
        id,
        orderId,
        amount: o.amount ?? 1_000_000,
        method: "BANK_TRANSFER",
        paidDate: new Date("2699-01-10T03:00:00Z"),
        paymentType: o.paymentType ?? "PAYMENT",
        adjustmentOfId: o.adjustmentOfId ?? null,
        centerId: orderId === DON.choCs2 ? CS2 : CS,
      },
    });
  let so = 100;
  const hoaDon = (
    orderId: string,
    o: { trangThai: "NHAP" | "DA_XAC_NHAN" | "KHONG_XUAT"; ngayPhatHanh?: Date | null; xacNhanLuc?: Date | null; createdAt?: Date; paymentId?: string },
  ) => {
    so += 1;
    return db.hoaDonDienTu.create({
      data: {
        orderId,
        centerId: CS,
        trangThai: o.trangThai,
        kyHieu: o.trangThai === "KHONG_XUAT" ? null : "1C99HDL",
        soHoaDon: o.trangThai === "KHONG_XUAT" ? null : String(so),
        ngayPhatHanh: o.ngayPhatHanh ?? null,
        xacNhanLuc: o.xacNhanLuc ?? null,
        lyDo: o.trangThai === "KHONG_XUAT" ? "Khách không lấy hoá đơn" : null,
        tongTien: 1_000_000,
        taoBoiId: NGUOI,
        ...(o.createdAt ? { createdAt: o.createdAt } : {}),
        ...(o.paymentId ? { khoan: { create: [{ paymentId: o.paymentId, soTien: 1_000_000 }] } } : {}),
      },
    });
  };

  await hoaDon(DON.thang8, { trangThai: "DA_XAC_NHAN", ngayPhatHanh: new Date("2699-08-31T00:00:00Z"), xacNhanLuc: new Date("2699-09-02T02:00:00Z") });
  await hoaDon(DON.thang9Luc, { trangThai: "DA_XAC_NHAN", xacNhanLuc: new Date("2699-08-31T17:30:00Z") });
  await hoaDon(DON.khongXuat10, { trangThai: "KHONG_XUAT", createdAt: new Date("2699-09-30T17:00:00Z") });
  await hoaDon(DON.nhap, { trangThai: "NHAP", ngayPhatHanh: new Date("2699-01-15T00:00:00Z") });
  await hoaDon(DON.huy, { trangThai: "DA_XAC_NHAN", ngayPhatHanh: new Date("2699-01-15T00:00:00Z") });

  await khoan(`${T}p-goc`, DON.dieuChinh);
  await khoan(`${T}p-dc`, DON.dieuChinh, { amount: -200_000, paymentType: "ADJUSTMENT", adjustmentOfId: `${T}p-goc` });
  await hoaDon(DON.dieuChinh, { trangThai: "DA_XAC_NHAN", ngayPhatHanh: new Date("2699-01-15T00:00:00Z"), paymentId: `${T}p-goc` });

  await khoan(`${T}p-cu`, DON.cu);
  await hoaDon(DON.cu, { trangThai: "DA_XAC_NHAN", ngayPhatHanh: new Date("2699-01-15T00:00:00Z"), paymentId: `${T}p-cu` });

  await khoan(`${T}p-cho`, DON.cho);
  await khoan(`${T}p-cho-cs2`, DON.choCs2);
}

const tra = async (boLoc: Parameters<typeof dieuKienDonHangCho>[0]) =>
  (
    await db.order.findMany({
      where: { id: { in: TAT_CA }, ...dieuKienDonHangCho(boLoc) },
      select: { id: true },
    })
  )
    .map((d) => d.id)
    .sort();
const tap = (...ids: string[]) => [...ids].sort();
const VIEC_TON = [DON.nhap, DON.huy, DON.dieuChinh, DON.cho, DON.choCs2];

describe.skipIf(!RUN_DB_TESTS)("[HDL] câu tra màn hoá đơn — cơ sở + tháng trên Postgres thật", () => {
  beforeAll(dungFixture);
  afterAll(don);

  it("[HDL-01] tháng 9: bản xác nhận KHÔNG ngày phát hành theo lúc xác nhận giờ VN (00:30 01/09) ⇒ có; 31/08 ⇒ không", async () => {
    expect(await tra({ coSo: null, thang: "2699-09" })).toEqual(tap(DON.thang9Luc, ...VIEC_TON));
  });

  it("[HDL-02] tháng 8: ngày phát hành 31/08 (cột @db.Date) ⇒ có; bản xác nhận 00:30 01/09 VN ⇒ không", async () => {
    expect(await tra({ coSo: null, thang: "2699-08" })).toEqual(tap(DON.thang8, ...VIEC_TON));
  });

  it("[HDL-03] không xuất đánh dấu 00:00 01/10 giờ VN (17:00Z 30/09) ⇒ thuộc tháng 10, không thuộc tháng 9", async () => {
    expect(await tra({ coSo: null, thang: "2699-10" })).toEqual(tap(DON.khongXuat10, ...VIEC_TON));
  });

  it("[HDL-04] việc tồn (nháp · đơn huỷ còn bản xác nhận · khoản bị điều chỉnh · khoản chờ) có mặt ở MỌI tháng; bản cũ không đổi gì thì chỉ ở tháng của nó", async () => {
    const t1 = await tra({ coSo: null, thang: "2699-01" });
    expect(t1).toEqual(tap(DON.cu, ...VIEC_TON));
    expect(await tra({ coSo: null, thang: "2699-05" })).toEqual(tap(...VIEC_TON));
  });

  it("[HDL-05] lọc cơ sở ⇒ chỉ đơn của cơ sở đó", async () => {
    expect(await tra({ coSo: CS2, thang: "2699-09" })).toEqual([DON.choCs2]);
  });

  it("[HDL-06] đối chứng: không bộ lọc (đường thu hẹp theo đơn) ⇒ mọi đơn còn khoản ứng viên hoặc hoá đơn hiệu lực", async () => {
    expect(await tra(null)).toEqual(tap(...TAT_CA));
  });
});
