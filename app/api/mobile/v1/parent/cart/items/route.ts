import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { themDongGioMobile, themDongGioSchema } from "@/lib/mobile-api/dich-vu/online-gio";

export const dynamic = "force-dynamic";

/**
 * POST /parent/cart/items { khoaId, studentId, maGiamGia?, revision? } — THÊM một dòng (khoá Online × con). `.strict()`: số tiền/loại/đơn giá/productId ⇒ 400.
 * Cùng cổng với tạo đơn (sai con 404 · khoá không bán/đã trọn đời/tiên quyết/mã lạ ⇒ từ chối ngay). Khoá OFFLINE ⇒ 409 `LOAI_SAN_PHAM_CHUA_HO_TRO`. Thêm lại cùng cặp ⇒ `daCo:true`.
 */
export async function POST(req: Request) {
  return chayChoPhuHuynhCoThan(req, themDongGioSchema, async (nguoi, _ctx, than) => traThanhCong(await themDongGioMobile(nguoi.userId, than)));
}
