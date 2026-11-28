import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { danhSachHocThu } from "@/lib/mobile-api/dich-vu/free-mode";
import { locHocThuSchema } from "@/lib/mobile-api/free-mode-hop-dong";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/online/preview/courses — như `/online/preview/courses` kèm tiến độ + cờ tự nhận CỦA HỌC VIÊN NÀY. Phụ huynh (xem) hoặc học sinh của chính em. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => {
    const loc = locHocThuSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    if (!loc.success) throw new LoiApiMobile("VALIDATION", 400, "Bộ lọc không hợp lệ.");
    return traThanhCong(await danhSachHocThu(hs, loc.data));
  });
}
