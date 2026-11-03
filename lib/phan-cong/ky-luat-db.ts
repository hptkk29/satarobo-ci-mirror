// lib/phan-cong/ky-luat-db.ts — đọc CỜ THEO KỲ của luật công Parttime mới (GĐ6, chốt 8). MỘT chỗ đọc; mọi luật thuần nhận giá trị đã đọc
// (`luatKy(periodKey, tuKy)`) — không hàm thuần nào tự đọc cài đặt.
import "server-only";
import { getSetting } from "@/lib/settings/service";

/** Cài đặt thô ("YYYY-MM-DD" / "YYYY-MM"), hoặc null = luật mới TẮT. Chuẩn hoá + sàn 01/11/2026 ở `ngayBatDauLuatMoi`. */
export async function docKyLuatMoi(): Promise<string | null> {
  const v = await getSetting("shift.parttimeLuatCongMoiTuKy");
  return v ? v : null;
}
