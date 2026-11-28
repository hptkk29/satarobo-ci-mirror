import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, batDauLamBai, phatDeBody } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/disc/test/start — P-Disc-lam-bai: phát đề (hoặc làm tiếp đề dở). Bộ đề do máy chủ định tuyến theo tuổi/lớp. */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, phatDeBody, async (nguoi, _ctx, than) => traThanhCong(await batDauLamBai(nguoi, than)));
}
