import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { dangKyPushToken, dangKyTokenSchema, huyPushToken, huyTokenSchema } from "@/lib/mobile-api/dich-vu/thiet-bi-push";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/devices/push-token { nenTang:"ios"|"android", nhaCungCap:"FCM"|"APNS", token, phienBanApp? } — ĐĂNG KÝ token push của phiên hiện tại (idempotent).
 * DELETE /api/mobile/v1/devices/push-token { token } — thu hồi token CỦA CHÍNH MÌNH (token lạ vẫn trả bình thường).
 * ⛔ Chưa có FCM/APNs: đây chỉ là sổ đăng ký, KHÔNG có nghĩa «đã gửi push». Token không bao giờ được trả lại / ghi log. Bị chặn trong chế độ học sinh.
 */
export async function POST(req: Request) {
  return chayChoPhuHuynhCoThan(req, dangKyTokenSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await dangKyPushToken(nguoi, thanDl)));
}

export async function DELETE(req: Request) {
  return chayChoPhuHuynhCoThan(req, huyTokenSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await huyPushToken(nguoi, thanDl)));
}
