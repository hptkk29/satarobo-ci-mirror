import "server-only";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { QUYEN_DUYET_DON, WHERE_CHO_DUYET } from "@/lib/orders/cho-duyet";

/**
 * "Người này có duyệt đơn được không" và "còn mấy đơn chờ" — HAI câu hỏi, MỘT nơi trả lời.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TÁCH RA [25/09/2026]
 *
 * Chủ dự án: *"ẩn list chờ duyệt đi, làm 1 màn trong màn đơn hàng, khi bấm nút đơn hàng
 * cần duyệt thì mới hiển thị ra để duyệt"*.
 *
 * Từ nay hai chỗ cùng hỏi: cái NÚT trên màn danh sách (cần con số + có được bấm không)
 * và chính MÀN DUYỆT (cần danh sách). Nếu mỗi chỗ tự hỏi theo cách riêng thì có ngày nút
 * hiện "3 đơn" mà bấm vào ra màn trống — hoặc tệ hơn, nút không hiện trong khi vẫn có đơn
 * nằm chờ, tức người duyệt không bao giờ biết. Cùng lớp lỗi "hai nguồn cho một sự thật"
 * mà repo đã trả giá ở nội dung CK.
 */

/**
 * Có ÍT NHẤT MỘT quyền duyệt.
 *
 * ⚠️ Gọi KHÔNG kèm `target` (chưa có đơn nào ⇒ chưa có `centerId`) — an toàn vì các action
 * đều seed GLOBAL ở mọi vai giữ chúng. Cách ly cơ sở do `scopedDb` lo ở câu tra.
 *
 * ⚠️ Danh sách quyền đọc từ `QUYEN_DUYET_DON`, KHÔNG gõ lại [gom 25/09/2026]. Hai chuỗi
 * gõ tay ở đây là bản sao thứ ba của cùng một danh sách.
 */
export async function duocDuyetDon(): Promise<boolean> {
  return checkAnyPermission(QUYEN_DUYET_DON);
}

/**
 * Số đơn đang chờ duyệt TRONG TẦM NHÌN của người này.
 *
 * ⚠️ `scopedDb` là thứ giữ cho con số nói đúng: Quản lý cơ sở 1 không được đếm đơn của
 * cơ sở 2. Đếm bằng `db` trần ở đây là cho họ một con số của người khác — và họ sẽ bấm
 * vào rồi thấy ít hơn, không hiểu vì sao.
 *
 * ⚠️ Dùng CHUNG `WHERE_CHO_DUYET` với màn duyệt và với cờ trên từng dòng bảng
 * (`lib/orders/cho-duyet.ts`). Gõ lại điều kiện ở đây là bản định nghĩa thứ ba.
 */
export async function demDonChoDuyet(actor: Actor): Promise<number> {
  return scopedDb(actor).order.count({
    where: { deletedAt: null, ...WHERE_CHO_DUYET },
  });
}
