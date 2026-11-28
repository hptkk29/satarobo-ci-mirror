import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { ketQuaCacLuotOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/online/courses/:courseId/lessons/:lessonId/results — các lượt đã làm + kết quả theo cài đặt xem kết quả của khoá. D23: quyền HẾT HẠN vẫn đọc được (chỉ đọc); thu hồi ⇒ 403. #1300: bài đã khoá xem lại ⇒ chỉ điểm + đạt/không. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string; lessonId: string }> }) {
  const { studentId, courseId, lessonId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await ketQuaCacLuotOnline(hs, nguoi, courseId, lessonId)));
}
