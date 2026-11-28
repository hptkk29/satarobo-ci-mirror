import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, luuBanNhap, luuNhapBody } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/disc/test/draft — lưu bản nháp câu trả lời (theo vị trí câu). Vé không khớp bản nháp / hết hạn ⇒ 409. */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, luuNhapBody, async (nguoi, _ctx, than) => traThanhCong(await luuBanNhap(nguoi, than)));
}
