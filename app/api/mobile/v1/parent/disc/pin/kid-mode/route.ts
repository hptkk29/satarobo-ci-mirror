import { z } from "zod";

import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, cheDoTreEmSo } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/parent/disc/pin/kid-mode — CHẾ ĐỘ TRẺ EM `{thanhVienId}`: hạ phiên mở khoá xuống «chỉ làm bài của MỘT thành viên» (start/draft/submit của đúng người đó).
 * Cần phiên ĐẦY ĐỦ còn hiệu lực. Thoát = `POST /pin/verify` lại (phiên đầy đủ mới). Cờ ép máy chủ TẮT ⇒ 403 `DISC_KHONG_DU_QUYEN`.
 */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, z.unknown(), async (nguoi, _ctx, than) => traThanhCong(await cheDoTreEmSo(nguoi, than)));
}
