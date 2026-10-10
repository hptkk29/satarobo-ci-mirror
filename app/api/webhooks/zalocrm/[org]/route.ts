import { NextResponse, type NextRequest } from "next/server";
import { xuLyWebhookZalocrm } from "@/lib/integrations/zalocrm/webhook";
import { isZalocrmEnabled } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook nhận sự kiện của ZaloCRM (nick Zalo cá nhân), MỘT URL cho MỖI Organization.
//
// Toàn bộ chuỗi 7 bước nằm ở `lib/integrations/zalocrm/webhook.ts` và có
// `lib/integrations/zalocrm/bat-bien.test.ts` canh thứ tự của chúng. Route này CỐ Ý
// mỏng: kéo một bước lên đây (như webhook Messenger đang làm với rate-limit) là mất
// đúng cái lưới đó.
//
// ⚠️ Cờ `ZALOCRM_ENABLED` mặc định OFF ⇒ trả 404 như thể địa chỉ không tồn tại. Chọn
// 404 chứ không 503 vì cùng lý do với webhook OmiCall (OmiCall — đã gỡ 06/10/2026): chưa bật thì không có cớ gì
// để lộ ra rằng địa chỉ này có thật. ZaloCRM giữ tin trong outbox và gửi lại khi
// thấy non-2xx, nên bật cờ muộn KHÔNG làm mất tin.
//
// ⚠️ `[org]` là chuỗi do NGƯỜI LẠ gõ trên URL. Nó được kiểm khuôn `/^[a-z0-9-]{1,32}$/`
// trong `traCauHinhOrg` TRƯỚC khi chạm DB — đừng "tối ưu" bằng cách tra thẳng ở đây.
export async function POST(req: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  if (!isZalocrmEnabled()) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  // Next 16: `params` là Promise, BẮT BUỘC await.
  const { org } = await params;
  const kq = await xuLyWebhookZalocrm(req, org);
  return NextResponse.json(kq.body, { status: kq.httpStatus });
}
