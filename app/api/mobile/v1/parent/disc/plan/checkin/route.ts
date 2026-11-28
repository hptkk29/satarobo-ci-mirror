import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, luuCheckinSo, checkinBody } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/disc/plan/checkin — check-in tuần của kế hoạch đang chạy. */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, checkinBody, async (nguoi, _ctx, than) => traThanhCong(await luuCheckinSo(nguoi, than)));
}
