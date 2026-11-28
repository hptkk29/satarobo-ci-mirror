import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { docQuaTang } from "@/lib/mobile-api/dich-vu/qua-tang";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/gifts — hộp «Quà tặng» (P-Qua-tang): các quà miễn phí ĐANG MỞ (DISC · Sức khoẻ · Tủ sách) + số khuyến mãi + cờ Thu nhập. Cấp phụ huynh (dùng được khi CHƯA có học viên). Chế độ học sinh ⇒ 403 (mặc định từ chối). */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await docQuaTang(nguoi.userId)));
}
