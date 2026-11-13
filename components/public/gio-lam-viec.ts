import { operationalLocations } from "@/lib/locations";

/**
 * Giờ làm việc để in trong chữ tiếp thị của form / popup / trang Liên hệ — lấy từ `lib/locations`
 * (cơ sở mặc định = trụ sở kinh doanh), KHÔNG gõ cứng. Giờ thật: Thứ 3 – Chủ nhật, 8:00 – 21:00
 * (chủ dự án chốt 08/11/2026; bản "T2 - T7: 8:00 - 20:00" trước đó SAI). Ghim bởi `[GIO-01]` +
 * `[GIO-02]` (lib/locations.test.ts).
 */
export const GIO_LAM_VIEC: string = (
  operationalLocations().find((l) => l.isHQ) ?? operationalLocations()[0]
)?.workingHours ?? "";

/** Câu cam kết phản hồi dùng chung cho form, popup và lời cảm ơn. */
export const CAU_PHAN_HOI = `Phản hồi trong vòng 30 phút trong giờ làm việc (${GIO_LAM_VIEC})`;
