import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { ghiTienDoHocThuMobile } from "@/lib/mobile-api/dich-vu/free-mode";
import { tienDoHocThuBodySchema } from "@/lib/mobile-api/free-mode-hop-dong";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/online/preview/courses/:slug/lessons/:lessonId/progress { percent? | daDoc? } — HỌC VIÊN (chính em) ghi tiến độ bài học thử (% chỉ tăng; COMPLETED không lùi). Phụ huynh ⇒ 403. Trường lạ ⇒ 400. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; slug: string; lessonId: string }> }) {
  const { studentId, slug, lessonId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, tienDoHocThuBodySchema, async (hs, nguoi, _c, than) => traThanhCong(await ghiTienDoHocThuMobile(hs, nguoi, slug, lessonId, than)));
}
