import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { layMe } from "@/lib/mobile-api/dich-vu/me";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/auth/me — hồ sơ phụ huynh + danh sách con CHỈ của người gọi (mã phụ huynh lấy từ phiên, không từ client). */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await layMe(nguoi.userId)));
}
