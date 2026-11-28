import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { danhMucKhoaOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/online/catalog?q=&dm=&trang=&coTrang= — danh mục khoá Online ĐANG BÁN (hàm công khai của E). Phụ huynh đã đăng nhập; chế độ học sinh ⇒ 403; cờ Online tắt ⇒ 404. Không trả nội dung bài/khoá media. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = Object.fromEntries(u.searchParams.entries());
  return chayChoPhuHuynh(req, async () => traThanhCong(await danhMucKhoaOnline(q)));
}
