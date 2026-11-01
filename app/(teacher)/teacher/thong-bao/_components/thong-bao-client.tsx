"use client";

// Lớp bọc mỏng: `teacherHref` là hàm, không truyền được từ Server Component sang client props.
// Bọc ở đây để bản dùng chung không phải biết mình đang chạy ở site nào.

import { NotificationsPage, type NotificationsPageProps } from "@/components/notifications/notifications-page";
import { teacherHref } from "@/lib/teacher/notification-href";

export function ThongBaoClient(props: Omit<NotificationsPageProps, "resolveHref">) {
  return <NotificationsPage {...props} resolveHref={teacherHref} />;
}
