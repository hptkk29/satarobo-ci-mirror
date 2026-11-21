"use client";

import { useRouter } from "next/navigation";
import { logoutToGate } from "@/lib/auth/logout-client";
import {
  BookOpenText,
  LogOut,
  ChevronDown,
  GraduationCap,
  Menu,
  User,
  Search,
} from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { RoleSwitcher } from "@/components/admin/role-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { roleLabel } from "@/lib/labels";

interface TopbarProps {
  /** `User.id` — chuông cần để mở kênh realtime của chính người này. */
  userId: string;
  userName?: string | null;
  userRole?: string;
  /** #13 — mọi vai trò user giữ; ≤1 vai thì RoleSwitcher tự ẩn. */
  roles?: string[];
  /** null = đang xem gộp mọi vai trò. */
  activeRole?: string | null;
  /**
   * EL-01 PR3 — URL khu đào tạo nội bộ, hoặc `null` khi cờ ELEARNING_ENABLED OFF.
   *
   * Tính Ở SERVER rồi truyền xuống: component này là client, không đọc được
   * `process.env.ELEARNING_ENABLED`. Đừng đổi sang `NEXT_PUBLIC_*` để đọc trực tiếp —
   * cờ này gác cả đường định tuyến ở middleware, hai nguồn sự thật sẽ lệch nhau.
   */
  elearningUrl?: string | null;
  /**
   * Mở drawer điều hướng trên điện thoại. `undefined` ⇒ KHÔNG vẽ nút — dùng cho nơi nào
   * render Topbar mà không có drawer đi kèm.
   *
   * Trước 13/09/2026 topbar không có nút này, mà sidebar thì `hidden md:flex` ⇒ dưới 768px
   * cả 234 trang admin không điều hướng được. Xem `components/admin/admin-shell.tsx`.
   */
  onMenuClick?: () => void;
}

export function Topbar({
  userId,
  userName,
  userRole,
  roles = [],
  activeRole = null,
  elearningUrl = null,
  onMenuClick,
}: TopbarProps) {
  const router = useRouter();
  const initials = userName
    ? userName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  return (
    <header className="flex h-16 items-center justify-between gap-2 border-b border-border bg-card px-4 md:px-6">
      {/* Nút mở menu — CHỈ trên điện thoại (`md:hidden`), đúng ngưỡng mà thanh cố định
          xuất hiện (`hidden md:flex` ở AdminShell). Hai ngưỡng phải bằng nhau, lệch một
          bậc là có một khoảng bề ngang KHÔNG có thanh cố định LẪN nút mở. */}
      {onMenuClick ? (
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Mở menu điều hướng"
          className="-ml-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      ) : null}

      {/* Search bar — Enter → trang kết quả /search?q= (tìm gộp lead/học viên/tin tức). */}
      <form action="/search" method="GET" className="hidden md:flex flex-1 max-w-md">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            name="q"
            placeholder="Tìm leads, học viên, blog..."
            aria-label="Tìm leads, học viên, tin tức"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border bg-muted focus:bg-card focus:border-primary focus:outline-none transition-colors"
          />
        </div>
      </form>

      <div className="flex items-center gap-2">
        {/* Module nhắc việc — chuông thông báo việc cần xử lý */}
        <RoleSwitcher roles={roles} activeRole={activeRole} />
        {/* Site admin phục vụ ở clean URL không tiền tố /admin ⇒ href lưu trong DB đã đúng
            dạng, không phải đổi gì. */}
        <NotificationBell userId={userId} viewAllHref="/thong-bao" />

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted outline-none transition-colors">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-white text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="hidden text-left md:block">
              <p className="text-sm font-medium text-foreground">{userName ?? "Admin"}</p>
              <p className="text-xs text-muted-foreground">
                {roleLabel(userRole)}
              </p>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {/* /settings/profile không tồn tại (link chết cũ) → trỏ trang Cài đặt
                (có đổi mật khẩu). */}
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <User className="mr-2 h-4 w-4" /> Hồ sơ cá nhân
            </DropdownMenuItem>
            {/* EL-01 PR3 (AC1 bản sửa) — chèn NGAY DƯỚI "Hồ sơ cá nhân" (vị trí
                thứ hai theo BA §9.1). `elearningUrl` null ⇒ không render — null khi cờ OFF
                HOẶC tài khoản không có hồ sơ nhân sự (`lib/elearning/entry.ts`).
                Dùng <a target="_blank"> chứ không router.push: điều hướng CROSS-HOST, và AC1
                đòi mở TAB MỚI để người đang dở việc quản trị không mất trang. */}
            {elearningUrl ? (
              <DropdownMenuItem
                render={
                  <a
                    href={elearningUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <GraduationCap className="mr-2 h-4 w-4" /> Học tập nội bộ
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => router.push("/huong-dan")}>
              <BookOpenText className="mr-2 h-4 w-4" /> Hướng dẫn sử dụng
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-state-danger-ink focus:text-state-danger-ink"
              onClick={() => logoutToGate()}
            >
              <LogOut className="mr-2 h-4 w-4" /> Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
