import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasStaffRole } from "@/lib/auth/permissions";
import { getNotificationSummary } from "@/lib/notifications/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Đường ĐỌC NÓNG NHẤT của cả hệ: chuông hỏi lại mỗi lần có tín hiệu realtime và mỗi nhịp poll dự
// phòng, nhân với mọi nhân sự đang mở máy. Vì vậy nó CHỈ được làm đúng một việc — đếm.
//
// ⛔ ĐỪNG thêm đồng bộ việc tồn vào đây. Đó chính là thứ vừa được gỡ ra (`getPendingTasks` quét 14
// nhóm việc có kiểm quyền); để lại thì mốc p95 < 150ms là không thể đạt. Việc đồng bộ thuộc về
// GET /api/notifications (lúc người dùng mở panel).
export async function GET() {
  const session = await auth();
  if (!session?.user || !hasStaffRole(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = await getNotificationSummary(session.user.id);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
