import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { phuongThucGiaoMobile } from "@/lib/mobile-api/dich-vu/online-giao-hang";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/shipping/methods — phương thức giao + phí theo ĐỊA CHỈ hiện có và tạm tính giỏ. `khaDung:false` ⇒ ẩn/khoá, kèm `lyDo` (CHUA_CO_DIA_CHI | NGOAI_VUNG). */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await phuongThucGiaoMobile(nguoi.userId)));
}
