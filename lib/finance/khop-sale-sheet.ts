// lib/finance/khop-sale-sheet.ts — nối cột "Sales" của sheet với TÀI KHOẢN trong hệ thống,
// và vớt lại NGÀY cho những dòng sheet bỏ trống ngày.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI
//
// Chủ dự án 14/09/2026: "khi nhập vào đơn hàng thiếu quá nhiều thông tin: người tạo phải
// gán cho sale, lúc tạo phải lấy đúng ngày trong sheet."
//
// `Order` KHÔNG có cột "sale phụ trách" — thứ gần nhất là `createdById` (người tạo), và
// đó đúng là cột mà danh sách đơn + mọi báo cáo đọc để biết ai bán. Để nguyên người bấm
// nút thì 136 đơn đều mang tên MỘT người, và thành tích của 6 sale biến mất.
//
// ─────────────────────────────────────────────────────────────────────────────
// HAI SỐ ĐO TRÊN FILE THẬT (14/09/2026, 136 dòng dùng được)
//
//  · cột "Sales" có ĐÚNG 6 tên — Diệu 50 · Liên 31 · Nhật Hạ 28 · Vân 16 · My 7 ·
//    Toại 4, và 0 dòng để trống ⇒ người nhập chọn 6 lần, không phải 136 (`gomTenSale`).
//  · 23/136 dòng KHÔNG có ngày ⇒ chỗ ghi cũ để `?? new Date()`, tức 23 đơn của 5 tháng
//    dồn hết vào hôm bấm nút (`thangCuaSheet`).
// ─────────────────────────────────────────────────────────────────────────────

import { chuanTenSoSanh } from "@/lib/finance/nhap-giao-dich-sheet";

// `thangCuaSheet` ĐÃ DỜI sang `nhap-giao-dich-sheet.ts` (14/09/2026): nó cần cho
// `docDongGiaoDich` — 5 dòng thật ghi ngày dạng "29/08" không có năm — và import
// ngược lại từ đây sẽ tạo VÒNG (depcruise `no-circular` là error). Re-export để chỗ
// gọi cũ không phải sửa, nhưng ĐỊNH NGHĨA chỉ có một.
export { thangCuaSheet } from "@/lib/finance/nhap-giao-dich-sheet";

export type TaiKhoanSale = { id: string; name: string | null; centerId: string | null };
export type UngVienSale = TaiKhoanSale & { goiY: boolean };

/** Một tên sale trong sheet + khối lượng đi kèm, để người nhập biết mình đang gán gì. */
export type TenSaleSheet = { ten: string; soDong: number; tien: number };

/**
 * Gộp cột "Sales" thành danh sách tên riêng biệt, kèm số dòng và số tiền.
 *
 * Dòng KHÔNG có sale gom vào mục tên rỗng `""` thay vì bị bỏ — nuốt lặng chính là cách
 * một lô đơn âm thầm mang tên người bấm nút.
 */
export function gomTenSale(dong: Array<{ sale?: string | null; hocPhi: number }>): TenSaleSheet[] {
  const map = new Map<string, TenSaleSheet>();
  for (const d of dong) {
    const goc = (d.sale ?? "").replace(/\s+/g, " ").trim();
    // Khoá so là dạng BỎ DẤU + viết hoa; nhãn hiện ra giữ nguyên bản gõ đầu tiên.
    const khoa = chuanTenSoSanh(goc);
    const cu = map.get(khoa);
    const tien = Number.isFinite(d.hocPhi) ? Math.max(0, Math.round(d.hocPhi)) : 0;
    if (cu) {
      cu.soDong += 1;
      cu.tien += tien;
    } else {
      map.set(khoa, { ten: goc, soDong: 1, tien });
    }
  }
  return [...map.values()].sort((a, b) => b.soDong - a.soDong || (a.ten < b.ten ? -1 : 1));
}

/**
 * Xếp thứ tự ứng viên cho MỘT tên sale trong sheet — ứng viên khả dĩ lên đầu, `goiY: true`.
 *
 * ⚠️ KHÔNG trả "người được chọn", kể cả khi chỉ có một ứng viên khớp. Cùng luật với
 * `khopHocVien`: chọn sai ở đây là thành tích và hoa hồng chạy vào tài khoản người khác,
 * mà đơn vẫn tạo thành công nên không ai phát hiện.
 *
 * Khớp là "tên sheet = CỤM TỪ CUỐI của tên tài khoản", bỏ dấu. Chỉ từ cuối, KHÔNG phải
 * "chứa chuỗi": "Diệu" mà khớp lỏng thì "Phạm Hoàng Diệu Anh" cũng lên đầu, và người bấm
 * nhanh gán nhầm 50 đơn.
 */
export function goiYSale(tenSheet: string, dsTaiKhoan: TaiKhoanSale[]): UngVienSale[] {
  const can = chuanTenSoSanh(tenSheet);
  const ra = dsTaiKhoan.map((t) => {
    const day = chuanTenSoSanh(t.name ?? "");
    const khop = can.length > 0 && (day === can || day.endsWith(" " + can));
    return { ...t, goiY: khop };
  });
  return ra.sort((a, b) => Number(b.goiY) - Number(a.goiY));
}
