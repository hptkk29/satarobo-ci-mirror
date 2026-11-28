import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { danhSachHocThu } from "@/lib/mobile-api/dich-vu/free-mode";
import { locHocThuSchema } from "@/lib/mobile-api/free-mode-hop-dong";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/online/preview/courses?trang=&coTrang= — khoá ĐANG BÁN có bài VIDEO/READ học thử (không tên/nội dung bài trả phí). Phụ huynh (cả tài khoản chưa có con). */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async () => {
    const loc = locHocThuSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    if (!loc.success) throw new LoiApiMobile("VALIDATION", 400, "Bộ lọc không hợp lệ.");
    return traThanhCong(await danhSachHocThu(null, loc.data));
  });
}
