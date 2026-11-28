import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { danhSachPhien } from "@/lib/mobile-api/dich-vu/phien-dang-nhap";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/auth/sessions — các thiết bị ĐANG đăng nhập của chính người dùng `{phien:[{id,nenTang,tenMay,phienBanApp,dangNhapLuc,lanDungCuoi,laThietBiNay}]}` (SEC-05). */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async (nguoi, ctx) => traThanhCong(await danhSachPhien(nguoi, ctx.now)));
}
