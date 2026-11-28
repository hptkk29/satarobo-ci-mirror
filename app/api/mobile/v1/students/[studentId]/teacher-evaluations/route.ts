import { chayTheoHocVien, chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { danhGiaSchema, guiDanhGia, layDanhGia } from "@/lib/mobile-api/dich-vu/danh-gia-gv";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/teacher-evaluations — đợt đánh giá giáo viên ĐANG MỞ + câu hỏi + giáo viên CHƯA đánh giá (H-Danh-gia, OD-16 không ẩn danh). Cờ EVAL_V2 tắt ⇒ dangMo=false. Học sinh (chế độ học sinh) đọc của CHÍNH mình. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layDanhGia(hs, nguoi)));
}

/** POST /api/mobile/v1/students/:studentId/teacher-evaluations { dotId, ghiDanhId, giaoVienId, traLoi[] } — gửi MỘT đánh giá. Gửi lại ⇒ 409 DA_DANH_GIA; đợt đóng ⇒ 409 DOT_DA_DONG; GV không đủ điều kiện ⇒ 422. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, danhGiaSchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await guiDanhGia(hs, nguoi, thanDl)));
}
