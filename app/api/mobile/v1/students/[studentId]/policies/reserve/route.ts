import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layChinhSachBaoLuu } from "@/lib/mobile-api/dich-vu/chinh-sach-bao-luu";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/students/:studentId/policies/reserve — chính sách bảo lưu ĐANG HIỆU LỰC theo cơ sở + theo khoá của con (D01-BL). CHỈ ĐỌC; đọc đúng tham số của web, không gõ cứng.
 * Dùng để HIỂN THỊ giới hạn + cảnh báo trên form «Bảo lưu»; KHÔNG chặn việc gửi yêu cầu (như trang phụ huynh của web — nhân sự quyết khi lập/duyệt hồ sơ).
 */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await layChinhSachBaoLuu(hs)));
}
