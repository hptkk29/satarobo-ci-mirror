import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { trangThaiFreeMode } from "@/lib/mobile-api/dich-vu/free-mode";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/free-mode — trạng thái Free của TÀI KHOẢN (suy mỗi lần từ dữ liệu có sẵn; không có «loại tài khoản Free»). Chỉ phụ huynh; chế độ học sinh ⇒ 403; cờ Online tắt ⇒ 404. */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await trangThaiFreeMode(nguoi)));
}
