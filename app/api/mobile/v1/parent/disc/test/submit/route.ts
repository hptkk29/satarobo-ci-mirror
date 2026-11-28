import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, nopBaiLamBai, nopBaiBody } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/disc/test/submit — nộp bài, MỘT lần cho mỗi vé; nộp lại cùng vé ⇒ trả lại kết quả cũ (lapLai) hoặc 409, KHÔNG ghi thêm. Kết quả do MÁY CHỦ chấm. */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, nopBaiBody, async (nguoi, _ctx, than) => traThanhCong(await nopBaiLamBai(nguoi, than)));
}
