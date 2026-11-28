import { chayTheoHocVien, chayTheoHocVienCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { guiYeuCau, layYeuCau } from "@/lib/mobile-api/dich-vu/yeu-cau";
import { guiYeuCauSchema } from "@/lib/mobile-api/schema/yeu-cau";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/requests — yêu cầu đã gửi của MỘT con + lựa chọn cho các màn gửi (buổi sắp tới, buổi cần bù, cơ sở có thể chuyển, danh sách lý do). Cổng C. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layYeuCau(hs, nguoi.userId)));
}

/**
 * POST /api/mobile/v1/students/:studentId/requests — gửi MỘT yêu cầu đến trung tâm (6 loại như web). Dữ liệu có cấu trúc; máy chủ tự ghép nội dung.
 * Trùng nội dung trong 5 phút ⇒ trả đơn đã có (`trungLap: true`), không tạo đơn thứ hai. Cổng C.
 */
export async function POST(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  // Cờ tắt ⇒ 404 TRƯỚC khi đọc thân yêu cầu.
  const { studentId } = await ctx.params;
  return chayTheoHocVienCoThan(req, studentId, guiYeuCauSchema, async (hs, nguoi, _ctx, thanDl) => traThanhCong(await guiYeuCau(hs, nguoi.userId, thanDl)));
}
