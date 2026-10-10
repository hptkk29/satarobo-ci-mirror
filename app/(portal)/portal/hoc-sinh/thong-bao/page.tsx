import { requireActiveStudent } from "@/lib/portal/session";
import {
  getParentNotificationFeed,
  type FeedCategory,
  type NotificationFeed,
} from "@/lib/portal/notification-feed";
import { ThongBaoPageV2 } from "@/components/portal/thong-bao-page";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Thông báo | Sata Robo",
  robots: { index: false },
};

// Cổng học sinh — Thông báo LỌC theo con đang xem (+ thông báo chung childName=null).
export default async function StudentThongBaoPage() {
  const { ctx } = await requireActiveStudent();
  const activeName = ctx.activeStudent?.name ?? null;
  const full = await getParentNotificationFeed(ctx.parentUserId);

  const items = full.items.filter(
    (i) => i.childName === null || i.childName === activeName,
  );
  const unreadByCategory = { ...full.unreadByCategory };
  (Object.keys(unreadByCategory) as FeedCategory[]).forEach(
    (k) => (unreadByCategory[k] = 0),
  );
  for (const it of items) if (!it.read) unreadByCategory[it.category]++;
  const feed: NotificationFeed = {
    items,
    unreadByCategory,
    unreadTotal: items.filter((i) => !i.read).length,
  };

  return (
    <ThongBaoPageV2
      feed={feed}
      overline="Cổng học sinh"
      subtitle={`Cập nhật về học tập, lịch học, bài tập và khảo sát của ${(activeName ?? "con").split(/\s+/).slice(-2).join(" ")}.`}
    />
  );
}
