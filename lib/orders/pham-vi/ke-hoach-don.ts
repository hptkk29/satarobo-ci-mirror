// lib/orders/pham-vi/ke-hoach-don.ts — KẾ HOẠCH CẢ ĐƠN theo phạm vi học: LEGACY | SCOPE | REJECT. THUẦN (không DB,
// không đồng hồ, không `server-only`) để test không cần database và form về sau gọi được cùng hàm.
//
// Việc của file này (planner MỘT dòng đã có ở `lib/pricing/ke-hoach-dong-don.ts`, file này ghép chúng lại thành ĐƠN):
//   1. Cờ TẮT                       ⇒ LEGACY, KHÔNG xét gì thêm.
//   2. Phân loại từng dòng bằng planner một dòng (lượt 1, thứ hạng tạm 1/1 chỉ để PHÂN LOẠI).
//   3. Đơn TRỘN (có dòng SCOPE lẫn dòng LEGACY) ⇒ REJECT — Q17 CHƯA CHỐT, không đoán (xem dưới).
//   4. Xếp thứ hạng CON và SẢN PHẨM 48 TRONG ĐƠN theo `pricing.sameTimeChildOrder`, rồi tính giá thật (lượt 2).
//   5. Đối chiếu đơn giá client gửi với số máy chủ tính: lệch ⇒ REJECT (không ghi đè im lặng).
//
// ── NHỮNG GÌ ĐỢT NÀY CỐ Ý TỪ CHỐI (mỗi mục là một câu hỏi chưa chốt, KHÔNG phải sơ suất) ───────────────────
//   · Đơn trộn dòng SCOPE + dòng không-SCOPE (Q17).
//   · Khoản giảm tay / mã khuyến mãi trên dòng SCOPE (Q12: trần 25% có chặn cộng thêm không — chưa chốt). Nếu cho
//     qua, khoản đó tính trên giá ĐÃ giảm theo chính sách và vượt trần 25% mà không cổng nào thấy.
//   · Kế hoạch nhiều đợt (`keHoachDot`) trên đơn SCOPE: mô hình mới thu theo phạm vi, không chia đợt.
//   · Số buổi lẻ (MT-11 / Q9) — planner một dòng đã từ chối.
//   · Nhiều dòng SCOPE mà có dòng không chọn học viên/con: không xếp được thứ hạng con.
//
// ── ĐƠN GIÁ GHI XUỐNG = THÀNH TIỀN SAU GIẢM, SỐ LƯỢNG 1, KHÔNG KHOẢN GIẢM RIÊNG ─────────────────────────────
// Giảm theo chính sách (Bảng A/B + anh/chị/em, trần 25%) đã nằm TRONG `thanhTien`; ghi nó thêm một lần như "khoản
// giảm" là (a) đếm vào `orders.maxDiscountItems` và biến mọi khoản giảm tay thành "2 ưu đãi" ⇒ hàng chờ duyệt,
// (b) để `giaTuDongDon` (ghi danh khi convert) đọc `OrderItem.totalPrice` TRƯỚC giảm và ghi `Enrollment.listPrice`
// = niêm yết, mất khoản giảm (G-04). Niêm yết, % và số tiền giảm vẫn được GIỮ nguyên trong `pricingSnapshot`.
//
// ── THỨ HẠNG CHỈ TÍNH TRONG ĐƠN ─────────────────────────────────────────────────────────────────────────
// Xuyên đơn cần `familyKey` (Q8) chưa có. Hệ quả phải biết: nhà đã mua đơn trước mà đơn này lại coi con đầu là
// "con thứ nhất" ⇒ thiếu giảm 10–15%. Vì vậy cờ KHÔNG được bật ở prod trước khi có thứ hạng xuyên đơn.
// "Giá trị thấp hơn" (MM-02/N2) hiểu theo niêm yết đơn (`gia48 × số buổi`), mặc định của BA; hoà ⇒ giữ thứ tự dòng.
import { keHoachDongDon, type KeHoachDongDon, type LoaiDongDon, type PricingSnapshotDong } from "@/lib/pricing/ke-hoach-dong-don";
import type { CheDoMocNgay, ChinhSachGia } from "@/lib/pricing/tinh-gia-theo-moc";
import type { ThuTuConMacDinh } from "@/lib/entitlements/cai-dat";
import { TONG_SO_BUOI_KHOA_AP_LUAT } from "@/lib/orders/so-buoi-hoc-phan";
import { thongBaoDonTron } from "./phan-loai";

/** Một dòng đơn, ĐÃ đọc xong (không còn DB): người gọi tra khoá và quy đổi metadata trước. */
export interface DongVao {
  readonly loai: LoaiDongDon;
  /** Tên hiển thị của dòng — chỉ để câu lỗi nói được "dòng nào". */
  readonly tenDong: string;
  readonly soLuong: number;
  /** `unitPrice` client gửi. Máy chủ KHÔNG tin nó: chỉ dùng để đối chiếu với số tự tính. */
  readonly donGiaKhach: number;
  /** Số khoản giảm client khai trên dòng (`discounts.length`, kể cả mã khuyến mãi). */
  readonly soKhoanGiam: number;
  readonly laLopNhom: boolean;
  /** `Course.totalSessions`. `null` = dòng không phải khoá học hoặc khoá không khai. */
  readonly tongSoBuoiKhoa: number | null;
  /** `metadata.soBuoi` client gửi. `null` = không khai. */
  readonly soBuoiMua: number | null;
  /** `Course.price` (Q1). `null` = khoá không có giá. */
  readonly gia48: number | null;
  /** `studentId` hoặc `leadChildId` của dòng — khoá để biết hai dòng có cùng một đứa trẻ không. */
  readonly conKhoa: string | null;
}

export interface BoiCanhDon {
  /** Kết quả `laThuHocPhiTheoPhamViBat` — người gọi đọc cờ, file này không đọc DB. */
  readonly phamViBat: boolean;
  /** Nhãn nơi lấy `gia48`, chụp vào snapshot (Q1: "Course.price"). */
  readonly nguonGia48: string;
  readonly chinhSach: ChinhSachGia;
  readonly hieuLuc: { readonly tu: Date; readonly den: Date };
  readonly cheDoMocNgay: CheDoMocNgay;
  readonly thuTuMacDinh: ThuTuConMacDinh;
  /** Ngày tạo đơn — người gọi truyền vào (file này không đọc đồng hồ). */
  readonly taoDon: Date;
  /** Client có gửi `keHoachDot` không rỗng. */
  readonly coKeHoachDot: boolean;
}

export interface DongPhamVi {
  readonly soBuoi: number;
  readonly loaiMua: "FULL" | "MILESTONE";
  /** Niêm yết tại mốc = `gia48 × n ÷ 48` (nguyên đồng). */
  readonly niemYet: number;
  /** Tiền khách phải trả cho dòng này. Chính là `OrderItem.unitPrice` (số lượng 1). */
  readonly thanhTien: number;
  readonly pricingSnapshot: PricingSnapshotDong;
}

export type KetQuaDon =
  | { readonly kieu: "LEGACY" }
  | { readonly kieu: "REJECT"; readonly thongBao: string }
  /** `dong` cùng thứ tự, cùng độ dài với đầu vào; MỌI dòng đều là SCOPE (đơn trộn đã bị từ chối). */
  | { readonly kieu: "SCOPE"; readonly dong: readonly DongPhamVi[] };

const tuChoi = (thongBao: string): KetQuaDon => ({ kieu: "REJECT", thongBao });

/** 10560000 → "10.560.000". Không dùng `toLocaleString`: kết quả phụ thuộc ICU của máy chạy. */
export function dinhDangDong(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  return (n < 0 ? "-" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Hạng 1..N theo giá trị, ỔN ĐỊNH: hai giá trị bằng nhau giữ thứ tự xuất hiện (không đồng hạng — hai đứa trẻ không
 * thể cùng là "con thứ nhất").
 */
export function xepHang(giaTri: readonly number[], thuTu: ThuTuConMacDinh): number[] {
  const idx = giaTri.map((_, i) => i);
  idx.sort((a, b) => (thuTu === "LOWER_VALUE_FIRST" ? giaTri[a]! - giaTri[b]! : giaTri[b]! - giaTri[a]!) || a - b);
  const hang: number[] = new Array<number>(giaTri.length).fill(0);
  idx.forEach((i, pos) => {
    hang[i] = pos + 1;
  });
  return hang;
}

/**
 * Kế hoạch cả đơn — đường TẠO ĐƠN THẬT: có đối chiếu đơn giá client gửi với số máy chủ tính.
 * Hành vi không đổi so với trước khi có `xemTruocKeHoachDon`.
 */
export function keHoachDon(dong: readonly DongVao[], b: BoiCanhDon): KetQuaDon {
  return lapKeHoachDon(dong, b, true);
}

/**
 * XEM TRƯỚC giá cho form: CÙNG bảng quyết định và CÙNG thứ tự từ chối, chỉ bỏ MỘT bước — đối chiếu `donGiaKhach` — vì mục
 * đích là cho người bán biết số đúng để điền. Kết quả `SCOPE` mang `thanhTien` từng dòng; `REJECT`/`LEGACY` y như đường thật.
 * Chỉ ĐỌC: thuần, không ghi gì; người gọi truyền `coKeHoachDot: false` (form phạm vi không gửi kế hoạch đợt).
 *
 * Đây KHÔNG phải cổng: đường tạo đơn vẫn gọi `keHoachDon` và vẫn từ chối đơn giá lệch.
 */
export function xemTruocKeHoachDon(dong: readonly DongVao[], b: BoiCanhDon): KetQuaDon {
  return lapKeHoachDon(dong, b, false);
}

/** `doiChieuGia` BẮT BUỘC, không mặc định (luật 7): quên truyền = `tsc` đỏ, không phải bỏ cổng giá trong im lặng. */
function lapKeHoachDon(dong: readonly DongVao[], b: BoiCanhDon, doiChieuGia: boolean): KetQuaDon {
  // Cờ TẮT ⇒ không xét gì khác. Đây là cổng giữ cho đường cũ chạy nguyên văn.
  if (!b.phamViBat) return { kieu: "LEGACY" };

  const nhan = (i: number) => `Dòng ${i + 1} (${dong[i]!.tenDong})`;
  const lapKeHoach = (d: DongVao, thuTuCon: number, thuTuSanPham48: number): KeHoachDongDon =>
    keHoachDongDon(
      {
        loai: d.loai,
        soLuong: d.soLuong,
        laLopNhom: d.laLopNhom,
        tongSoBuoiKhoa: d.tongSoBuoiKhoa,
        soBuoiMua: d.soBuoiMua,
        thuTuCon,
        thuTuSanPham48,
      },
      {
        phamViBat: true,
        gia48: d.gia48,
        nguonGia48: b.nguonGia48,
        chinhSach: b.chinhSach,
        hieuLuc: b.hieuLuc,
        cheDoMocNgay: b.cheDoMocNgay,
        ngay: { taoDon: b.taoDon },
      },
    );

  // ── LƯỢT 1: PHÂN LOẠI. Thứ hạng 1/1 chỉ để planner một dòng chạy được; kết quả giá của lượt này BỊ BỎ. ──────────
  const luot1 = dong.map((d) => lapKeHoach(d, 1, 1));
  const laSCOPE: boolean[] = [];
  for (const [i, k] of luot1.entries()) {
    if (k.quyetDinh === "LEGACY") {
      laSCOPE.push(false);
    } else if (k.quyetDinh === "SCOPE") {
      laSCOPE.push(true);
    } else if (k.ma === "GIA_KHONG_NGUYEN_DONG") {
      // Chia hết hay không còn tuỳ % của thứ hạng THẬT (15% hay 25%) — chưa biết ở lượt 1. Dòng vẫn là SCOPE; lượt 2 quyết.
      laSCOPE.push(true);
    } else {
      return tuChoi(`${nhan(i)}: ${k.thongBao}`);
    }
  }

  const soScope = laSCOPE.filter(Boolean).length;
  if (soScope === 0) return { kieu: "LEGACY" };
  if (soScope < dong.length) {
    const khac = dong.flatMap((d, i) => (laSCOPE[i] ? [] : [nhan(i)]));
    return tuChoi(thongBaoDonTron(khac));
  }

  // ── Các cổng CHƯA CHỐT: từ chối thay vì đoán ─────────────────────────────────────────────────────────────────
  if (b.coKeHoachDot) {
    return tuChoi(
      "Đơn mua theo phạm vi học thu theo số buổi đã chọn, không chia kế hoạch nhiều đợt. Bỏ kế hoạch thanh toán chia đợt rồi lưu lại.",
    );
  }
  for (const [i, d] of dong.entries()) {
    if (d.soKhoanGiam > 0) {
      return tuChoi(
        `${nhan(i)}: giá theo phạm vi học đã gồm giảm theo chính sách (tối đa 25%). Chưa cho cộng thêm khoản giảm tay hoặc mã khuyến mãi trên dòng này — bỏ khoản giảm rồi lưu lại.`,
      );
    }
  }

  // ── Thứ hạng CON trong đơn ───────────────────────────────────────────────────────────────────────────────────
  if (dong.length > 1 && dong.some((d) => d.conKhoa === null)) {
    const thieu = dong.flatMap((d, i) => (d.conKhoa === null ? [nhan(i)] : []));
    return tuChoi(
      `Đơn có nhiều dòng khoá ${TONG_SO_BUOI_KHOA_AP_LUAT} buổi thì mỗi dòng phải chọn rõ học viên/con — chưa chọn ở: ${thieu.join("; ")}. Không có chọn này thì không xếp được con thứ nhất, thứ hai.`,
    );
  }
  const gtDong = dong.map((d) => d.gia48! * d.soBuoiMua!);
  const conTheoThuTu: string[] = [];
  for (const d of dong) {
    const k = d.conKhoa ?? "";
    if (!conTheoThuTu.includes(k)) conTheoThuTu.push(k);
  }
  const gtCon = conTheoThuTu.map((k) => dong.reduce((s, d, i) => ((d.conKhoa ?? "") === k ? s + gtDong[i]! : s), 0));
  const hangCon = xepHang(gtCon, b.thuTuMacDinh);
  const thuTuConDong = dong.map((d) => hangCon[conTheoThuTu.indexOf(d.conKhoa ?? "")]!);

  // ── Thứ hạng SẢN PHẨM 48: chỉ các dòng mua đủ 48 buổi (dòng 12/24/36 không tính vào thứ tự này — BA §2.3) ───
  const chiSo48 = dong.flatMap((d, i) => (d.soBuoiMua === TONG_SO_BUOI_KHOA_AP_LUAT ? [i] : []));
  const hang48 = xepHang(chiSo48.map((i) => gtDong[i]!), b.thuTuMacDinh);
  const thuTuSp48Dong = dong.map((_, i) => {
    const p = chiSo48.indexOf(i);
    return p === -1 ? 1 : hang48[p]!;
  });

  // ── LƯỢT 2: GIÁ THẬT ─────────────────────────────────────────────────────────────────────────────────────────
  const ra: DongPhamVi[] = [];
  for (const [i, d] of dong.entries()) {
    const k = lapKeHoach(d, thuTuConDong[i]!, thuTuSp48Dong[i]!);
    if (k.quyetDinh === "LEGACY") {
      // Không thể xảy ra (lượt 1 đã phân loại SCOPE và dữ liệu không đổi). Giữ nhánh để lỗi lập trình thành TỪ CHỐI,
      // không thành LEGACY — chuyển một dòng đã-là-SCOPE về đường cũ là bán sai giá.
      return tuChoi(`${nhan(i)}: không xác định được mô hình thu học phí.`);
    }
    if (k.quyetDinh === "REJECT") return tuChoi(`${nhan(i)}: ${k.thongBao}`);

    const thanhTien = k.baoGia.gia.thanhTien;
    if (doiChieuGia && d.donGiaKhach !== thanhTien) {
      return tuChoi(
        `${nhan(i)}: đơn giá phải là ${dinhDangDong(thanhTien)}đ ` +
          `(niêm yết ${k.soBuoi} buổi ${dinhDangDong(k.baoGia.gia.niemYet)}đ, giảm ${k.baoGia.gia.phanTramApDung}% theo chính sách phạm vi học). ` +
          `Đang nhập ${dinhDangDong(d.donGiaKhach)}đ.`,
      );
    }
    ra.push({
      soBuoi: k.soBuoi,
      loaiMua: k.loaiMua,
      niemYet: k.baoGia.gia.niemYet,
      thanhTien,
      pricingSnapshot: k.pricingSnapshot,
    });
  }
  return { kieu: "SCOPE", dong: ra };
}
