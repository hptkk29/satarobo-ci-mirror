import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { remindOverdueSingleOrders } from "@/lib/finance/debt";

export const dynamic = "force-dynamic";

// R2-06 C6.3 — nhắc nợ đơn lẻ (trả 1 lần) quá hạn qua email/Resend. Chống spam 1/ngày.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await remindOverdueSingleOrders({ olderThanDays: 7 });
  return NextResponse.json({ ok: true, data: result });
}
