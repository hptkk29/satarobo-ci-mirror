import { fail } from "@/lib/api/response";
import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layAnhBuoiHoc, locAnhSchema } from "@/lib/mobile-api/dich-vu/anh-buoi-hoc";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/students/:studentId/photos[?soLuong=&trang=] — ảnh buổi học của MỘT con: chỉ ảnh đã duyệt, con có đồng ý, gắn thẻ con hoặc ảnh chung lớp; URL KÝ ≤ 15 phút.
 * Kho ảnh chưa cấu hình/ký ⇒ 503 MEDIA_CHUA_SAN_SANG (không bao giờ URL công khai). Học sinh (chế độ học sinh) đọc được của CHÍNH MÌNH. Con nhà khác ⇒ 404.
 */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  const loc = locAnhSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  return chayTheoHocVien(req, studentId, async (hs) => {
    if (!loc.success) {
      const dau = loc.error.issues[0];
      return fail("VALIDATION", dau?.message || "Tham số không hợp lệ.", { status: 400, field: dau?.path.join(".") || undefined, headers: { "Cache-Control": "no-store" } });
    }
    return traThanhCong(await layAnhBuoiHoc(hs, loc.data));
  });
}
