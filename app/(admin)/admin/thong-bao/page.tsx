import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasStaffRole } from "@/lib/auth/permissions";
import { isNotiGroupKey } from "@/lib/notifications/catalog";
import { getNotificationSummary, listNotifications, mocLocThoiGian } from "@/lib/notifications/service";
import { NotificationsPage } from "@/components/notifications/notifications-page";

// Trang "Tất cả thông báo" của site admin.
//
// ⚠️ KHÔNG được thêm vào sidebar (ràng buộc cốt lõi của PRD). Vào từ chân panel chuông hoặc URL.
// Segment "thong-bao" ĐÃ khai trong ADMIN_ROUTE_SEGMENTS — thiếu là admin host 308 sang public
// rồi 404 dù page tồn tại, đúng lỗi đã lặp lại nhiều lần trong repo này.
//
// Không cần `scopedDb`: thông báo fan-out sẵn theo người nhận nên `userId` chính là ranh giới quyền.

export const metadata = { title: "Tất cả thông báo | Admin" };
export const dynamic = "force-dynamic";

export default async function AdminThongBaoPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; status?: string; range?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasStaffRole(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const group = sp.group && isNotiGroupKey(sp.group) ? sp.group : undefined;

  const [summary, trang] = await Promise.all([
    getNotificationSummary(session.user.id),
    listNotifications(session.user.id, {
      group,
      status: sp.status === "unread" ? "unread" : "all",
      from: mocLocThoiGian(sp.range),
      q: sp.q,
    }),
  ]);

  return (
    <NotificationsPage
      initialItems={trang.items}
      initialCursor={trang.nextCursor}
      groupCounts={summary.groups}
    />
  );
}
