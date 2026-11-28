import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { datTuyChonThongBao, layTuyChonThongBao, tuyChonSchema } from "@/lib/mobile-api/dich-vu/thiet-bi-push";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/notifications/preferences → { tuyChon:[{danhMuc,bat}] } (5 danh mục; chưa đặt ⇒ bật).
 * PUT { tuyChon:[{danhMuc,bat}] } — bật/tắt PUSH theo danh mục (danh sách trong ứng dụng không bị ẩn). Danh mục lạ/lặp ⇒ 400. Bị chặn trong chế độ học sinh.
 */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await layTuyChonThongBao(nguoi.userId)));
}

export async function PUT(req: Request) {
  return chayChoPhuHuynhCoThan(req, tuyChonSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await datTuyChonThongBao(nguoi.userId, thanDl)));
}
