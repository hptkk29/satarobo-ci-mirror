import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { danhMucShopMobile } from "@/lib/mobile-api/dich-vu/online-shop";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/online/shop/products?danhMuc=&q=&trang=&soLuong= — danh mục HỌC CỤ bán Online (V8.42). Phụ huynh đã đăng nhập; Student Mode ⇒ 403; cờ Online tắt ⇒ 404. Giá/tồn do máy chủ; không lộ giá vốn/tồn thật khi dồi dào. */
export async function GET(req: Request) {
  const q = Object.fromEntries(new URL(req.url).searchParams.entries());
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await danhMucShopMobile(nguoi.userId, q)));
}
