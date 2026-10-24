// app/(portal)/portal/thong-bao/_actions.ts — đánh dấu phụ huynh ĐÃ ĐỌC thông báo.
//
// Vì sao có file này (04/09/2026): `Notification` không hề có trạng thái đã đọc, nên
// badge chuông portal là hàm của THỜI GIAN chứ không của việc đọc — phụ huynh mở tin
// ra xem xong con số (1) vẫn nằm đó. Xem `lib/portal/notifications.ts`.
"use server";

import { refresh, revalidatePath, updateTag } from "next/cache";

import { theBadgeThongBao } from "@/lib/portal/notification-feed";
import { getPortalContext } from "@/lib/portal/session";
import { danhDauDaDoc } from "@/lib/portal/feed-read";

/**
 * Đánh dấu các thông báo ĐANG HIỆN trên trang là đã đọc.
 *
 * Ghi ở Server Action chứ không ghi thẳng trong lúc dựng trang: RSC có thể chạy lại
 * nhiều lần cho một lượt xem, và ghi dữ liệu trong lúc render là thứ Next không hứa
 * chạy đúng một lần.
 *
 * Trả về số dòng MỚI thêm để nơi gọi biết có cần làm mới badge không — lần mở thứ hai
 * trả 0 nên không đẻ vòng làm mới vô tận.
 */
export async function danhDauDaDocAction(
  ids: string[],
): Promise<{ ok: boolean; soMoi: number }> {
  // Cổng chung của portal: `getPortalContext` tự trả null cho người không phải phụ
  // huynh. Dùng nó thay vì so `session.user.role` — luật `no-inline-authz` cấm viết
  // điều kiện quyền thẳng trong Server Action.
  //
  // Id người dùng lấy từ PHIÊN (`ctx.parentUserId`), không bao giờ nhận từ client:
  // nếu nhận thì ai cũng đánh dấu đã đọc hộ người khác được.
  const ctx = await getPortalContext();
  if (!ctx) return { ok: false, soMoi: 0 };
  // Chặn payload rác: id là cuid, và một trang chỉ in tối đa 100 tin.
  const sach = ids
    .filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64)
    .slice(0, 100);
  if (sach.length === 0) return { ok: true, soMoi: 0 };

  // KHÔNG kiểm "mục này có thuộc phạm vi phụ huynh không": đánh dấu nhầm một id lạ
  // chỉ tạo một dòng vô hại cho chính họ, trong khi kiểm lại tốn một vòng truy vấn
  // trên đường chạy mỗi lần mở trang. Bảng tin vẫn lọc theo phạm vi nên không rò gì.
  const soMoi = await danhDauDaDoc(ctx.parentUserId, sach);
  if (soMoi === 0) return { ok: true, soMoi: 0 };

  // Badge chuông nằm ở LAYOUT chứ không ở trang này ⇒ `router.refresh()` bên client
  // một mình KHÔNG đủ (đo 04/09: ghi xong 10 dòng mà badge vẫn đứng ở số 2).
  revalidatePath("/portal", "layout");
  // Badge của portal v2 — BẢN PROD ĐANG CHẠY — còn nằm sau `unstable_cache` TTL 60s;
  // không xóa thẻ thì nó đứng nguyên tới một phút sau khi phụ huynh đã đọc.
  // `updateTag` chứ không `revalidateTag`: Next 16 khắng định hàm này chỉ gọi được
  // trong Server Action và cho nghĩa "đọc lại được thứ mình vừa ghi" — đúng thứ cần ở
  // đây, trong khi `revalidateTag` chỉ đánh dấu hết hạn cho lượt sau.
  // Thẻ THEO TỪNG phụ huynh — xoá đúng bản của họ, không đụng cache của người khác.
  updateTag(theBadgeThongBao(ctx.parentUserId));
  // Làm mới luôn bản cache PHÍA CLIENT — badge nằm ở layout, mà layout thuộc phần
  // client router cache mà `revalidatePath` một mình không đụng tới.
  refresh();
  return { ok: true, soMoi };
}
