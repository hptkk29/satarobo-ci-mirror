// lib/hoa-hong/feature.ts — NƠI DUY NHẤT ĐỌC CỜ ENGINE HOA HỒNG MỚI (`hoaHong.engineBat`).
//
// Khuôn `lib/finance/hoa-don/feature.ts`: cờ trong DB, mặc định TẮT, người vận hành bật được và có
// AuditLog. Lưới `[NHH-FLG-11b]` đếm số chỗ nhắc chuỗi khoá ngoài tệp này = 0.
//
// Đặc tả: docs/source-commission/05 §2.2–§2.3. Cờ này ĐỘC LẬP với `nguon.enabled` (hai cờ riêng): ghi
// attribution (nguồn) có thể chạy khi engine tắt — đó chính là giai đoạn pilot nguồn.
//
// ⚠️ Cờ gác ENGINE MỚI (cron quét theo kỳ ghi sổ mới) + màn Chính sách/Sổ/Kỳ/Khiếu nại. TẮT thì engine
// không ghi gì, KHÔNG mở lại sổ cũ. Mốc kỳ cutover (`hoaHong.kyCutover`) KHÔNG nằm ở đây — thuộc PR5c,
// chỉ ghi qua action riêng có cổng DB (05 §2.2c). Đừng thêm nó vào tệp này như một cờ thường.

import { getSetting } from "@/lib/settings/service";

export const KHOA_ENGINE_HOA_HONG = "hoaHong.engineBat" as const;
export const KHOA_XUAT_LUONG = "hoaHong.xuatLuongBat" as const;

/** Engine hoa hồng mới có đang bật không (toàn hệ — không có công tắc theo cơ sở). */
export async function laEngineHoaHongBat(): Promise<boolean> {
  return await getSetting(KHOA_ENGINE_HOA_HONG);
}

/**
 * Có cho XUẤT bảng chi / ĐÁNH DẤU ĐÃ CHI không (05 §2.2: "BẬT thì nút xuất payroll + trạng thái EXPORTED/PAID; TẮT thì kỳ dừng ở LOCKED").
 * Độc lập với `hoaHong.engineBat`. MỘT hàm cho cả hai nơi hỏi — nút trên màn Kỳ (`ky-man-hinh`) và cổng ở Server Action (`ky-hanh-dong`): hỏi hai
 * nơi bằng hai câu thì có ngày nút vẽ ra mà server từ chối, hoặc server cho qua mà không có nút (luật 12b).
 */
export async function laXuatLuongBat(): Promise<boolean> {
  return await getSetting(KHOA_XUAT_LUONG);
}
