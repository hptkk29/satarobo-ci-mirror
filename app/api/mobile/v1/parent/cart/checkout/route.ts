import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { datHangGioMobile, datHangGioSchema } from "@/lib/mobile-api/dich-vu/online-gio";

export const dynamic = "force-dynamic";

/**
 * POST /parent/cart/checkout { revision, itemIds? } — ĐẶT HÀNG TỪ GIỎ. `.strict()`: KHÔNG có số tiền. Giá/mã/tiên quyết do máy chủ tính lại (lõi `taoDonOnline`).
 * Thành công: cùng dạng `POST /parent/online-orders` + `gio` còn lại; dòng đã đặt bị xoá nguyên tử cùng đơn. Bấm đúp cùng `revision` ⇒ đơn cũ (`daCo:true`).
 * Lỗi ⇒ KHÔNG xoá dòng, KHÔNG đổi revision. Lệch revision ⇒ 409 `GIO_DA_THAY_DOI` (app GET lại).
 */
export async function POST(req: Request) {
  return chayChoPhuHuynhCoThan(req, datHangGioSchema, async (nguoi, _ctx, than) => traThanhCong(await datHangGioMobile(nguoi.userId, than)));
}
