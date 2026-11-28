import { chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { gioHangOnlineSchema, xemTruocGiaOnlineMobile } from "@/lib/mobile-api/dich-vu/online-mua";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/parent/online-orders/preview { dong:[{studentId,khoaId,maGiamGia?|voucherId?}] } — XEM TRƯỚC GIÁ (không tạo đơn, không dùng lượt mã).
 * Cùng cổng với tạo đơn (con của mình, khoá bán được, đã trọn đời, mã giảm: kênh ONLINE/khoá/thời hạn/lượt/đơn tối thiểu). Chỉ để hiển thị: giá thật chốt lúc tạo đơn. Chế độ học sinh ⇒ 403.
 */
export async function POST(req: Request) {
  return chayChoPhuHuynhCoThan(req, gioHangOnlineSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await xemTruocGiaOnlineMobile(nguoi.userId, thanDl)));
}
