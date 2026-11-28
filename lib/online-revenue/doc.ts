// lib/online-revenue/doc.ts — ĐỌC DB cho báo cáo doanh thu E-learning Online (Workstream A → màn «QoThongKe» của E). CHỈ ĐỌC, không ghi gì.
//
// KHÔNG có engine thanh toán / nguồn doanh thu thứ hai: mọi con số đọc từ `Payment` (sổ thu — nguồn tiền DUY NHẤT), `Order`/`OrderItem`,
// `OrderOnlineGrant`, `VoucherRedemption`, `RefundRequest`. Tập "đã ghi nhận" = `KHOAN_DA_GHI_NHAN` (lib/finance/ghi-nhan.ts) — tái dùng nguyên.
// Chống đếm trùng: đếm theo DÒNG `Payment` (mỗi giao dịch ngân hàng ra đúng một dòng nhờ idempotency của `ingestPayosWebhook`); KHÔNG đọc `BankTransaction`
// (webhook gửi lại, một giao dịch có thể có nhiều bản ghi thô). Trường hợp hai dòng Payment cùng mã giao dịch vẫn lọt ⇒ phát hiện ở `canhBao.maGiaoDichTrung`, KHÔNG tự loại.
import type { Prisma, PrismaClient } from "@prisma/client";

import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { nguonGiaoDich } from "@/lib/finance/hoa-don/nguon-khoan";
import { khoaKy, lietKeKy, type KhoangNgay, type NhomThoiGian } from "./thoi-gian";
import { KHOA_KHAC, khoaCuaDong, laDonHieuLuc, tongHopDon, soTienRong, tongHopTien, type DonTho, type SoTienTho } from "./tinh";

type Db = PrismaClient;

/** Trần số dòng nạp vào bộ nhớ — vượt thì từ chối (422), KHÔNG cắt lặng lẽ (cắt lặng lẽ = con số sai mà trông đúng). */
export const TRAN_KHOAN = 20_000;
export const TRAN_DON = 20_000;
export const TRAN_QUYEN = 50_000;
const LO = 1000;

export class LoiDoanhThu extends Error {
  constructor(
    readonly ma: "CUA_SO_QUA_LON",
    message: string,
  ) {
    super(message);
    this.name = "LoiDoanhThu";
  }
}

export type ThamSoDoanhThu = { khoang: KhoangNgay; nhom: NhomThoiGian; khoaId: string | null };

const chia = <T,>(a: readonly T[], n: number): T[][] => {
  const ra: T[][] = [];
  for (let i = 0; i < a.length; i += n) ra.push(a.slice(i, i + n));
  return ra;
};

/** `where` cho Payment: tập "đã ghi nhận" + đơn ONLINE chưa xoá + (tuỳ chọn) đơn có dòng thuộc khoá + khoảng ngày thu. DÙNG CHUNG với phép đối soát. */
export function dieuKienKhoanOnline(khoang: KhoangNgay, khoaId: string | null): Prisma.PaymentWhereInput {
  return {
    ...KHOAN_DA_GHI_NHAN,
    paidDate: { gte: khoang.batDau, lt: khoang.ketThuc },
    order: { type: "ONLINE", deletedAt: null, ...(khoaId ? { items: { some: { type: "ONLINE_COURSE", onlineCourseId: khoaId } } } : {}) },
  };
}

const CHON_DON = { id: true, code: true, status: true, totalAmount: true, shippingFee: true, legalEntityId: true, createdAt: true, items: { select: { id: true, type: true, onlineCourseId: true, unitPrice: true, quantity: true, discountAmount: true } } } as const;

const rutTien = (a: SoTienTho) => ({ thu: a.thu, hoan: a.hoan, dieuChinh: a.dieuChinh, rong: a.rong });
const khoaRaNgoai = (k: string): string | null => (k === KHOA_KHAC ? null : k);

/** `gioiHan` chỉ để TEST hạ trần xuống (không có đường nào của route truyền nó) — mặc định là các hằng ở đầu tệp. */
export async function tinhDoanhThuOnline(db: Db, p: ThamSoDoanhThu, gioiHan: Partial<{ khoan: number; don: number; quyen: number }> = {}) {
  const { khoang, nhom, khoaId } = p;
  const tranKhoan = gioiHan.khoan ?? TRAN_KHOAN;
  const tranDon = gioiHan.don ?? TRAN_DON;
  const tranQuyen = gioiHan.quyen ?? TRAN_QUYEN;

  // ── 1. TRỤC TIỀN: dòng thu trong khoảng (theo ngày thu `paidDate`) ──
  const dongTien = await db.payment.findMany({
    where: dieuKienKhoanOnline(khoang, khoaId),
    orderBy: [{ paidDate: "asc" }, { id: "asc" }],
    take: tranKhoan + 1,
    select: { id: true, orderId: true, amount: true, paidDate: true, paymentType: true, accountantStatus: true, refundRequestId: true, note: true, deletedAt: true },
  });
  if (dongTien.length > tranKhoan) throw new LoiDoanhThu("CUA_SO_QUA_LON", `Khoảng này có hơn ${tranKhoan} khoản thu — thu hẹp khoảng ngày.`);

  // ── 2. TRỤC ĐƠN: đơn tạo trong khoảng (theo `createdAt`) ──
  const donTrongKhoang = await db.order.findMany({
    where: { type: "ONLINE", deletedAt: null, createdAt: { gte: khoang.batDau, lt: khoang.ketThuc }, ...(khoaId ? { items: { some: { type: "ONLINE_COURSE", onlineCourseId: khoaId } } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: tranDon + 1,
    select: CHON_DON,
  });
  if (donTrongKhoang.length > tranDon) throw new LoiDoanhThu("CUA_SO_QUA_LON", `Khoảng này có hơn ${tranDon} đơn — thu hẹp khoảng ngày.`);

  // ── 3. Đơn của các khoản thu (có thể tạo ngoài khoảng) + Σ không-hoàn mọi thời điểm của mọi đơn liên quan ──
  const donTheoId = new Map<string, DonTho>(donTrongKhoang.map((d) => [d.id, d]));
  const idCanThem = [...new Set(dongTien.map((x) => x.orderId))].filter((id) => !donTheoId.has(id));
  for (const lo of chia(idCanThem, LO)) for (const d of await db.order.findMany({ where: { id: { in: lo } }, select: CHON_DON })) donTheoId.set(d.id, d);
  const thuGopCaDon = new Map<string, number>();
  for (const lo of chia([...donTheoId.keys()], LO)) {
    const g = await db.payment.groupBy({ by: ["orderId"], where: { orderId: { in: lo }, ...KHOAN_DA_GHI_NHAN, AND: [{ accountantStatus: { not: "REFUNDED" } }] }, _sum: { amount: true } });
    for (const x of g) thuGopCaDon.set(x.orderId, x._sum.amount ?? 0);
  }

  // ── 4. Dòng hoàn → khoá của dòng đơn trong yêu cầu hoàn (chính xác, không chia tỉ lệ) ──
  const khoaCuaYeuCauHoan = new Map<string, string>();
  const idYeuCau = [...new Set(dongTien.map((x) => x.refundRequestId).filter((x): x is string => !!x))];
  for (const lo of chia(idYeuCau, LO)) {
    for (const y of await db.refundRequest.findMany({ where: { id: { in: lo } }, select: { id: true, orderItem: { select: { type: true, onlineCourseId: true } } } })) {
      if (y.orderItem) khoaCuaYeuCauHoan.set(y.id, khoaCuaDong(y.orderItem));
    }
  }

  const tien = tongHopTien({ dongTien, donTheoId, khoaCuaYeuCauHoan, locKhoa: khoaId, nhom });
  const don = tongHopDon({ don: donTrongKhoang, thuGopCaDon, locKhoa: khoaId, nhom });

  // ── 5. Quyền học THẬT: dòng cấp quyền GRANTED có `entitlementId`, theo ngày cấp ──
  const quyen = await db.orderOnlineGrant.findMany({
    where: { status: "GRANTED", entitlementId: { not: null }, grantedAt: { gte: khoang.batDau, lt: khoang.ketThuc }, ...(khoaId ? { courseId: khoaId } : {}) },
    take: tranQuyen + 1,
    select: { studentId: true, courseId: true, grantedAt: true },
  });
  if (quyen.length > tranQuyen) throw new LoiDoanhThu("CUA_SO_QUA_LON", `Khoảng này có hơn ${tranQuyen} lượt cấp quyền — thu hẹp khoảng ngày.`);
  const hocVienTong = new Set<string>();
  const hocVienTheoKhoa = new Map<string, Set<string>>();
  const quyenTheoKhoa = new Map<string, number>();
  const quyenTheoKy = new Map<string, number>();
  for (const q of quyen) {
    if (!q.grantedAt) continue;
    hocVienTong.add(q.studentId);
    (hocVienTheoKhoa.get(q.courseId) ?? hocVienTheoKhoa.set(q.courseId, new Set()).get(q.courseId)!).add(q.studentId);
    quyenTheoKhoa.set(q.courseId, (quyenTheoKhoa.get(q.courseId) ?? 0) + 1);
    const k = khoaKy(q.grantedAt, nhom);
    quyenTheoKy.set(k, (quyenTheoKy.get(k) ?? 0) + 1);
  }

  // ── 6. Giảm giá theo mã (đơn hiệu lực tạo trong khoảng) ──
  const locDonHieuLuc = { type: "ONLINE", deletedAt: null, status: { notIn: ["CANCELLED", "DRAFT"] }, createdAt: { gte: khoang.batDau, lt: khoang.ketThuc } } satisfies Prisma.OrderWhereInput;
  const theoMa = await db.voucherRedemption.groupBy({
    by: ["voucherId"],
    where: { order: locDonHieuLuc, ...(khoaId ? { orderItem: { type: "ONLINE_COURSE", onlineCourseId: khoaId } } : {}) },
    _sum: { discountApplied: true },
    _count: { _all: true },
  });
  const maGiam = new Map((await db.voucher.findMany({ where: { id: { in: theoMa.map((x) => x.voucherId) } }, select: { id: true, code: true, name: true } })).map((v) => [v.id, v]));
  const giamTheoMa = theoMa
    .map((x) => ({ ma: maGiam.get(x.voucherId)?.code ?? "(mã đã xoá)", ten: maGiam.get(x.voucherId)?.name ?? null, soLuot: x._count._all, soTienGiam: x._sum.discountApplied ?? 0 }))
    .sort((a, b) => b.soTienGiam - a.soTienGiam || (a.ma < b.ma ? -1 : 1))
    .slice(0, 50);
  const giamCoMa = theoMa.reduce((s, x) => s + (x._sum.discountApplied ?? 0), 0);

  // ── 7. Yêu cầu hoàn (đếm theo ngày TẠO yêu cầu) ──
  const yeuCauHoan = await db.refundRequest.groupBy({
    by: ["status"],
    where: { kenh: "ONLINE", createdAt: { gte: khoang.batDau, lt: khoang.ketThuc }, ...(khoaId ? { orderItem: { onlineCourseId: khoaId } } : {}) },
    _count: { _all: true },
    _sum: { approvedAmount: true },
  });
  const yc = (s: string) => yeuCauHoan.find((x) => x.status === s);

  // ── 8. Hoa hồng: KHÔNG hỗ trợ — dẫn chứng bằng số đo ──
  const butToanHoaHong = await db.commissionTransaction.count({ where: { order: { type: "ONLINE" } } });

  // ── 9. Tên khoá ──
  const khoaCan = new Set<string>([...tien.theoKhoa.keys(), ...don.theoKhoa.keys(), ...quyenTheoKhoa.keys()]);
  const tenKhoa = new Map((await db.onlCourse.findMany({ where: { id: { in: [...khoaCan].filter((k) => k !== KHOA_KHAC) } }, select: { id: true, code: true, name: true } })).map((c) => [c.id, c]));
  const tenPhapNhan = new Map((await db.legalEntity.findMany({ where: { id: { in: [...tien.theoPhapNhan.keys()].filter(Boolean) } }, select: { id: true, legalName: true } })).map((l) => [l.id, l.legalName]));

  const theoKhoa = [...khoaCan]
    .map((k) => {
      const t = tien.theoKhoa.get(k);
      const d = don.theoKhoa.get(k);
      const c = tenKhoa.get(k);
      return {
        khoaId: khoaRaNgoai(k),
        ma: c?.code ?? null,
        ten: k === KHOA_KHAC ? "Học cụ & phí giao hàng" : (c?.name ?? "(khoá đã xoá)"),
        tien: rutTien(t ?? soTienRong()),
        donHang: { soDonHieuLuc: d?.soDon ?? 0, niemYet: d?.niemYet ?? 0, giamGia: d?.giamGia ?? 0, phiGiaoHang: d?.phiGiao ?? 0 },
        quyenHoc: { soQuyenDaCap: quyenTheoKhoa.get(k) ?? 0, soHocVienDuocCap: hocVienTheoKhoa.get(k)?.size ?? 0 },
      };
    })
    .sort((a, b) => b.tien.rong - a.tien.rong || ((a.ma ?? "~") < (b.ma ?? "~") ? -1 : 1));

  const theoThoiGian = lietKeKy(khoang, nhom).map((ky) => ({
    ky,
    tien: rutTien(tien.theoKy.get(ky) ?? soTienRong()),
    soDonHieuLuc: don.theoKy.get(ky)?.soDon ?? 0,
    giamGia: don.theoKy.get(ky)?.giamGia ?? 0,
    soQuyenDaCap: quyenTheoKy.get(ky) ?? 0,
  }));

  const theoPhapNhan = [...tien.theoPhapNhan.entries()]
    .map(([id, a]) => ({ phapNhanId: id === "" ? null : id, ten: id === "" ? null : (tenPhapNhan.get(id) ?? null), ...rutTien(a) }))
    .sort((a, b) => b.rong - a.rong || ((a.phapNhanId ?? "") < (b.phapNhanId ?? "") ? -1 : 1));

  // ── 10. Cảnh báo toàn vẹn (số liệu để người vận hành soi, KHÔNG tự sửa) ──
  const dem = new Map<string, number>();
  for (const x of dongTien) {
    if (x.accountantStatus === "REFUNDED" || x.paymentType === "ADJUSTMENT" || x.amount <= 0) continue;
    const n = nguonGiaoDich(x.note);
    if (n.loai === "WEBHOOK") dem.set(`${n.provider}\u0000${n.providerTxnId}`, (dem.get(`${n.provider}\u0000${n.providerTxnId}`) ?? 0) + 1);
  }
  const maTrung = [...dem.values()].filter((v) => v > 1);
  let thuThua = 0;
  let tienThuThua = 0;
  for (const [id, thu] of thuGopCaDon) {
    const d = donTheoId.get(id);
    if (d && laDonHieuLuc(d.status) && thu > d.totalAmount) {
      thuThua += 1;
      tienThuThua += thu - d.totalAmount;
    }
  }
  const donDaThuDu = donTrongKhoang.filter((d) => laDonHieuLuc(d.status) && d.totalAmount > 0 && (thuGopCaDon.get(d.id) ?? 0) >= d.totalAmount).map((d) => d.id);
  let chuaCapQuyen = 0;
  for (const lo of chia(donDaThuDu, LO)) chuaCapQuyen += await db.orderOnlineGrant.count({ where: { orderId: { in: lo }, status: { not: "GRANTED" } } });

  return {
    khoang,
    nhom,
    khoaId,
    tien: {
      ...rutTien(tien.tong),
      soKhoan: { thu: tien.tong.soKhoanThu, hoan: tien.tong.soKhoanHoan, dieuChinh: tien.tong.soKhoanDieuChinh },
      rongDaXacNhanKeToan: tien.tong.rongDaXacNhan,
      rongChoXacNhanKeToan: tien.tong.rong - tien.tong.rongDaXacNhan,
    },
    donHang: {
      soDon: don.soDon,
      theoTrangThai: don.theoTrangThai,
      soDonHieuLuc: don.tong.soDon,
      thanhToan: don.thanhToan,
      niemYet: don.tong.niemYet,
      giamGia: don.tong.giamGia,
      phiGiaoHang: don.tong.phiGiao,
      giaTriDon: don.tong.niemYet - don.tong.giamGia + don.tong.phiGiao,
    },
    quyenHoc: { soQuyenDaCap: quyen.length, soHocVienDuocCap: hocVienTong.size },
    giamGia: { tong: don.tong.giamGia, theoMa: giamTheoMa, giamKhongQuaMa: don.tong.giamGia - giamCoMa },
    yeuCauHoan: {
      choDuyet: yc("PENDING")?._count._all ?? 0,
      daDuyetChuaChi: yc("APPROVED")?._count._all ?? 0,
      daChi: yc("PAID")?._count._all ?? 0,
      tuChoi: yc("REJECTED")?._count._all ?? 0,
      tongTienDaDuyet: (yc("APPROVED")?._sum.approvedAmount ?? 0) + (yc("PAID")?._sum.approvedAmount ?? 0),
    },
    hoaHong: {
      hoTro: false as const,
      lyDo: "Đơn Online do phụ huynh tự mua, không qua Sale/lead; quy tắc nguồn/affiliate/hoa hồng cho đơn Online CHƯA được chủ dự án quyết (BLOCKED_OWNER — ONLINE-ORDER-CONTRACT.md §9 A-5). API không tính hoa hồng.",
      soButToanHoaHongCuaDonOnline: butToanHoaHong,
    },
    theoThoiGian,
    theoKhoa,
    theoPhapNhan,
    quyTheoTyLe: tien.quyTheoTyLe,
    canhBao: {
      maGiaoDichTrung: maTrung.length,
      donThuThua: { soDon: thuThua, soTien: tienThuThua },
      hoanKhongCoYeuCau: dongTien.filter((x) => x.accountantStatus === "REFUNDED" && !x.refundRequestId).length,
      donDaThuDuChuaCapQuyen: chuaCapQuyen,
    },
  };
}

export type DoanhThuOnline = Awaited<ReturnType<typeof tinhDoanhThuOnline>>;
