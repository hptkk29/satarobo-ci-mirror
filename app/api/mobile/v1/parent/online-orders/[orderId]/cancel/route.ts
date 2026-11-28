import { z } from "zod";

import { chanThanQuaLon, chayChoPhuHuynh, docVanBanCoTran, traLoi, traThanhCong } from "@/lib/mobile-api/cong";
import { huyDonOnlineMobile } from "@/lib/mobile-api/dich-vu/online-mua";
import { LoiApiMobile } from "@/lib/mobile-api/xac-thuc/dich-vu";

export const dynamic = "force-dynamic";

// Thân TUỲ CHỌN (tương thích bản cũ gửi `{}` hoặc không gửi gì): `{ khoiPhucVaoGio?: boolean }`, khoá lạ ⇒ 400.
const thanHuy = z.object({ khoiPhucVaoGio: z.boolean().optional() }).strict();

/**
 * POST /api/mobile/v1/parent/online-orders/:orderId/cancel [{ khoiPhucVaoGio?: boolean }] — huỷ đơn CHƯA có đồng nào và CHƯA cấp quyền (409 DA_CO_TIEN / DA_CAP_QUYEN / SAI_TRANG_THAI). Huỷ lại ⇒ 200 `daHuyTruocDo:true`.
 * `khoiPhucVaoGio:true` ⇒ trả các dòng của đơn về giỏ đã lưu; phản hồi thêm `khoiPhucVaoGio:true`, `soDongKhoiPhuc`, `gio`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  return chayChoPhuHuynh(req, async (nguoi) => {
    let khoiPhuc = false;
    const lon = chanThanQuaLon(req);
    if (lon) return lon;
    const doc = await docVanBanCoTran(req);
    if (!doc.ok) return doc.res;
    const text = doc.text.trim();
    if (text !== "") {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return traLoi(new LoiApiMobile("VALIDATION" as never, 400, "Yêu cầu không hợp lệ."));
      }
      const kq = thanHuy.safeParse(raw);
      if (!kq.success) return traLoi(new LoiApiMobile("VALIDATION" as never, 400, kq.error.issues[0]?.message || "Yêu cầu không hợp lệ."));
      khoiPhuc = kq.data.khoiPhucVaoGio === true;
    }
    return traThanhCong(await huyDonOnlineMobile(nguoi.userId, orderId, khoiPhuc));
  });
}
