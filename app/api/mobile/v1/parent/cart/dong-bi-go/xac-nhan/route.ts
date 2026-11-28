import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { xacNhanDongBiGoMobile, xacNhanDongBiGoSchema } from "@/lib/mobile-api/dich-vu/online-gio";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/parent/cart/dong-bi-go/xac-nhan { ids? } — phụ huynh ĐÃ XEM các dòng bị hệ thống gỡ khỏi giỏ (V8.42, G16). Bỏ trống `ids` = tất cả. Idempotent;
 * KHÔNG đổi `revision` (không đổi dòng nào). Trả `{ soDaXacNhan, gio }`. Student Mode ⇒ 403; cờ Online tắt ⇒ 404; thân lạ ⇒ 400.
 */
export async function POST(req: Request) {
  return chayChoPhuHuynhCoThan(req, xacNhanDongBiGoSchema, async (nguoi, _ctx, than) => traThanhCong(await xacNhanDongBiGoMobile(nguoi.userId, than)));
}
