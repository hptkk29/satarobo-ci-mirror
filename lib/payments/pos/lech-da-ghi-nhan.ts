// lib/payments/pos/lech-da-ghi-nhan.ts — GĐ3 POS: luật cho dòng ĐÃ GHI NHẬN khi nhập lại file. THUẦN
// (không DB) — chạy được ở trình duyệt (màn import) lẫn server. Thiết kế: docs/pos-gd3-thiet-ke.md §2.
//
// Hai luật, cả hai từng là lỗ của nhánh "đã khoá" trong `nhap-lo-pos.ts`:
//
//  1. LỆCH (V5–V7): dòng ĐÃ GHI NHẬN (giao dịch MATCHED — tiền đã vào sổ) mà file mới ghi số tiền /
//     trạng thái KHÁC ⇒ KHÔNG đổi sổ, KHÔNG đổi dòng (đó là bản ghi đã khớp tiền), nhưng phải BÁO. Bản
//     trước bỏ qua im lặng. Giao dịch đã BỎ QUA (IGNORED) không báo: không có tiền trong sổ để sửa —
//     cùng lý do dòng hủy đã kết luận không báo (V7).
//     Chỉ so SỐ TIỀN + TRẠNG THÁI — hai cột quyết định tiền. Giờ có thể lệch giây giữa hai lần xuất,
//     ghi chú có thể lệch khoảng trắng: báo giả mỗi lần nhập là cảnh báo người ta học cách bỏ qua.
//  2. CỘT KẾT TOÁN (V8): ô TRỐNG trong file KHÔNG xoá giá trị đã có. Bản trước ghi thẳng giá trị file ⇒
//     nhập lại file NGÀY ĐẦU (Mã hạch toán còn trống) xoá Mã hạch toán + Phí, và xoá `trangThaiHoanHuy`
//     — cột `provider/tcb-file.ts` đọc để biết lần quẹt đã bị hủy (mất nó là phiếu POS có thể báo xanh
//     cho một khoản đã hoàn về thẻ khách).
import type { DongPos } from "./kieu";
import { maTrangThaiPos } from "./phan-loai-pos";

export type TruongLech = "soTien" | "trangThai";

/** Một trường lệch giữa thứ ĐÃ GHI NHẬN và thứ FILE ghi — giá trị ở dạng IN ĐƯỢC ("3.168.000", "Thành công"). */
export type LechDong = {
  maGiaoDich: string;
  truong: TruongLech;
  daGhiNhan: string;
  trongFile: string;
};

const fmtTien = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
const gon = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * So dòng đã ghi nhận với dòng của file. `daGhi.trangThai = null` ⇒ chỉ so số tiền (ca biên: giao dịch
 * vào sổ từ nguồn khác file, không có trạng thái chữ). Trạng thái so bằng `maTrangThaiPos` — khác NFC/NFD,
 * khác hoa thường, khác khoảng trắng KHÔNG phải lệch. Trả `[]` khi không lệch; số tiền đứng trước.
 */
export function lechDaGhiNhan(
  maGiaoDich: string,
  daGhi: { soTien: number; trangThai: string | null },
  file: { soTien: number; trangThai: string },
): LechDong[] {
  const ra: LechDong[] = [];
  if (daGhi.soTien !== file.soTien) {
    ra.push({ maGiaoDich, truong: "soTien", daGhiNhan: fmtTien(daGhi.soTien), trongFile: fmtTien(file.soTien) });
  }
  if (daGhi.trangThai !== null && maTrangThaiPos(daGhi.trangThai) !== maTrangThaiPos(file.trangThai)) {
    ra.push({ maGiaoDich, truong: "trangThai", daGhiNhan: gon(daGhi.trangThai), trongFile: gon(file.trangThai) });
  }
  return ra;
}

/** Số GIAO DỊCH có lệch (một giao dịch lệch cả số tiền lẫn trạng thái vẫn là một). */
export function demGiaoDichLech(lech: readonly LechDong[]): number {
  return new Set(lech.map((l) => l.maGiaoDich)).size;
}

/** Lệch GOM theo giao dịch: một mục mỗi mã, các trường lệch bên trong. */
export type LechTheoGiaoDich = { maGiaoDich: string; muc: LechDong[] };

/**
 * Gom lệch theo GIAO DỊCH, giữ thứ tự xuất hiện đầu tiên [rà đối kháng GĐ3 · 06/10/2026]. Khối báo lệch
 * trên màn cắt danh sách theo ĐƠN VỊ NÀY — cùng đơn vị với tiêu đề (`demGiaoDichLech`). Mã TRƯỚC bản vá
 * cắt theo MỤC (giao dịch × trường) ⇒ "15 giao dịch" trên tiêu đề, 10 mã trong danh sách, rồi "… và 10
 * khác" — con số trên màn tự mâu thuẫn (luật 12).
 */
export function gomLechTheoGiaoDich(lech: readonly LechDong[]): LechTheoGiaoDich[] {
  const theoMa = new Map<string, LechDong[]>();
  for (const l of lech) {
    const muc = theoMa.get(l.maGiaoDich);
    if (muc) muc.push(l);
    else theoMa.set(l.maGiaoDich, [l]);
  }
  return [...theoMa].map(([maGiaoDich, muc]) => ({ maGiaoDich, muc }));
}

/** Ba cột KẾT TOÁN của dòng POS. */
export type CotKetToan = { maHachToan: string | null; phiGiaoDich: number | null; trangThaiHoanHuy: string | null };

/** Ô trống = `null` hoặc chuỗi chỉ có khoảng trắng — cùng nghĩa `coChu` của D7 và `tinHieuHoanHuy`. */
const trong = (s: string | null) => s === null || s.trim() === "";

/**
 * Cột kết toán cho MỌI phép CẬP NHẬT một dòng POS đã có (V8): CHỈ gồm các ô file CÓ giá trị — ô TRỐNG thì
 * KHOÁ VẮNG MẶT, nên phép `update` không chạm cột đó. Phí `0` là giá trị, không phải ô trống. Dòng MỚI
 * (vế `create`) ghi thẳng giá trị file — không có gì để giữ.
 *
 * Rà đối kháng GĐ3 (06/10/2026) — hai lỗ của bản đầu `cotKetToanCapNhat(cu, d)`:
 *  · nó trả lại giá trị CŨ của ẢNH CHỤP ĐẦU LÔ (`cu`) khi ô trống và ghi TƯỜNG MINH ⇒ một lượt song song
 *    vừa commit Mã hạch toán / "Hủy toàn phần" bị đè về giá trị cũ (ca `[POS3-DB-11]`);
 *  · nó chỉ được gọi ở ba nhánh "chỉ cập nhật kết toán" — dòng CHƯA khoá được phân loại lại (`ghiDong`)
 *    vẫn ghi thẳng ô trống ⇒ file cũ xoá tín hiệu hủy (ca `[POS3-DB-10]`).
 *
 * ⚠️ Biểu thức D7 ở tầng nhập lô (`coChu(d.trangThaiHoanHuy) && !coChu(cu.trangThaiHoanHuy)`) vẫn đọc
 * FILE để biết tin hủy có MỚI không — hàm này không đổi nghĩa đó, chỉ đổi cái được GHI.
 */
export function cotKetToanCapNhat(d: Pick<DongPos, "maHachToan" | "phiGiaoDich" | "trangThaiHoanHuy">): Partial<CotKetToan> {
  return {
    ...(trong(d.maHachToan) ? {} : { maHachToan: d.maHachToan }),
    ...(d.phiGiaoDich === null ? {} : { phiGiaoDich: d.phiGiaoDich }),
    ...(trong(d.trangThaiHoanHuy) ? {} : { trangThaiHoanHuy: d.trangThaiHoanHuy }),
  };
}
