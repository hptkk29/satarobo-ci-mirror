// lib/online-revenue/tinh.ts — PHẦN THUẦN của báo cáo doanh thu Online: phân loại dòng tiền, quy tiền về khoá, gom theo kỳ. Không chạm DB.
//
// ─── HAI TRỤC, KHÔNG TRỘN ────────────────────────────────────────────────────────────────────────────────────────────────
//   · TRỤC TIỀN — theo `Payment.paidDate`: thu · hoàn · điều chỉnh · ròng.  Đẳng thức: ròng = thu − hoàn + điều chỉnh.
//   · TRỤC ĐƠN  — theo `Order.createdAt`: số đơn · niêm yết · giảm giá · phí giao · giá trị đơn. Đẳng thức: giá trị = niêm yết − giảm + phí giao.
// Hai trục KHÔNG cộng trừ với nhau (một đơn tạo tháng 10, thu tháng 11, hoàn tháng 12 nằm ở ba kỳ khác nhau — đó là đúng).
//
// ─── "ĐÃ GHI NHẬN" (trục B của `lib/finance/ghi-nhan.ts`) ─────────────────────────────────────────────────────────────────
// Tập dòng tiền được chọn ở tầng DB bằng `KHOAN_DA_GHI_NHAN` (tái dùng, không viết điều kiện thứ hai): sale đã ghi nhận · KHÔNG bị kế toán từ chối · chưa xoá mềm.
// Khoản CHỜ kế toán xác nhận VẪN tính (tiền đã về); cùng quy ước mà `donOnlineDaThuDu` dùng để quyết định cấp quyền học.
// Phân loại trong tập đó (chỉ nhìn trạng thái, KHÔNG nhìn dấu số — bút toán ĐIỀU CHỈNH cũng có thể âm):
//   HOAN       — `accountantStatus = REFUNDED` (bút toán âm do `chiHoanTien`/`refundPayment`; bản gốc giữ nguyên, hai dòng tự trừ nhau).
//   DIEU_CHINH — `paymentType = ADJUSTMENT` (delta có dấu, KHÔNG phải hoàn tiền).
//   THU        — mọi dòng còn lại.
import { laKhoanDaDong } from "@/lib/finance/debt";
import { khoaKy, type NhomThoiGian } from "./thoi-gian";
import { chiaTheoTrongSo } from "./phan-bo";

/** Nhóm "không phải khoá học": học cụ (PRODUCT) và phí giao hàng. Ra ngoài API là `khoaId: null`. */
export const KHOA_KHAC = "__KHAC__";

export type DongTienTho = {
  id: string;
  orderId: string;
  amount: number;
  paidDate: Date;
  paymentType: string;
  accountantStatus: string;
  refundRequestId: string | null;
  note?: string | null;
  deletedAt?: Date | null;
};
export type DongHangTho = { id: string; type: string; onlineCourseId: string | null; unitPrice: number; quantity: number; discountAmount: number };
export type DonTho = { id: string; code: string; status: string; totalAmount: number; shippingFee: number; legalEntityId: string | null; createdAt: Date; items: DongHangTho[] };

export type LoaiDongTien = "THU" | "HOAN" | "DIEU_CHINH";
export function loaiDongTien(p: { accountantStatus: string; paymentType: string }): LoaiDongTien {
  if (p.accountantStatus === "REFUNDED") return "HOAN";
  if (p.paymentType === "ADJUSTMENT") return "DIEU_CHINH";
  return "THU";
}

export const khoaCuaDong = (d: Pick<DongHangTho, "type" | "onlineCourseId">): string => (d.type === "ONLINE_COURSE" && d.onlineCourseId ? d.onlineCourseId : KHOA_KHAC);
/** Thành tiền dòng sau giảm — CÙNG công thức trần hoàn tiền Online (`lib/finance/hoan-tien-online-tran.ts`). */
export const thanhTienDong = (d: Pick<DongHangTho, "unitPrice" | "quantity" | "discountAmount">): number => Math.max(0, d.unitPrice * d.quantity - d.discountAmount);

/** Trọng số chia tiền mức đơn về các nhóm: thành tiền dòng theo khoá + phí giao vào nhóm "khác". Tổng 0 ⇒ dồn về "khác". */
export function trongSoCuaDon(don: Pick<DonTho, "items" | "shippingFee">): Map<string, number> {
  const w = new Map<string, number>();
  for (const d of don.items) w.set(khoaCuaDong(d), (w.get(khoaCuaDong(d)) ?? 0) + thanhTienDong(d));
  if (don.shippingFee > 0) w.set(KHOA_KHAC, (w.get(KHOA_KHAC) ?? 0) + don.shippingFee);
  const coDuong = [...w.values()].some((v) => v > 0);
  return coDuong ? w : new Map([[KHOA_KHAC, 1]]);
}

export type SoTienTho = { thu: number; hoan: number; dieuChinh: number; rong: number; rongDaXacNhan: number; soKhoanThu: number; soKhoanHoan: number; soKhoanDieuChinh: number };
export const soTienRong = (): SoTienTho => ({ thu: 0, hoan: 0, dieuChinh: 0, rong: 0, rongDaXacNhan: 0, soKhoanThu: 0, soKhoanHoan: 0, soKhoanDieuChinh: 0 });

function cong(a: SoTienTho, loai: LoaiDongTien, phan: number, daXacNhan: boolean): void {
  if (loai === "HOAN") {
    a.hoan += -phan;
    a.soKhoanHoan += 1;
  } else if (loai === "DIEU_CHINH") {
    a.dieuChinh += phan;
    a.soKhoanDieuChinh += 1;
  } else {
    a.thu += phan;
    a.soKhoanThu += 1;
  }
  a.rong += phan;
  if (daXacNhan) a.rongDaXacNhan += phan;
}
const lay = <K, V>(m: Map<K, V>, k: K, moi: () => V): V => m.get(k) ?? m.set(k, moi()).get(k)!;

export type KetQuaTien = {
  tong: SoTienTho;
  theoKhoa: Map<string, SoTienTho>;
  /** Khoá "" = đơn chưa có pháp nhân. */
  theoPhapNhan: Map<string, SoTienTho>;
  theoKy: Map<string, SoTienTho>;
  /** Tiền ĐÃ quy về khoá bằng chia tỉ lệ (đơn nhiều nhóm mà tiền thu ≠ giá trị đơn) — con số này là ƯỚC TÍNH, mọi con số khác là chính xác. */
  quyTheoTyLe: { soTien: number; soKhoan: number };
};

/**
 * Quy MỖI dòng tiền về các nhóm (khoá / khác), rồi gom theo khoá, pháp nhân, kỳ.
 *   · Dòng HOÀN có `refundRequestId` ⇒ về ĐÚNG khoá của dòng đơn trong yêu cầu hoàn (chính xác).
 *   · Đơn chỉ có MỘT nhóm ⇒ cả khoản về nhóm đó (chính xác).
 *   · Đơn nhiều nhóm mà MỘT khoản thu bằng đúng giá trị đơn (`amount = totalAmount`) ⇒ mỗi nhóm nhận đúng thành tiền của mình (chính xác).
 *   · Còn lại — khoản thu một phần, trả nhiều lần, thu thừa, bút toán điều chỉnh, dòng hoàn không có yêu cầu — trên đơn nhiều nhóm ⇒ chia theo trọng số
 *     và GHI NHẬN vào `quyTheoTyLe` (nhãn "ước tính"). Cố ý KHÔNG coi "tổng các lần trả = giá trị đơn" là chính xác: chia từng khoản có thể lệch vài đồng so với chia theo dòng.
 * `locKhoa` ≠ null ⇒ chỉ cộng phần của khoá đó (tổng = phần của khoá, KHÔNG phải cả khoản).
 * Tổng các nhóm LUÔN bằng tổng khoản (bất biến của `chiaTheoTrongSo`) — khi không lọc.
 */
export function tongHopTien(input: {
  dongTien: readonly DongTienTho[];
  donTheoId: ReadonlyMap<string, DonTho>;
  /** refundRequestId → nhóm của dòng đơn được hoàn. */
  khoaCuaYeuCauHoan: ReadonlyMap<string, string>;
  locKhoa: string | null;
  nhom: NhomThoiGian;
}): KetQuaTien {
  const r: KetQuaTien = { tong: soTienRong(), theoKhoa: new Map(), theoPhapNhan: new Map(), theoKy: new Map(), quyTheoTyLe: { soTien: 0, soKhoan: 0 } };
  for (const p of input.dongTien) {
    const don = input.donTheoId.get(p.orderId);
    const loai = loaiDongTien(p);
    const daXacNhan = laKhoanDaDong(p);
    const w = don ? trongSoCuaDon(don) : new Map([[KHOA_KHAC, 1]]);
    const khoaHoan = loai === "HOAN" && p.refundRequestId ? input.khoaCuaYeuCauHoan.get(p.refundRequestId) : undefined;

    let phanTheoKhoa: Map<string, number>;
    let chinhXac: boolean;
    if (khoaHoan !== undefined) {
      phanTheoKhoa = new Map([[khoaHoan, p.amount]]);
      chinhXac = true;
    } else if (w.size === 1) {
      phanTheoKhoa = new Map([[[...w.keys()][0]!, p.amount]]);
      chinhXac = true;
    } else {
      phanTheoKhoa = chiaTheoTrongSo(p.amount, w) ?? new Map([[KHOA_KHAC, p.amount]]);
      chinhXac = don !== undefined && p.amount === don.totalAmount;
    }
    // Khoản bằng đúng giá trị đơn ⇒ chia theo chính trọng số cho đúng thành tiền từng nhóm (chính xác).

    const ky = khoaKy(p.paidDate, input.nhom);
    // Mỗi DÒNG TIỀN chỉ được ĐẾM MỘT LẦN ở tổng / kỳ / pháp nhân (kể cả khi chia về nhiều khoá); riêng bảng theo KHOÁ đếm một lần cho mỗi khoá có phần.
    let phanTrongLoc = 0;
    let coPhanTrongLoc = false;
    for (const [khoa, phan] of phanTheoKhoa) {
      if (input.locKhoa !== null && khoa !== input.locKhoa) continue;
      coPhanTrongLoc = true;
      phanTrongLoc += phan;
      cong(lay(r.theoKhoa, khoa, soTienRong), loai, phan, daXacNhan);
      if (!chinhXac) r.quyTheoTyLe.soTien += Math.abs(phan);
    }
    if (coPhanTrongLoc) {
      cong(lay(r.theoKy, ky, soTienRong), loai, phanTrongLoc, daXacNhan);
      cong(lay(r.theoPhapNhan, don?.legalEntityId ?? "", soTienRong), loai, phanTrongLoc, daXacNhan);
      cong(r.tong, loai, phanTrongLoc, daXacNhan);
      if (!chinhXac) r.quyTheoTyLe.soKhoan += 1;
    }
  }
  return r;
}

// ─── TRỤC ĐƠN ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TRANG_THAI_DON = ["DRAFT", "PENDING_PAYMENT", "CONFIRMED", "COMPLETED", "CANCELLED", "REFUNDED"] as const;
/** Đơn "hiệu lực" = chưa huỷ, không phải nháp — chỉ những đơn này góp vào niêm yết/giảm/giá trị đơn. */
export const laDonHieuLuc = (status: string): boolean => status !== "CANCELLED" && status !== "DRAFT";

export type SoDonTho = { soDon: number; niemYet: number; giamGia: number; phiGiao: number };
export type KetQuaDon = {
  soDon: number;
  theoTrangThai: Record<string, number>;
  thanhToan: { daThuDu: number; motPhan: number; chuaThu: number; khongCanThanhToan: number };
  tong: SoDonTho;
  theoKhoa: Map<string, SoDonTho>;
  theoKy: Map<string, { soDon: number; giamGia: number }>;
};
const donRong = (): SoDonTho => ({ soDon: 0, niemYet: 0, giamGia: 0, phiGiao: 0 });

/** Phân loại thanh toán của MỘT đơn hiệu lực: so Σ dòng không-hoàn (mọi thời điểm) với tổng đơn. Hoàn hết rồi vẫn là "đã thu đủ". */
export function phanLoaiThanhToan(tongDon: number, thuGop: number): "daThuDu" | "motPhan" | "chuaThu" | "khongCanThanhToan" {
  if (tongDon <= 0) return "khongCanThanhToan";
  if (thuGop >= tongDon) return "daThuDu";
  return thuGop > 0 ? "motPhan" : "chuaThu";
}

export function tongHopDon(input: { don: readonly DonTho[]; thuGopCaDon: ReadonlyMap<string, number>; locKhoa: string | null; nhom: NhomThoiGian }): KetQuaDon {
  const r: KetQuaDon = {
    soDon: 0,
    theoTrangThai: Object.fromEntries(TRANG_THAI_DON.map((t) => [t, 0])),
    thanhToan: { daThuDu: 0, motPhan: 0, chuaThu: 0, khongCanThanhToan: 0 },
    tong: donRong(),
    theoKhoa: new Map(),
    theoKy: new Map(),
  };
  for (const d of input.don) {
    r.soDon += 1;
    r.theoTrangThai[d.status] = (r.theoTrangThai[d.status] ?? 0) + 1;
    if (!laDonHieuLuc(d.status)) continue;
    r.thanhToan[phanLoaiThanhToan(d.totalAmount, input.thuGopCaDon.get(d.id) ?? 0)] += 1;

    const theoNhom = new Map<string, SoDonTho>();
    for (const it of d.items) {
      const k = khoaCuaDong(it);
      const a = lay(theoNhom, k, donRong);
      a.niemYet += it.unitPrice * it.quantity;
      a.giamGia += it.discountAmount;
    }
    if (d.shippingFee > 0) lay(theoNhom, KHOA_KHAC, donRong).phiGiao += d.shippingFee;
    const ky = khoaKy(d.createdAt, input.nhom);
    let giamTrongLoc = 0;
    let coTrongLoc = false;
    for (const [k, a] of theoNhom) {
      if (input.locKhoa !== null && k !== input.locKhoa) continue;
      coTrongLoc = true;
      const t = lay(r.theoKhoa, k, donRong);
      t.soDon += 1;
      t.niemYet += a.niemYet;
      t.giamGia += a.giamGia;
      t.phiGiao += a.phiGiao;
      r.tong.niemYet += a.niemYet;
      r.tong.giamGia += a.giamGia;
      r.tong.phiGiao += a.phiGiao;
      giamTrongLoc += a.giamGia;
    }
    if (coTrongLoc) {
      r.tong.soDon += 1;
      const kyAcc = lay(r.theoKy, ky, () => ({ soDon: 0, giamGia: 0 }));
      kyAcc.soDon += 1;
      kyAcc.giamGia += giamTrongLoc;
    }
  }
  return r;
}
