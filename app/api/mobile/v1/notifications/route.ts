import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { layThongBao, locThongBaoSchema } from "@/lib/mobile-api/dich-vu/thong-bao";
import { fail } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/notifications[?danhMuc=&chuaDoc=true|false&trang=&soLuong=] — feed thông báo của phụ huynh gọi (chỉ các con của họ). Cổng C.
 * Lọc/phân trang TUỲ CHỌN (không tham số ⇒ như cũ). Tham số lạ/sai ⇒ 400. Response thêm `tong`, `trang`, `coTrangSau`; `unreadTotal` luôn là tổng chưa đọc toàn feed.
 */
export async function GET(req: Request) {
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const loc = locThongBaoSchema.safeParse(q);
  return chayChoPhuHuynh(req, async (nguoi) => {
    if (!loc.success) {
      const dau = loc.error.issues[0];
      return fail("VALIDATION", dau?.message || "Tham số không hợp lệ.", { status: 400, field: dau?.path.join(".") || undefined, headers: { "Cache-Control": "no-store" } });
    }
    return traThanhCong(await layThongBao(nguoi.userId, new Date(), loc.data));
  });
}
