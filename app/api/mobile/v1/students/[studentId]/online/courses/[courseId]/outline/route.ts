import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { mucLucKhoaOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/online/courses/:courseId/outline — mục lục + tiến độ + bài mở được (KHÔNG nội dung bài). Hết hạn (D23) ⇒ 200 chỉ-đọc: `hetHan:true`, mọi bài `mo:false` + `lyDoChuaMo:"HET_HAN"` · thu hồi ⇒ 403 DA_THU_HOI · không quyền ⇒ 403 KHONG_CO_QUYEN. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; courseId: string }> }) {
  const { studentId, courseId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await mucLucKhoaOnline(hs, nguoi, courseId)));
}
