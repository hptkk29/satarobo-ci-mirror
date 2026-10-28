// lib/phan-cong/ky-luat-db.ts — đọc CỜ THEO KỲ của luật công Parttime mới (GĐ6, chốt 8). MỘT chỗ đọc; mọi luật thuần nhận giá trị đã đọc
// (`luatKy(periodKey, tuKy)`) — không hàm thuần nào tự đọc cài đặt.
import "server-only";
import { getSetting } from "@/lib/settings/service";

/** "YYYY-MM" kỳ đầu đi luật mới, hoặc null = luật mới TẮT (cài đặt rỗng). Sàn 2026-11 áp ở `luatKy`. */
export async function docKyLuatMoi(): Promise<string | null> {
  const v = await getSetting("shift.parttimeLuatCongMoiTuKy");
  return v ? v : null;
}
