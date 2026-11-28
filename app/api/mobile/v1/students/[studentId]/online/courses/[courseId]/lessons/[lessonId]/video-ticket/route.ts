import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { capVePhatVideoOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/online/courses/:courseId/lessons/:lessonId/video-ticket — cấp VÉ PHÁT video của MỘT bài VIDEO (trả phí) qua cổng quyền của E. Không thân. `{ duongPhat, hetHanLuc, lamMoiTruocLuc, … }`; KHÔNG khoá media. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string; lessonId: string }> }) {
  const { studentId, courseId, lessonId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await capVePhatVideoOnline(hs, nguoi, courseId, lessonId)));
}
