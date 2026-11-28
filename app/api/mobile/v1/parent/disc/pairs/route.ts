import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, docTheCap, theCapQuery } from "@/lib/mobile-api/dich-vu/disc";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/disc/pairs?a=&b= — P-Disc-cap («Thẻ cặp»): ma trận hai chiều + thẻ của cặp a→b (mặc định: cặp cần chú ý nhất). */
export async function GET(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynh(req, async (nguoi) => {
    const tho: Record<string, string> = {};
    for (const [k, v] of new URL(req.url).searchParams) tho[k] = v;
    const p = theCapQuery.safeParse(tho);
    if (!p.success) throw new LoiApiMobile("VALIDATION", 400, "Tham số thẻ cặp không hợp lệ.");
    return traThanhCong(await docTheCap(nguoi, p.data));
  });
}
