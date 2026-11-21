import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { ensureHandlersRegistered } from "@/lib/events/register";
import { dispatchPendingEvents, reapStuckEvents } from "@/lib/events/dispatcher";

export const dynamic = "force-dynamic";

// A0-07 — Dispatcher DomainEvent (cron */1). Xử lý batch PENDING + reaper PROCESSING treo.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  ensureHandlersRegistered();
  const reaped = await reapStuckEvents();
  const result = await dispatchPendingEvents();
  return NextResponse.json({ ok: true, data: { reaped, ...result } });
}
