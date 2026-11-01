// lib/ads/center-codes.ts — danh mục mã cơ sở cho các hàm THUẦN của khu vực D/G.
//
// `parseCenterCodeFromCampaignName` (D-06) cố ý KHÔNG đọc DB và KHÔNG chôn danh sách
// mã trong mã nguồn — "mở cơ sở mới = thêm dữ liệu, không sửa code". Chỗ nào cần gọi
// nó thì phải tự nạp danh mục, và nạp ở đây để chỉ có MỘT câu truy vấn thay vì mỗi
// call-site tự viết một kiểu (rồi có chỗ quên `toUpperCase`, có chỗ quên lọc `null`).
//
// Cố ý KHÔNG cache: danh mục cơ sở đổi rất hiếm, còn một cache sai sau khi mở cơ sở
// mới sẽ đẩy toàn bộ chi tiêu/lead của cơ sở đó vào nhóm "CHƯA PHÂN BỔ" cho tới lần
// deploy kế tiếp — im lặng và khó truy hơn nhiều so với một câu SELECT nhỏ.
import { db } from "@/lib/db";

/**
 * Mã cơ sở đang có, viết HOA (khớp cách `parseCenterCodeFromCampaignName` chuẩn hoá
 * tiền tố). Cơ sở chưa đặt mã (`Center.code = null`) bị bỏ qua — không có mã thì
 * không có gì để so.
 */
export async function loadKnownCenterCodes(): Promise<Set<string>> {
  const rows = await db.center.findMany({
    where: { code: { not: null } },
    select: { code: true },
  });
  return new Set(rows.map((r) => r.code!.trim().toUpperCase()).filter((c) => c !== ""));
}
