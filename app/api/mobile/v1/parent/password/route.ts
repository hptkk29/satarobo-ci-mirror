import { chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { doiMatKhau, doiMatKhauSchema } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/parent/password { matKhauHienTai, matKhauMoi } → { accessToken, refreshToken, hetHanSau } — đổi mật khẩu của phụ huynh đang đăng nhập (thiết kế 11 §3.4).
 * Cặp token MỚI chỉ cho thiết bị đang gọi; mọi phiên khác (web + di động) chết. Mật khẩu hiện tại sai ⇒ 400 `PASSWORD_INCORRECT` (không phải 401). Đứng NGOÀI cổng quy định (như Server Action của web).
 * Bị chặn trong chế độ học sinh (không có trong danh sách cho phép).
 */
export async function POST(req: Request) {
  return chayDaDangNhapCoThan(req, doiMatKhauSchema, async (nguoi, ctx, thanDl) => traThanhCong(await doiMatKhau(nguoi, thanDl, ctx)));
}
