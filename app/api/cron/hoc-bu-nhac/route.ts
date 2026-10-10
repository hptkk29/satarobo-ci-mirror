// app/api/cron/hoc-bu-nhac/route.ts — T13 (08/10/2026): quét theo giờ cho thông báo học bù.
// Vỏ mỏng: xác thực cron rồi gọi `chayNhacHocBu`. Nghiệp vụ nằm ở `lib/hoc-bu/nhac-db.ts` (nhận `now` từ ngoài).
//
// ⚠️ KHÔNG nhận `?now=`: đây là endpoint chạy thật — mở tham số thời gian ra query là cho người gọi tự chọn mốc và phát lại chuông tuỳ ý.
import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { chayNhacHocBu } from "@/lib/hoc-bu/nhac-db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const stats = await chayNhacHocBu({ now: new Date() });
  return NextResponse.json({ ok: true, ...stats });
}
