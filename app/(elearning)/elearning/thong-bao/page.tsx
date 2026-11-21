import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isNotiGroupKey } from "@/lib/notifications/catalog";
import {
  getNotificationSummary,
  listNotifications,
  mocLocThoiGian,
} from "@/lib/notifications/service";
import { ThongBaoClient } from "./_components/thong-bao-client";

// Trang "Tất cả thông báo" của khu học tập — đích của nút "Xem tất cả" trên chuông ở thanh trên. Cùng khuôn với
// bản site GV (`app/(teacher)/teacher/thong-bao`): chuông dùng chung API, href trong DB viết theo đường admin nên
// đi qua `elearningHref` (đường không thuộc khu này ⇒ hiện chữ, không gắn link chết).
// Cổng đăng nhập + hồ sơ nhân sự do `layout.tsx` của khu đã gác.

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Thông báo | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function ElearningThongBaoPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; status?: string; range?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

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
    <ThongBaoClient
      initialItems={trang.items}
      initialCursor={trang.nextCursor}
      groupCounts={summary.groups}
    />
  );
}
