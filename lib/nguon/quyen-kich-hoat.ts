/**
 * lib/nguon/quyen-kich-hoat.ts — người đang đăng nhập CÓ `commission_policies:activate` không (hỏi qua `can()` → `checkPermission`, KHÔNG so vai).
 *
 * Vì sao tách khỏi `_actions.ts`: Server Action `suaNguonAction` gác bằng ĐÚNG MỘT khoá (`sources:manage`) ở đầu hàm — lưới `[NHH-H-GATE-02]` ghim "khoá của action = khoá cổng". `commission_policies:activate`
 * ở đây KHÔNG phải cổng của action (người chỉ có `sources:manage` vẫn sửa được tên/mô tả/thứ tự) mà là CỜ cho cổng ghi quyết định lượt ghi nào đụng tới ai-nhận-tiền (res4 HIGH-1, 09/10/2026). Từ W2
 * (10/10/2026) cả BỐN đường ghi — `taoNguonAction` · `suaNguonAction` · `doiTrangThaiNguonAction` · `luuPageMappingAction` — hỏi cờ này MỘT lần và truyền vào dịch vụ (lưới `[DYN-CC-W3]`). Để hai thứ trong cùng một thân hàm là để lưới đọc nhầm cờ thành cổng, hoặc người sau thấy hai `checkPermission` mà nghĩ cả hai đều là cổng.
 */
import { checkPermission } from "@/lib/auth/check-permission";

export const KHOA_QUYEN_KICH_HOAT_CHINH_SACH = "commission_policies:activate";

export function coQuyenKichHoatChinhSach(): Promise<boolean> {
  return checkPermission(KHOA_QUYEN_KICH_HOAT_CHINH_SACH);
}
