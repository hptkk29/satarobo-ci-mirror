import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runSubstituteTeacherNotify } from "@/lib/lms/session-teacher-notify";

export const dynamic = "force-dynamic";

// #06 L6 (câu 47) — Cron báo GV dạy thay TRƯỚC 1 ngày: quét buổi NGÀY MAI có
// substituteTeacherId → StaffNotification cho GV đó, dedupe theo sessionId (1 lần).
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await runSubstituteTeacherNotify();
  return NextResponse.json({ ok: true, data: result });
}
