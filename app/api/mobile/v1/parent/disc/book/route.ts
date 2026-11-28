import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, taoSoGiaDinh, taoSoBody } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/disc/book — lập sổ gia đình (mỗi tài khoản một sổ; lần hai ⇒ 409). Chủ sổ = người đăng nhập. */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, taoSoBody, async (nguoi, _ctx, than) => traThanhCong(await taoSoGiaDinh(nguoi.userId, than)));
}
