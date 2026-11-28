import { chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { tuNhanKhoaMienPhiMobile } from "@/lib/mobile-api/dich-vu/free-mode";
import { thanRongSchema } from "@/lib/mobile-api/free-mode-hop-dong";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/students/:studentId/online/preview/courses/:slug/free-claim {} — phụ huynh nhận khoá MIỄN PHÍ cho con (chỉ khi khoá công bố + chính sách Admin bật + đủ điều kiện). Thân rỗng; idempotent theo (học viên × khoá). Học sinh ⇒ 403. */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string; slug: string }> }) {
  const { studentId, slug } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, thanRongSchema, async (hs, nguoi) => traThanhCong(await tuNhanKhoaMienPhiMobile(hs, nguoi, slug)));
}
