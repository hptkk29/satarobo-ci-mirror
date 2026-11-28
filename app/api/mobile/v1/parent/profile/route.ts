import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { suaHoSo, suaHoSoSchema } from "@/lib/mobile-api/dich-vu/ho-so-ghi";
import { layHoSo } from "@/lib/mobile-api/dich-vu/ho-so-khuyen-mai-gop-y";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/profile — hồ sơ gia đình CHỈ ĐỌC (phụ huynh, phụ huynh thứ hai, con kèm trạng thái đồng ý hình ảnh). Không ảnh đại diện. Cổng C. */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await layHoSo(nguoi.userId)));
}

/**
 * PATCH /api/mobile/v1/parent/profile { diaChi?, phuHuynh2?:{ten?,sdt?} } — sửa hồ sơ gia đình (CHỈ địa chỉ + phụ huynh thứ hai; strict). KHÔNG sửa tên/email/SĐT đăng nhập (đổi SĐT phải qua OTP — chưa có nhà cung cấp).
 * Cùng phép ghi với cổng phụ huynh của web; có AUDIT (chỉ tên trường đổi, không ghi giá trị PII). Bị chặn ở chế độ học sinh.
 */
export async function PATCH(req: Request) {
  return chayChoPhuHuynhCoThan(req, suaHoSoSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await suaHoSo(nguoi, thanDl)));
}
