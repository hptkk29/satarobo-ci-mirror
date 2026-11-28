import { chayChoPhuHuynh, motMobileTat, traThanhCong } from "@/lib/mobile-api/cong";
import { layNoiDungSucKhoe, motSucKhoeTat } from "@/lib/mobile-api/dich-vu/suc-khoe";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/parent/health/content — «Sức khoẻ cả nhà» / «Khảo sát thói quen»: NỘI DUNG THAM CHIẾU tĩnh (bộ câu khảo sát trẻ/người lớn, khuôn lời khuyên, giới hạn, khoảng số đo).
 * Không chứa dữ liệu sức khoẻ của ai và không theo học viên (thành viên trong sổ không phải `Student`). Cờ `SUC_KHOE_ENABLED` TẮT ⇒ 404 (kiểm TRƯỚC xác thực, như cờ MOBILE_API). Chế độ học sinh ⇒ 403.
 */
export async function GET(req: Request) {
  const tat = motMobileTat() ?? motSucKhoeTat();
  if (tat) return tat;
  return chayChoPhuHuynh(req, async () => traThanhCong(layNoiDungSucKhoe()));
}
