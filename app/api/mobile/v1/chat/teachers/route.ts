import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { giaoVienNhanDuoc } from "@/lib/mobile-api/dich-vu/chat";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/chat/teachers — giáo viên của MỌI nhóm lớp đang mở của phụ huynh (gộp nhiều con/lớp; `{giaoVienId, ten, lop[]}`) để chọn «Nhắn cô thầy» → `POST /chat/dm`. Cờ chat tắt ⇒ 404; chưa đồng ý quy định chat ⇒ 403; chế độ học sinh ⇒ 403. */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await giaoVienNhanDuoc(nguoi)));
}
