import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, docKeHoach, keHoachQuery, taoKeHoachBody, taoKeHoachSo } from "@/lib/mobile-api/dich-vu/disc";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/disc/plan?tab=&ngay=&tuan=&plan= — P-Disc-ke-hoach: ba kỳ đang chạy + hoạt động đã kiểm + check-in. Tham số lạ ⇒ 400. */
export async function GET(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynh(req, async (nguoi) => {
    const tho: Record<string, string> = {};
    for (const [k, v] of new URL(req.url).searchParams) tho[k] = v;
    const p = keHoachQuery.safeParse(tho);
    if (!p.success) throw new LoiApiMobile("VALIDATION", 400, "Tham số kế hoạch không hợp lệ.");
    return traThanhCong(await docKeHoach(nguoi, p.data));
  });
}

/** POST /api/mobile/v1/parent/disc/plan — tạo kế hoạch (kỳ + ngày bắt đầu, từ hôm nay tới 31 ngày sau). Kế hoạch cùng kỳ đang chạy bị thay. */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, taoKeHoachBody, async (nguoi, _ctx, than) => traThanhCong(await taoKeHoachSo(nguoi, than)));
}
