import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasStaffRole } from "@/lib/auth/permissions";
import {
  getStaffNotifications,
  markStaffNotificationRead,
  markAllStaffNotificationsRead,
} from "@/lib/staff-notifications";
import type { TaskUser } from "@/lib/pending-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → đồng bộ + trả {unread, items}. POST {id} | {all:true} → đánh dấu đã đọc.
export async function GET() {
  const session = await auth();
  if (!session?.user || !hasStaffRole(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const data = await getStaffNotifications(session.user as TaskUser);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !hasStaffRole(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string; all?: boolean };
  if (body.all) {
    await markAllStaffNotificationsRead(session.user.id);
  } else if (body.id) {
    await markStaffNotificationRead(session.user.id, body.id);
  }
  return NextResponse.json({ ok: true });
}
