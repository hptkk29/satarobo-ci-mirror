import { chayChoPhuHuynh, chayChoPhuHuynhCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { danhSachDonOnlineMobile, gioHangOnlineSchema, taoDonOnlineMobile } from "@/lib/mobile-api/dich-vu/online-mua";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/parent/online-orders — các đơn Online của phụ huynh. */
export async function GET(req: Request) {
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await danhSachDonOnlineMobile(nguoi.userId)));
}

/**
 * POST /api/mobile/v1/parent/online-orders { dong: [{ studentId, khoaId, voucherId? }] } — TẠO ĐƠN Online từ giỏ nhiều khoá · nhiều con. Thân `.strict()`: gửi giá/tổng tiền/trường lạ ⇒ 400.
 * Giá, tiên quyết, trọn đời, mã giảm, hồ sơ đủ — do MÁY CHỦ quyết (lỗi nghiệp vụ: 404/409/422 với `code` của `online-checkout`). Bấm đúp/thử lại ⇒ cùng đơn (`daCo:true`).
 * KHÔNG cấp quyền học và KHÔNG có QR/hướng dẫn chuyển khoản (`huongDanThanhToan:null`, `gioiHan` giải thích). Chế độ học sinh ⇒ 403.
 */
export async function POST(req: Request) {
  return chayChoPhuHuynhCoThan(req, gioHangOnlineSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await taoDonOnlineMobile(nguoi.userId, thanDl)));
}
