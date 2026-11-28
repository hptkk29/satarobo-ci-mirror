import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { layBaiTapTheoBuoi } from "@/lib/mobile-api/dich-vu/bai-tap-theo-buoi";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/learning/session-homework — «Bộ bài tập buổi N» của CHÍNH học viên (HL-BT-Bo/Lam/Xong, PL-BT-KQ): bài giao theo buổi + lượt đã dùng/tối đa + điểm cao nhất (theo luật hiện điểm của bài thi). Chỉ đọc; làm bài/xem kết quả dùng route lượt thi sẵn có. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs, nguoi) => traThanhCong(await layBaiTapTheoBuoi(hs, { laHocSinh: nguoi.hocSinhId !== null })));
}
