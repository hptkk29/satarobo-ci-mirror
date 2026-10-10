// lib/bao-luu/feature.ts — NƠI DUY NHẤT ĐỌC công tắc bảo lưu `pause.enabled`.
//
// Cùng khuôn `lib/finance/feature.ts` (và cùng lý do): cờ nằm trong DB để người vận hành bật được và
// `AuditLog` ghi ai bật lúc nào; đọc ở MỘT hàm để "tắt" tắt được MỌI chỗ chứ không 9 trong 10.
//
// Hình dạng (chốt 07/10): `SystemSetting pause.enabled` mặc định TẮT + `CenterSetting` lệch theo từng cơ sở —
// bật thí điểm một cơ sở khi toàn hệ tắt, hoặc gỡ một cơ sở khi toàn hệ bật.
//
// ⚠️ `orgUnitId`, KHÔNG `centerId`: `CenterSetting` khoá theo `OrgUnit.id`; truyền `Center.id` thì tra không
// ra dòng nào và hàm âm thầm rơi về giá trị toàn hệ — cờ riêng của cơ sở không có tác dụng mà không lỗi nào báo.
//
// Tắt ⇒ nút ẨN **và** server action TỪ CHỐI (luật 8). Hai nửa cùng hỏi hàm này; cổng action dùng
// `canBaoLuuBat` để có câu từ chối thống nhất.
import "server-only";
import { getSetting } from "@/lib/settings/service";
import { KHOA_CONG_TAC_BAO_LUU } from "@/lib/bao-luu/hang-so";

export async function laBaoLuuBat(orgUnitId?: string | null): Promise<boolean> {
  return await getSetting(KHOA_CONG_TAC_BAO_LUU, { orgUnitId: orgUnitId ?? null });
}

/** Câu từ chối thống nhất khi công tắc tắt. */
export const LOI_BAO_LUU_TAT = "Chức năng bảo lưu chưa được bật cho cơ sở này.";

/** `null` = được phép; chuỗi = lý do từ chối. Dùng đầu mọi server action bảo lưu MỚI. */
export async function chanNeuBaoLuuTat(orgUnitId?: string | null): Promise<string | null> {
  return (await laBaoLuuBat(orgUnitId)) ? null : LOI_BAO_LUU_TAT;
}

/**
 * Có CƠ SỞ NÀO trong danh sách đang bật bảo lưu không. Danh sách rỗng ⇒ đọc công tắc toàn hệ.
 *
 * ⚠️ Chỉ dùng cho AFFORDANCE và cổng của đường KHÔNG gắn với một hồ sơ cụ thể (ký URL tải tệp, vẽ nút). Cổng
 * của thao tác GHI lên một hồ sơ phải hỏi `laBaoLuuBat(orgUnitId của hồ sơ)` — rộng hơn ở đường ghi là lỗ.
 * Không ngắt sớm bằng công tắc toàn hệ: "toàn hệ BẬT + cơ sở này TẮT" có thật (gỡ một cơ sở khi gặp sự cố).
 */
export async function coNoiNaoBatBaoLuu(orgUnitIds: readonly string[]): Promise<boolean> {
  if (orgUnitIds.length === 0) return laBaoLuuBat(null);
  for (const id of orgUnitIds) {
    if (await laBaoLuuBat(id)) return true;
  }
  return false;
}
