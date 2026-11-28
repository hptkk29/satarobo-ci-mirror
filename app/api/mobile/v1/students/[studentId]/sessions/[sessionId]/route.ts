import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layChiTietBuoi } from "@/lib/mobile-api/dich-vu/lich-thang";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/sessions/:sessionId — chi tiết MỘT buổi. `sessionId` chỉ tra trong buổi của học viên đã kiểm (buổi lớp khác / lạ ⇒ cùng 404). */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; sessionId: string }> }) {
  const { studentId, sessionId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
    const b = await layChiTietBuoi(hs, sessionId);
    if (!b) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
    return traThanhCong(b);
  });
}
