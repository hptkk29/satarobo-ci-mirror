import { fail } from "@/lib/api/response";
import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layTinHocSinh, locThongBaoHocSinhSchema } from "@/lib/mobile-api/dich-vu/thong-bao-hoc-sinh";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/students/:studentId/notifications[?soLuong=&truocLuc=ISO] — «Tin mới» của HỌC SINH. Dùng được trong chế độ học sinh (đúng học viên đang khoá).
 * Chỉ tin nhắm tới chính học sinh (STUDENT) và thông báo LỚP đang học; không có tin của ba mẹ/cơ sở/học phí. Phân trang bằng con trỏ `truocLuc` (= `conTro` của trang trước).
 */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  const loc = locThongBaoHocSinhSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  return chayTheoHocVien(req, studentId, async (hs) => {
    if (!loc.success) {
      const dau = loc.error.issues[0];
      return fail("VALIDATION", dau?.message || "Tham số không hợp lệ.", { status: 400, field: dau?.path.join(".") || undefined, headers: { "Cache-Control": "no-store" } });
    }
    return traThanhCong(await layTinHocSinh(hs, loc.data));
  });
}
