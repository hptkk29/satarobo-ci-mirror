import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasStaffRole } from "@/lib/auth/permissions";
import { isNotiGroupKey } from "@/lib/notifications/catalog";
import { getNotificationSummary, listNotifications, mocLocThoiGian } from "@/lib/notifications/service";
import { ThongBaoClient } from "./_components/thong-bao-client";

// Bản site giáo viên của trang "Tất cả thông báo". Khác bản admin đúng một điểm: href lưu trong DB
// viết theo đường admin nên phải đổi qua `teacherHref` — mà hàm không truyền được từ Server
// Component sang client props, nên đi qua lớp bọc mỏng ở `_components/`.
//
// Segment "thong-bao" đã khai trong TEACHER_ROUTE_SEGMENTS để clean URL trên host giaovien không
// bị nhánh "chuẩn hoá path lạc khu" ném về trang chủ.

export const metadata = { title: "Tất cả thông báo" };
export const dynamic = "force-dynamic";

export default async function TeacherThongBaoPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; status?: string; range?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasStaffRole(session.user)) redirect("/");

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
