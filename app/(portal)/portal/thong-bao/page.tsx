import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { auth } from "@/lib/auth";
import { getParentNotifications } from "@/lib/portal/notifications";
import { isPortalV2Enabled } from "@/lib/flags";
import { getPortalContext } from "@/lib/portal/session";
import { getParentNotificationFeed } from "@/lib/portal/notification-feed";
import { ThongBaoPageV2 } from "@/components/portal/thong-bao-page";
import { DanhDauDaDoc } from "./_components/danh-dau-da-doc";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Thông báo | Sata Robo",
  robots: { index: false },
};

export default async function ThongBaoPage() {
  // Portal v2 — feed thông báo tổng hợp giống SataUI.
  if (isPortalV2Enabled()) {
    // Feed chỉ cần PARENT + danh sách con (0 con vẫn hợp lệ — vẫn có thông báo
    // ALL_PARENTS). KHÔNG dùng requireActiveStudent: PARENT chưa liên kết con sẽ
    // bị redirect("/") → proxy đẩy lại /portal → vòng lặp redirect vô hạn.
    const ctx = await getPortalContext();
    if (!ctx) redirect("/login");
    // Feed tự query children bên trong (React cache) — cùng request với layout
    // chỉ fan-out 1 lần.
    const feed = await getParentNotificationFeed(ctx.parentUserId);
    return (
      <>
        {/* BẢN PROD ĐANG CHẠY (PORTAL_V2_ENABLED=true). Mục bảng tin v2 có id TỔNG HỢP
            (`nt-…`, `mk-need-…`) chứ không phải `Notification.id` — vì vậy bảng đọc
            khoá theo id MỤC, xem `lib/portal/feed-read.ts`. */}
        <DanhDauDaDoc ids={feed.items.map((i) => i.id)} />
        <ThongBaoPageV2 feed={feed} />
      </>
    );
  }

  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") redirect("/login");
  const notifications = await getParentNotifications(session.user.id);

  return (
    <div className="space-y-5">
      {/* Mở trang này = đã đọc những tin đang hiện ⇒ badge chuông hết số (1).
          Không render gì; ghi qua Server Action sau khi trang đã hiện. */}
      <DanhDauDaDoc ids={notifications.map((n) => n.id)} />
      <h1 className="flex items-center gap-2 text-xl font-bold text-neutral-900">
        <Bell className="h-5 w-5 text-[#7C3AED]" /> Thông báo
      </h1>

      {notifications.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Chưa có thông báo nào.
        </p>
      ) : (
        <ul className="space-y-3">
          {notifications.map((n) => (
            <li
              key={n.id}
              className="rounded-xl border border-neutral-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-neutral-900">{n.title}</h2>
                <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                  {n.scope}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600">
                {n.body}
              </p>
              <p className="mt-2 text-xs text-neutral-600">
                {new Date(n.publishedAt).toLocaleString("vi-VN", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  // RSC chạy trên Vercel (UTC) → phải chốt giờ VN, không lấy giờ server.
                  timeZone: "Asia/Ho_Chi_Minh",
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
