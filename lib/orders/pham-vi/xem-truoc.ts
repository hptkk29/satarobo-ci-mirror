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
  /** Phần nền (mốc buổi / gói trọn) trong `phanTramApDung`. Form chỉ HIỆN, không tính lại. [20/10/2026] */
  readonly phanTramNen: number;
  /** Phần cộng thêm (anh/chị/em trong đơn) trong `phanTramApDung`; 0 = không có. [20/10/2026] */
  readonly phanTramCongThem: number;
  /** Thứ hạng con trong đơn (1 = con thứ nhất) — để dòng chính sách nói "con thứ hai". [20/10/2026] */
  readonly thuTuCon: number;
  readonly thanhTien: number;
}

/**
 * Ngưỡng của CƠ SỞ ĐƠN mà form cần để báo trước "vượt trần" / "đơn sẽ chờ duyệt" bằng đúng phép tính máy chủ dùng [20/10/2026].
 * Máy chủ đọc bằng `getSetting(khoá, { orgUnitId })` — form KHÔNG tự đọc cài đặt và không biết khoá nào (cùng nguyên tắc với cờ phạm vi).
 */
export interface NguongXemTruoc {
  /** `billing.scopeMaxDiscountPercent` của cơ sở đơn: trần TỔNG % giảm của một dòng SCOPE, tính trên niêm yết. */
  readonly tranGiamPhamVi: number;
  /** `orders.maxInstallments` — chỉ để gọi `xetDuyetDon` (form không có kế hoạch đợt nào để đếm). */
  readonly tranSoDot: number;
  /** `orders.maxDiscountItems` của cơ sở đơn. */
  readonly tranUuDaiMoiDong: number;
  /** `orders.maxDiscountPercent`: trần từng khoản, vẫn áp thêm cho từng khoản trên dòng SCOPE. */
  readonly tranTungKhoan: number;
}

export type KetQuaXemTruocPhamVi =
  /** Đơn không đi theo phạm vi (cờ tắt, cơ sở khác, không có dòng 48 buổi…): form giữ giao diện cũ. */
  | { readonly ok: true; readonly kieu: "LEGACY" }
  /** Planner từ chối (đơn trộn, số buổi lẻ, Coach, số lượng ≠ 1…). `thongBao` là câu của máy chủ. */
  | { readonly ok: true; readonly kieu: "REJECT"; readonly thongBao: string }
  /** `dong` cùng thứ tự, cùng độ dài với các dòng gửi lên. */
  | { readonly ok: true; readonly kieu: "SCOPE"; readonly dong: readonly DongXemTruoc[]; readonly nguong: NguongXemTruoc }
  /** Không tính được (chưa đăng nhập, không quyền, dữ liệu hỏng…). Form KHÔNG đoán: để máy chủ quyết lúc lưu. */
  | { readonly ok: false; readonly error: string };

/**
 * `nguong` BẮT BUỘC (luật 7) và chỉ được `null` khi kết quả không phải SCOPE: kết quả SCOPE mà thiếu ngưỡng thì form không báo trước được
 * "vượt trần"/"chờ duyệt" — ném lỗi lập trình thay vì trả một kết quả thiếu im lặng.
 */
export function ketQuaXemTruoc(k: KetQuaDon, nguong: NguongXemTruoc | null): KetQuaXemTruocPhamVi {
  switch (k.kieu) {
    case "LEGACY":
      return { ok: true, kieu: "LEGACY" };
    case "REJECT":
      return { ok: true, kieu: "REJECT", thongBao: k.thongBao };
    case "SCOPE":
      if (nguong === null) throw new Error("ketQuaXemTruoc: kết quả SCOPE thiếu ngưỡng của cơ sở");
      return {
        ok: true,
        kieu: "SCOPE",
        nguong,
        dong: k.dong.map((d) => ({
          soBuoi: d.soBuoi,
          loaiMua: d.loaiMua,
          niemYet: d.niemYet,
          phanTramApDung: d.pricingSnapshot.phanTramApDung,
          phanTramNen: d.pricingSnapshot.phanTramNen,
          phanTramCongThem: d.pricingSnapshot.phanTramCongThem,
          thuTuCon: d.pricingSnapshot.thuTuCon,
          thanhTien: d.thanhTien,
        })),
      };
  }
}
