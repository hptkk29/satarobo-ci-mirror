import { z } from "zod";

import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { chanNeuDiscTat, khoaLaiSo } from "@/lib/mobile-api/dich-vu/disc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/parent/disc/pin/lock — KHOÁ LẠI: thu hồi phiên mở khoá DISC của phiên đăng nhập này. Thân `{}`. Idempotent (không có phiên ⇒ `soPhien:0`). */
export async function POST(req: Request) {
  const tat = chanNeuDiscTat();
  if (tat) return tat;
  return chayChoPhuHuynhCoThan(req, z.object({}).strict(), async (nguoi) => traThanhCong(await khoaLaiSo(nguoi)));
}
