import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { layQuyDinh } from "@/lib/mobile-api/dich-vu/quy-dinh";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/policy — văn bản «Quy định đào tạo» đang phát hành. Cổng C−QĐ: không đòi đã đồng ý (đây chính là màn để đồng ý). */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async () => traThanhCong(layQuyDinh()));
}
