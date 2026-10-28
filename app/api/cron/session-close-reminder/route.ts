import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runSessionCloseReminder } from "@/lib/lms/session-teacher-notify";

export const dynamic = "force-dynamic";

// #06 L6 (câu 48) — Cron nhắc GV chốt buổi: quét buổi đã qua giờ còn SCHEDULED/
// IN_PROGRESS → StaffNotification nhắc GV đứng lớp, dedupe theo sessionId. CHỈ chạy khi
// SESSION_LIFECYCLE_V2 ON (no-op khi flag OFF — chốt buổi là luồng lifecycle v2).
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await runSessionCloseReminder();
  return NextResponse.json({ ok: true, data: result });
}
