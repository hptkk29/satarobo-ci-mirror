import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { diaChiSchema, luuDiaChiMobile, xemDiaChiMobile } from "@/lib/mobile-api/dich-vu/online-giao-hang";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/shipping/profile — địa chỉ nhận hàng. LUÔN 200: chưa có ⇒ `{ daCo:false, goiY }` (gợi ý từ hồ sơ, KHÔNG tự lưu). */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await xemDiaChiMobile(nguoi.userId)));
}

/** PUT — lưu địa chỉ nhận hàng (thân strict đủ 5 trường). Sai ⇒ 422 DIA_CHI_KHONG_HOP_LE kèm `truong`. */
export async function PUT(req: Request) {
  return chayChoPhuHuynhCoThan(req, diaChiSchema, async (nguoi, _ctx, than) => traThanhCong(await luuDiaChiMobile(nguoi.userId, than)));
}
