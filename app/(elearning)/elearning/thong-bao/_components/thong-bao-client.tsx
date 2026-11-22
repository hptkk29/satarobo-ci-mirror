"use client";

// Lớp bọc mỏng: `elearningHref` là hàm, không truyền được từ Server Component sang client props.
import {
  NotificationsPage,
  type NotificationsPageProps,
} from "@/components/notifications/notifications-page";
import { elearningHref } from "@/lib/elearning/notification-href";

export function ThongBaoClient(props: Omit<NotificationsPageProps, "resolveHref">) {
  // `<main>` là vùng nội dung chính duy nhất của trang (khung khu không tự vẽ `main`).
  return (
    <main>
      <NotificationsPage {...props} resolveHref={elearningHref} />
    </main>
  );
}
