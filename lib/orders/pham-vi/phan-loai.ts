// lib/orders/pham-vi/phan-loai.ts — "DÒNG NÀY / ĐƠN NÀY CÓ ĐI THEO PHẠM VI HỌC KHÔNG" — vị từ DUY NHẤT, THUẦN
// (không DB, không `server-only`) để planner máy chủ VÀ form tạo đơn cùng gọi.
//
// Vì sao một chỗ: form cần biết "đơn này sẽ đi mô hình thu theo phạm vi" TRƯỚC khi bấm Lưu để ẩn khối kế hoạch nhiều
// đợt và không gửi `keHoachDot`. Nếu form tự suy luật "khoá 48 buổi" bằng điều kiện riêng thì có hai bản luật, và bản
// lệch không ném lỗi — nó chỉ làm sale thấy một khối mà server từ chối (hoặc ngược lại: mất khối kế hoạch của đơn thường).
// Cờ thì KHÔNG nằm ở đây: người gọi (server) đọc cờ rồi truyền vào; file này không biết khoá cờ nào.
import { TONG_SO_BUOI_KHOA_AP_LUAT, xetSoBuoiDong } from "@/lib/orders/so-buoi-hoc-phan";

/** Đúng MỘT loại dòng đi vào mô hình phạm vi: ghi danh khoá học. Khớp `OrderItemType` bằng chữ để file này không import Prisma. */
export function laDongGhiDanhKhoa(loai: string): boolean {
  return loai === "COURSE_ENROLLMENT";
}

/** Khoá của dòng có nằm trong phạm vi luật (đủ 48 buổi) không. Không xét cờ, không xét loại dòng. */
export function khoaTrongPhamVi(d: { readonly tongSoBuoiKhoa: number | null; readonly soBuoiMua: number | null }): boolean {
  // Chỉ dùng `apLuat`; KHÔNG dùng `soBuoiXet` (nó coi null là "đủ khoá" — xem `ke-hoach-dong-don.ts`).
  return xetSoBuoiDong({ tongSoBuoiKhoa: d.tongSoBuoiKhoa, soBuoiMua: d.soBuoiMua }).apLuat;
}

export interface DongPhanLoai {
  readonly loai: string;
  readonly tongSoBuoiKhoa: number | null;
  readonly soBuoiMua: number | null;
}

/** Dòng ghi danh khoá 48 buổi — bước 2 và 3 của bảng quyết định `keHoachDongDon`, gộp lại. */
export function dongLaPhamVi(d: DongPhanLoai): boolean {
  return laDongGhiDanhKhoa(d.loai) && khoaTrongPhamVi(d);
}

/**
 * Đơn trộn (có dòng phạm vi lẫn dòng khác) — Q17 chưa chốt nên bị từ chối. Câu chữ ở MỘT chỗ: planner máy chủ và
 * lời cảnh báo trên form dùng chung, để màn hình không nói một đằng còn server từ chối một nẻo.
 */
export function thongBaoDonTron(tenDongKhac: readonly string[]): string {
  return (
    `Đơn có cả dòng khoá ${TONG_SO_BUOI_KHOA_AP_LUAT} buổi (mua theo phạm vi học) lẫn dòng khác: ${tenDongKhac.join("; ")}. ` +
    "Chưa hỗ trợ đơn trộn — hãy tách thành đơn riêng."
  );
}

export type GiaoDienDon =
  /** Giao diện CŨ nguyên văn: cờ tắt, không dòng nào theo phạm vi, hoặc đơn rỗng. */
  | { readonly kieu: "CU" }
  /** Cờ bật VÀ mọi dòng theo phạm vi: không có kế hoạch nhiều đợt. */
  | { readonly kieu: "PHAM_VI" }
  /** Cờ bật, có dòng phạm vi lẫn dòng khác. Server sẽ từ chối (Q17); giao diện cũ giữ nguyên, kèm cảnh báo. */
  | { readonly kieu: "TRON"; readonly chiSoDongKhac: readonly number[] };

/**
 * Giao diện tạo đơn nên ở chế độ nào. `phamViBat` là kết quả cờ của CƠ SỞ ĐANG CHỌN do máy chủ đọc (form không tự đọc cờ).
 * Đây chỉ là lớp trải nghiệm — `createOrderManualAction` đọc lại cờ và quyết định độc lập.
 */
export function phanLoaiGiaoDienDon(vao: { readonly phamViBat: boolean; readonly dong: readonly DongPhanLoai[] }): GiaoDienDon {
  if (!vao.phamViBat || vao.dong.length === 0) return { kieu: "CU" };
  const laPV = vao.dong.map(dongLaPhamVi);
  const soPV = laPV.filter(Boolean).length;
  if (soPV === 0) return { kieu: "CU" };
  if (soPV === vao.dong.length) return { kieu: "PHAM_VI" };
  return { kieu: "TRON", chiSoDongKhac: laPV.flatMap((x, i) => (x ? [] : [i])) };
}

/**
 * `keHoachDot` form gửi lên. Đơn thuần phạm vi ⇒ `null` (cùng hợp đồng với "khối kế hoạch đang khoá": server đọc
 * `(keHoachDot ?? []).length`); mọi chế độ khác ⇒ trả NGUYÊN `keHoachCu` — payload cũ không đổi một byte.
 * Quyết định dựa trên CHẾ ĐỘ HIỆN TẠI, không dựa trên state kế hoạch còn sót lại (đổi khoá / đổi cơ sở qua lại).
 */
export function chonKeHoachDotGui<T>(gd: GiaoDienDon, keHoachCu: T | null): T | null {
  return gd.kieu === "PHAM_VI" ? null : keHoachCu;
}
