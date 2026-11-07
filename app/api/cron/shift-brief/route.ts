// app/api/cron/shift-brief/route.ts — tin nhắc lịch NGÀY MAI (thay tin Zalo 19:00 của Sheet).
// Lịch Vercel: mỗi giờ (`0 * * * *`); route tự so giờ VN với setting `shift.briefNoteHourVN`
// (mặc định 19) — đổi giờ gửi không cần dev, không cần sửa vercel.json. Idempotent theo
// (người, ngày) nên cron-pump-test bơm 5′/lần cũng không kêu chuông hai lần.
import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runShiftBrief } from "@/lib/cham-cong/brief-db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = await runShiftBrief({ force });
  return NextResponse.json({ ok: true, data: result });
}
