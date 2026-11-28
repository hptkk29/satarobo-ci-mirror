import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, docLuaChonLamBai } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/disc/test/options — P-Disc-chon: mỗi người của sổ + hai cách làm có dùng được không (kèm lý do) + bản nháp dở + lịch sử các lần làm. */
export async function GET(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await docLuaChonLamBai(nguoi)));
}
