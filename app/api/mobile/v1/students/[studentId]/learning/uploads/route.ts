import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { xinVe, xinVeSchema } from "@/lib/mobile-api/dich-vu/tai-len";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/students/:studentId/learning/uploads — XIN VÉ TẢI LÊN (kho riêng, URL ký ngắn hạn).
 * Body strict: { mucDich:"bai_nop", khoaGuiLai, baiTapId, tenTep, loaiMime, kichThuoc } | { mucDich:"bai_thi", khoaGuiLai, luotId, cauHoiId, tenTep, loaiMime, kichThuoc }.
 * → { tepId, trangThai, uploadUrl, phuongThuc:"PUT", headers, hetHanLuc, kichThuoc }. Idempotent theo `khoaGuiLai`. Kho riêng chưa cấu hình ⇒ 503 (KHÔNG rơi về URL công khai).
 */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, xinVeSchema, async (hs, nguoi, c, thanDl) => traThanhCong(await xinVe(hs, nguoi.userId, thanDl, c.now)));
}
