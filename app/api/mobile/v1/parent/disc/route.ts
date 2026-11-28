import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, docTongQuan } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/disc — P-Disc (tab «Gia đình»): chưa có sổ ⇒ `{ coSo:false }`; có sổ ⇒ view-model của web. Cờ DISC_ENABLED TẮT ⇒ 404. Chế độ học sinh ⇒ 403. */
export async function GET(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await docTongQuan(nguoi)));
}
