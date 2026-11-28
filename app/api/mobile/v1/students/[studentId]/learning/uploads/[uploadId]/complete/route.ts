import { z } from "zod";

import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { xacMinhVe } from "@/lib/mobile-api/dich-vu/tai-len";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/learning/uploads/:uploadId/complete {} — BÁO ĐÃ TẢI XONG: máy chủ XÁC MINH cỡ + loại + định dạng; sai ⇒ xoá tệp + 422 `TEP_KHONG_HOP_LE`. Idempotent. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; uploadId: string }> }) {
  const { studentId, uploadId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, z.strictObject({}), async (hs, nguoi, c) => traThanhCong(await xacMinhVe(hs, nguoi.userId, uploadId, c.now)));
}
