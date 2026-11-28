import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layNoiDungBuoi } from "@/lib/mobile-api/dich-vu/noi-dung-buoi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/students/:studentId/sessions/:sessionId/content — bài giảng + tài liệu + bài/đề về nhà của MỘT buổi (HL-Buoi). Cổng C; học sinh đọc được của CHÍNH MÌNH.
 * Buổi không thuộc lớp của học viên ⇒ 404. Chưa dạy ⇒ `baiGiang:null`. Cờ LMS tắt ⇒ 404 (cùng khuôn route học tập).
 */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; sessionId: string }> }) {
  const { studentId, sessionId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layNoiDungBuoi(hs, sessionId)));
}
