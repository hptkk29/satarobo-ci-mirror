// lib/orders/pham-vi/xem-truoc.ts — HÌNH DẠNG kết quả "xem trước giá theo phạm vi học" cho form tạo đơn. THUẦN.
//
// Server action `xemTruocGiaPhamViAction` (app/(admin)/admin/orders/_pham-vi-actions.ts) trả đúng kiểu này; hàm ở đây đổi
// `KetQuaDon` của planner thành thứ form đọc được. Tách ra để (a) test không cần DB/auth, (b) tệp 'use server' chỉ được
// export hàm async nên kiểu và hàm thuần phải đứng ngoài.
//
// Kết quả này CHỈ ĐỂ HIỂN THỊ. Nó không phải báo giá ràng buộc: đường tạo đơn thật tính LẠI từ đầu và tự đối chiếu đơn giá.
import type { KetQuaDon } from "./ke-hoach-don";

/** Một dòng đã định giá. `thanhTien` chính là số `OrderItem.unitPrice` phải bằng (số lượng 1). */
export interface DongXemTruoc {
  readonly soBuoi: number;
  readonly loaiMua: "FULL" | "MILESTONE";
  /** Niêm yết tại mốc, trước giảm theo chính sách. */
  readonly niemYet: number;
  /** Phần trăm giảm theo chính sách đã áp (đã kẹp trần). */
  readonly phanTramApDung: number;
  readonly thanhTien: number;
}

export type KetQuaXemTruocPhamVi =
  /** Đơn không đi theo phạm vi (cờ tắt, cơ sở khác, không có dòng 48 buổi…): form giữ giao diện cũ. */
  | { readonly ok: true; readonly kieu: "LEGACY" }
  /** Planner từ chối (đơn trộn, số buổi lẻ, Coach, số lượng ≠ 1, khoản giảm tay…). `thongBao` là câu của máy chủ. */
  | { readonly ok: true; readonly kieu: "REJECT"; readonly thongBao: string }
  /** `dong` cùng thứ tự, cùng độ dài với các dòng gửi lên. */
  | { readonly ok: true; readonly kieu: "SCOPE"; readonly dong: readonly DongXemTruoc[] }
  /** Không tính được (chưa đăng nhập, không quyền, dữ liệu hỏng…). Form KHÔNG đoán: để máy chủ quyết lúc lưu. */
  | { readonly ok: false; readonly error: string };

export function ketQuaXemTruoc(k: KetQuaDon): KetQuaXemTruocPhamVi {
  switch (k.kieu) {
    case "LEGACY":
      return { ok: true, kieu: "LEGACY" };
    case "REJECT":
      return { ok: true, kieu: "REJECT", thongBao: k.thongBao };
    case "SCOPE":
      return {
        ok: true,
        kieu: "SCOPE",
        dong: k.dong.map((d) => ({
          soBuoi: d.soBuoi,
          loaiMua: d.loaiMua,
          niemYet: d.niemYet,
          phanTramApDung: d.pricingSnapshot.phanTramApDung,
          thanhTien: d.thanhTien,
        })),
      };
  }
}
