// hub-tab-bar.tsx — thanh tab của Class Hub (điều hướng qua searchParams ?tab=).
//
// Server component thuần (chỉ <Link>): mỗi tab dùng href CHỈ-query để giữ path hiện
// tại → chạy đúng cả trên host giaovien (clean URL /lop) LẪN localhost (path thật
// /teacher/lop). Tab đang chọn tô cam + gạch chân, khớp reference TeachUI.
import Link from "next/link";
import {
  BookOpen,
  ClipboardCheck,
  ClipboardPen,
  Images,
  NotebookPen,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type HubTabKey =
  | "hoc-vien"
  | "diem-danh"
  | "nhan-xet"
  | "bai-tap"
  | "tai-lieu"
  | "anh-lop";

export const HUB_DEFAULT_TAB: HubTabKey = "diem-danh";

const TABS: { key: HubTabKey; label: string; icon: LucideIcon }[] = [
  { key: "hoc-vien", label: "Học viên", icon: Users },
  { key: "diem-danh", label: "Điểm danh", icon: ClipboardCheck },
  { key: "nhan-xet", label: "Nhận xét", icon: ClipboardPen },
  { key: "bai-tap", label: "Bài tập & Kiểm tra", icon: NotebookPen },
  { key: "tai-lieu", label: "Tài liệu học phần", icon: BookOpen },
  { key: "anh-lop", label: "Ảnh lớp", icon: Images },
];

export function parseHubTab(raw: string | undefined): HubTabKey {
  const found = TABS.find((t) => t.key === raw);
  return found ? found.key : HUB_DEFAULT_TAB;
}

export function HubTabBar({
  classId,
  active,
  attendancePending,
}: {
  classId: string;
  active: HubTabKey;
  /** Badge trên tab Điểm danh: số buổi đã tới ngày chưa điểm danh. */
  attendancePending: number;
}) {
  return (
    <div className="mb-6 overflow-x-auto">
      <nav
        className="flex min-w-max gap-1 border-b border-border"
        aria-label="Khu vực quản lý lớp"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.key === active;
          const badge =
            t.key === "diem-danh" && attendancePending > 0
              ? attendancePending
              : null;
          return (
            <Link
              key={t.key}
              href={`?classId=${classId}&tab=${t.key}`}
              // Đổi tab = ở NGUYÊN trang hub của lớp, chỉ đổi ?tab= → không cho
              // App Router cuộn về đầu (ScrollAndFocusHandler), kẻo thanh tab vừa
              // bấm biến khỏi tầm mắt.
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "border-primary text-primary-ink dark:border-primary dark:text-primary-ink"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t.label}
              {badge && (
                <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-soft px-1.5 text-xs font-bold text-primary-ink">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
