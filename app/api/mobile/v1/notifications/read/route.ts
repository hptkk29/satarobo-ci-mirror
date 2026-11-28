import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { danhDauThongBaoDaDoc } from "@/lib/mobile-api/dich-vu/thong-bao";
import { danhDauDaDocSchema } from "@/lib/mobile-api/schema/auth";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/notifications/read — `{ids}` → `{daGhi}`. Chỉ ghi id THẬT có trong feed của người gọi (idempotent, mốc đọc lần đầu được giữ). Cổng C. */
export async function POST(req: Request) {
  // Cờ tắt ⇒ 404 TRƯỚC khi đọc thân yêu cầu (không lộ rằng endpoint tồn tại / lược đồ dữ liệu).
  return chayChoPhuHuynhCoThan(req, danhDauDaDocSchema, async (nguoi, _ctx, thanDl) => traThanhCong({ daGhi: await danhDauThongBaoDaDoc(nguoi.userId, thanDl.ids) }));
}
