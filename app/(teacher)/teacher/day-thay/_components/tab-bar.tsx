// Thanh tab của màn "Dạy thay" — điều hướng qua ?tab= (server component thuần, chỉ <Link>).
// Href CHỈ-query để giữ path hiện tại: chạy đúng cả trên host giaovien (clean URL) lẫn localhost.
import Link from "next/link";
import { BookOpen, ClipboardCheck, ClipboardPen, NotebookPen, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type DayThayTab = "hoc-vien" | "diem-danh" | "nhan-xet" | "bai-tap" | "tai-lieu";

const TABS: { key: DayThayTab; label: string; icon: LucideIcon }[] = [
  { key: "hoc-vien", label: "Học viên", icon: Users },
  { key: "diem-danh", label: "Điểm danh", icon: ClipboardCheck },
  { key: "nhan-xet", label: "Nhận xét", icon: ClipboardPen },
  { key: "bai-tap", label: "Bài tập & Kiểm tra", icon: NotebookPen },
  { key: "tai-lieu", label: "Tài liệu học phần", icon: BookOpen },
];

/** Tab mặc định theo thời điểm: chưa tới ngày dạy thì chuẩn bị (xem học viên), tới ngày thì vào việc (điểm danh). */
export function tabMacDinh(daToiNgayDay: boolean): DayThayTab {
  return daToiNgayDay ? "diem-danh" : "hoc-vien";
}

export function parseTab(raw: string | undefined, macDinh: DayThayTab): DayThayTab {
  return TABS.find((t) => t.key === raw)?.key ?? macDinh;
}

export function DayThayTabBar({
  active,
  conLaiDiemDanh,
  conLaiNhanXet,
}: {
  active: DayThayTab;
  /** Số bé chưa điểm danh (0 = không vẽ badge). */
  conLaiDiemDanh: number;
  /** Số bé có mặt chưa có nhận xét (0 = không vẽ badge). */
  conLaiNhanXet: number;
}) {
  return (
    <div className="mb-6 overflow-x-auto">
      <nav className="flex min-w-max gap-1 border-b border-border" aria-label="Khu vực của buổi dạy thay">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.key === active;
          const badge = t.key === "diem-danh" ? conLaiDiemDanh : t.key === "nhan-xet" ? conLaiNhanXet : 0;
          return (
            <Link
              key={t.key}
              href={`?tab=${t.key}`}
              // Đổi tab = ở NGUYÊN trang, chỉ đổi ?tab= — không cho App Router cuộn về đầu kẻo thanh tab biến khỏi tầm mắt.
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "border-primary text-primary-ink"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t.label}
              {badge > 0 && (
                <span
                  className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-soft px-1.5 text-xs font-bold text-primary-ink"
                  aria-label={`còn ${badge} bé`}
                >
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
