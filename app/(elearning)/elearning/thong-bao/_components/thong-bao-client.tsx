"use client";

// Lớp bọc mỏng: `elearningHref` là hàm, không truyền được từ Server Component sang client props.
import {
  NotificationsPage,
  type NotificationsPageProps,
} from "@/components/notifications/notifications-page";
import { elearningHref } from "@/lib/elearning/notification-href";

export function ThongBaoClient(props: Omit<NotificationsPageProps, "resolveHref">) {
  return <NotificationsPage {...props} resolveHref={elearningHref} />;
}
