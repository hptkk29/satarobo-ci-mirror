// lib/orders/pham-vi/khoi-ke-hoach.ts — "ĐƠN NÀY CÓ DÙNG KẾ HOẠCH THANH TOÁN NHIỀU ĐỢT KHÔNG" — vị từ DUY NHẤT, THUẦN,
// cho CẢ màn chi tiết đơn (ẩn khối + nút) LẪN máy chủ (từ chối ghi). Hai nơi hỏi một câu, không thể nói hai điều.
//
// ── VÌ SAO TỒN TẠI [13/10/2026, PR "cổng D"] ─────────────────────────────────────────────────────────────────────
// Đo trên test.satarobo.vn: đơn SCOPE tạo bằng form mới (PR6) vẫn hiện khối "Kế hoạch thanh toán" (ô Thu cọc, "Chia
// thành 1·2·3·4 đợt", nút "Lưu kế hoạch") và câu gợi ý "Muốn tách: lập kế hoạch…". Bấm lưu là gọi `recordInstallmentPlan`
// trên một đơn mà mô hình nói thẳng "thu theo số buổi đã chọn, KHÔNG chia nhiều đợt" — hành vi chưa ai kiểm.
//
// ── ĐỌC TỪ DỮ LIỆU, KHÔNG ĐỌC CỜ ─────────────────────────────────────────────────────────────────────────────────
// Dấu SCOPE nằm trên `OrderItem.metadata.phamVi` (`docPhamViDong`), do MÁY CHỦ ghi lúc tạo đơn (client gửi `phamVi` bị
// `boPhamViCuaClient` gỡ ở mọi đường). Đơn đã tạo là SCOPE mãi mãi — tắt cờ `billing.scopePurchaseEnabled` sau đó KHÔNG
// được biến nó thành đơn thường (sale lập kế hoạch 3 đợt cho đơn đã tính tiền theo số buổi). Nên hàm này KHÔNG nhận cờ.
//
// ⚠️ Đơn có MỘT dòng SCOPE là đủ (`laDonPhamVi` = `some`): đơn trộn bị tạo-đơn từ chối (Q17) nên không tồn tại thật;
// nếu có (dữ liệu tay) thì gác phía chặt — thà không cho chia đợt hơn là cho chia một đơn đã có dòng tính theo buổi.
import { laDonPhiHocBu } from "@/lib/hoc-bu/don-phi";
import { laDonPhamVi } from "./doc-dong";

/** Câu từ chối (máy chủ) và nhãn (màn hình) — MỘT chuỗi để hai nơi không thể nói lệch nhau. */
export const LY_DO_DON_PHAM_VI_KHONG_KE_HOACH_DOT = "Đơn theo phạm vi học không dùng kế hoạch thanh toán nhiều đợt.";

export type KhoiKeHoachTrangDon =
  /**
   * Đơn thường (và đơn legacy / không dấu). Từ 20/10/2026 KHÔNG còn khối nhập kế hoạch cho đơn nào (xem
   * `lib/orders/ke-hoach-da-bo.ts`): màn chỉ vẽ bảng CHỈ-XEM các đợt cũ (nếu đơn có) + ghi chú. Trước đó tên là "KE_HOACH".
   */
  | "THUONG"
  /** Đơn phí học bù: một lần, có câu riêng (chốt 29/09/2026). */
  | "PHI_HOC_BU"
  /** Đơn theo phạm vi học: thay khối bằng nhãn trạng thái. */
  | "PHAM_VI";

export interface DongChoKhoiKeHoach {
  readonly type: string;
  readonly metadata: unknown;
}

/** Khối kế hoạch trên trang chi tiết đơn nên ở dạng nào. Phí học bù xét TRƯỚC (đường cũ, không đổi một chữ). */
export function khoiKeHoachTrangDon(items: readonly DongChoKhoiKeHoach[]): KhoiKeHoachTrangDon {
  if (laDonPhiHocBu(items)) return "PHI_HOC_BU";
  if (laDonPhamVi(items)) return "PHAM_VI";
  return "THUONG";
}
