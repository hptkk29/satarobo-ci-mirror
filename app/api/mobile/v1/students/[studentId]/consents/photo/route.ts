import { chayTheoHocVien, chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { datDongYAnh, dongYAnhSchema, layDongYAnh } from "@/lib/mobile-api/dich-vu/ho-so-ghi";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/consents/photo — đồng ý dùng hình ảnh của MỘT con + lịch sử (thu hồi giữ lịch sử, NĐ 13/2023). Cổng C; chặn ở chế độ học sinh. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layDongYAnh(hs)));
}

/** PUT { dongY:boolean } — đổi đồng ý (cùng hàm + audit của web). Thu hồi ⇒ ảnh có thẻ con biến mất ở lượt tải kế tiếp. Không đổi trạng thái ⇒ không ghi audit trùng. */
export async function PUT(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, dongYAnhSchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await datDongYAnh(hs, nguoi, thanDl)));
}
