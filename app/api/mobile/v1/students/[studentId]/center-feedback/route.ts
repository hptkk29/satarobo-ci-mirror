import { chayTheoHocVien, chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { guiGopY, guiGopYSchema, layGopY } from "@/lib/mobile-api/dich-vu/ho-so-khuyen-mai-gop-y";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/center-feedback — các góp ý ba mẹ đã gửi cho trung tâm (kèm phản hồi) + danh sách chủ đề. Cổng C. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (_hs, nguoi) => traThanhCong(await layGopY(nguoi.userId)));
}

/** POST /api/mobile/v1/students/:studentId/center-feedback — gửi MỘT góp ý (1–5 sao + chủ đề + nội dung). Ghi vào `ParentFeedback` như web; không ẩn danh. Cổng C. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  // Cờ tắt ⇒ 404 TRƯỚC khi đọc thân yêu cầu.
  const { studentId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, guiGopYSchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await guiGopY(hs, nguoi.userId, thanDl)));
}
