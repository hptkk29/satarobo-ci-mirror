import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { forceRefreshZaloToken } from "@/lib/zalo/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep-alive token Zalo OA: gia hạn access_token + XOAY refresh_token định kỳ để
// refresh_token (sống ~3 tháng) không chết trong giai đoạn ít gửi tin. Việc gửi
// thật vẫn tự refresh lazy lúc cần (lib/zalo/token.ts); cron này là lưới an toàn.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Chưa cấu hình bộ refresh → bỏ qua êm (không phải lỗi).
  if (!process.env.ZALO_APP_ID || !process.env.ZALO_APP_SECRET) {
    return NextResponse.json({ ok: true, skipped: "ZALO refresh chưa cấu hình" });
  }

  const token = await forceRefreshZaloToken();
  return NextResponse.json({ ok: Boolean(token), refreshed: Boolean(token) });
}
