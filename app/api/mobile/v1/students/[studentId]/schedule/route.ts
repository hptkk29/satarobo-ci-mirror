import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { layLich } from "@/lib/mobile-api/dich-vu/lich";
import { docThang, layLichThang } from "@/lib/mobile-api/dich-vu/lich-thang";
import { chanNeuCanQuyDinh, kiemHocVienCuaPhuHuynh } from "@/lib/mobile-api/so-huu";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/students/:studentId/schedule — lịch học của MỘT con. Cổng C: đăng nhập → cổng quy định → kiểm sở hữu (studentId KHÔNG được tin) → dịch vụ.
 * Học viên của gia đình khác / không tồn tại ⇒ cùng 404 NOT_FOUND.
 */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayDaDangNhap(req, async (nguoi) => {
    await chanNeuCanQuyDinh(nguoi.userId);
    const hs = await kiemHocVienCuaPhuHuynh(nguoi.userId, studentId);
    // B4: `?month=YYYY-MM` ⇒ lịch THÁNG (lưới + buổi trong tháng); không có ⇒ đúng phản hồi cũ.
    const thang = new URL(req.url).searchParams.get("month");
    if (thang !== null) {
      const t = docThang(thang);
      if (!t) throw new LoiApiMobile("VALIDATION", 400, "Tháng không hợp lệ (dạng YYYY-MM).");
      return traThanhCong(await layLichThang(hs, t.y, t.m0));
    }
    const lich = await layLich(hs);
    if (!lich) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
    return traThanhCong(lich);
  });
}
