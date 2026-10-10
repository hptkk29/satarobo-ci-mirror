"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useChatUnread } from "@/components/chat/use-chat-unread";
import { cn } from "@/lib/utils";
import { Sidebar, SidebarContent } from "./sidebar";
import { TeacherThemeRoot } from "./teacher-theme";
import { Topbar } from "./topbar";

/**
 * Khung site giáo viên — port từ TeachUI `components/layout/app-shell.tsx`.
 * Sidebar cố định 16rem trên desktop, chuyển thành drawer trượt trên mobile.
 */
export function AppShell({
  userId,
  userName,
  adminReturnUrl,
  elearningUrl,
  chatUnread = 0,
  children,
}: {
  /** `User.id` — topic realtime `user:{id}` cho badge tin nhắn. */
  userId: string;
  userName: string;
  /** F3 (Q41) — URL admin cho GV kiêm nhiệm; undefined = không hiện lối về admin. */
  adminReturnUrl?: string;
  /** EL-01 — lối vào khu đào tạo nội bộ; null = cờ OFF → ẩn mục menu. */
  elearningUrl?: string | null;
  /** Số tin chưa đọc do layout (RSC) tính — số ban đầu, KHÔNG fetch ở client. */
  chatUnread?: number;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sidebar được render Ở HAI NƠI (desktop + drawer) nhưng CHỈ MỘT hook ở đây ⇒ đúng một
  // người nghe kênh `user:{id}` và một lượt hỏi lại server cho mỗi cụm tín hiệu.
  const chatCount = useChatUnread(userId, chatUnread);

  return (
    <TeacherThemeRoot>
      <Sidebar chatUnread={chatCount} />

      {/* Drawer mobile */}
      <div
        className={cn(
          "fixed inset-0 z-40 lg:hidden",
          drawerOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!drawerOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-slate-900/40 transition-opacity",
            drawerOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-64 border-r border-border shadow-xl transition-transform",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="absolute top-4 right-3 z-10 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Đóng menu"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          <SidebarContent
            onNavigate={() => setDrawerOpen(false)}
            chatUnread={chatCount}
          />
        </div>
      </div>

      {/* Cột nội dung */}
      <div className="flex min-h-screen flex-1 flex-col lg:pl-64 print:pl-0">
        <Topbar
          userId={userId}
          userName={userName}
          adminReturnUrl={adminReturnUrl}
          elearningUrl={elearningUrl}
          onMenuClick={() => setDrawerOpen(true)}
        />
        {/* Trần bề rộng NỚI DẦN, không nới một phát.
            `max-w-7xl` (1280px) là đủ cho màn 1280–1536. Trên đó nó biến mọi màn rộng
            thành một dải hẹp giữa hai khoảng trống — mà đây là giao diện DỮ LIỆU DÀY,
            người dùng ngồi 6–8 tiếng và cần thấy nhiều dòng cùng lúc (PRODUCT.md §1).
            Ba nấc dưới đây CHỈ nới THÊM ở ≥1536px, nên mọi bề rộng đang dùng hôm nay
            render y hệt — không màn nào hẹp lại. Nấc cuối phục vụ màn 4K/8K.

            ⚠️ CẢ BA nấc dùng `min-[…]`, KHÔNG trộn với `2xl:`. Bản đầu viết
            `2xl:max-w-[88rem] min-[2000px]:… min-[3200px]:…` và ở màn 3840 khung vẫn đứng
            ở 88rem: cả ba điều kiện cùng khớp, và thứ tự trong CSS sinh ra mới là thứ
            quyết — `2xl` không tự biết mình "nhỏ hơn" `min-[3200px]`. Chụp màn 4K mới lộ;
            đọc lớp CSS thì trông hoàn toàn hợp lý. */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 min-[1536px]:max-w-[88rem] min-[2000px]:max-w-[110rem] min-[3200px]:max-w-[140rem] print:max-w-none print:p-0">
          {children}
        </main>
      </div>

      {/* KHÔNG gắn <Toaster> ở đây — layout gốc (app/layout.tsx) đã có MỘT bản cho mọi site
          (đã mang `closeButton` của site GV). Gắn thêm là mỗi toast hiện ĐÔI (26/09/2026). */}
    </TeacherThemeRoot>
  );
}
