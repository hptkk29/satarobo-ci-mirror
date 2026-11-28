import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { kiemTruocThanhToan, kiemTruocThanhToanSchema, datTraCuuKhoaBan } from "@/lib/mobile-api/dich-vu/mua-khoa";
import { traCuuKhoaOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

// V8.15: cổng tra cứu khoá THẬT (E-learning Online). Cờ Online tắt ⇒ cổng tự trả «chưa có danh mục» (hành vi cũ).
datTraCuuKhoaBan(traCuuKhoaOnline);

/**
 * POST /api/mobile/v1/parent/checkout/validate { dong: [{ studentId, khoaId }] } → { hopLe, loi[], chuaKiemDuoc[] } — KIỂM trước khi tạo đơn (CHỈ ĐỌC, không tạo đơn).
 * Mỗi dòng PHẢI tự khai studentId; id lạ ⇒ 404 cả yêu cầu; thân chứa giá/tổng tiền ⇒ 400 (lược đồ strict). Danh mục khoá Online chưa có ⇒ `COURSE_CATALOG_UNAVAILABLE` (fail-closed).
 * Bị chặn trong chế độ học sinh (allow-list default-deny).
 */
export async function POST(req: Request) {
  return chayChoPhuHuynhCoThan(req, kiemTruocThanhToanSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await kiemTruocThanhToan(nguoi.userId, thanDl)));
}
