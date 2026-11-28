import { docThanJson, motMobileTat, nguCanhYeuCau, traLoi, traThanhCong } from "@/lib/mobile-api/cong";
import { dangXuatSchema } from "@/lib/mobile-api/schema/auth";
import { dangXuat } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/auth/logout — `{refreshToken}` → `{}`. KHÔNG đòi access token (nó hết hạn sau 15 phút, mà người dùng thường đăng xuất sau khi
 * app nằm nền lâu hơn thế). Yêu cầu đúng lược đồ luôn nhận 200 dù token còn hiệu lực hay không: đăng xuất không phải phép thử token.
 */
export async function POST(req: Request) {
  const tat = motMobileTat();
  if (tat) return tat;
  const than = await docThanJson(req, dangXuatSchema);
  if (!than.ok) return than.res;
  try {
    await dangXuat(than.data.refreshToken, nguCanhYeuCau(req));
    return traThanhCong({});
  } catch (e) {
    return traLoi(e);
  }
}
