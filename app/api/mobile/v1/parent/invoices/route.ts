import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { danhSachHoaDon } from "@/lib/mobile-api/dich-vu/hoa-don";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/invoices — hoá đơn điện tử ĐÃ XUẤT của các con của phụ huynh (chỉ đọc). Cờ hoá đơn tắt ⇒ 404; chưa đồng ý Quy định đào tạo ⇒ 403 POLICY_REQUIRED; chế độ học sinh ⇒ 403. */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await danhSachHoaDon(nguoi)));
}
