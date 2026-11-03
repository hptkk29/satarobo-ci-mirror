// lib/parttime/quyen-don-gia.ts — quyền của danh mục tính lương "Đơn giá Parttime" (Chấm công → Cấu hình), MỘT chỗ (24/10/2026).
// Tab trong `ConfigTabs` và chính trang `/cham-cong/don-gia-parttime` hỏi ĐÚNG hàm này — tab hiện mà trang từ chối là lời hứa suông (luật 12).
//   · xem  = `parttime_rank:view` ở một cơ sở trong phạm vi (scope CENTER ⇒ hỏi kèm cơ sở) HOẶC `parttime_policy:manage`;
//   · sửa  = `parttime_policy:manage` (đặt chính sách hỗ trợ Trial). Bảng đơn giá SR.QD.238 không sửa ở đây — đổi giá là ban hành
//            phiên bản chính sách mới.
import "server-only";
import { checkPermission } from "@/lib/auth/check-permission";

export async function quyenDonGia(centerIds: readonly string[]): Promise<{ xem: boolean; sua: boolean; coSoXem: string[] }> {
  const [sua, xemTai] = await Promise.all([
    checkPermission("parttime_policy:manage"),
    Promise.all(centerIds.map((c) => checkPermission("parttime_rank:view", { centerId: c }))),
  ]);
  const coSoXem = centerIds.filter((_, i) => xemTai[i]);
  return { xem: sua || coSoXem.length > 0, sua, coSoXem };
}
