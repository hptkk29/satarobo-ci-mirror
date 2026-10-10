"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isNavItemActive,
  navGroups,
  type NavGroup,
  type NavItem,
} from "./nav-config";

function NavLinkItem({
  item,
  onNavigate,
  badgeCount = 0,
}: {
  item: NavItem;
  onNavigate?: () => void;
  /** Số hiện trên badge của mục này (0 = không vẽ). */
  badgeCount?: number;
}) {
  const pathname = usePathname();
  const active = isNavItemActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn("t-nav-link", active && "t-nav-link-active")}
      >
        <Icon
          className={cn(
            "h-[18px] w-[18px] shrink-0",
            active
              ? "text-primary-ink dark:text-primary-ink"
              : "text-muted-foreground",
          )}
          strokeWidth={2}
          aria-hidden
        />
        {/* `min-w-0 flex-1` để nhãn dài bị cắt chứ không đẩy badge ra ngoài khung 16rem. */}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {badgeCount > 0 && (
          <span
            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-state-danger px-1 text-[10px] font-bold text-white"
            aria-label={`${badgeCount} tin chưa đọc`}
          >
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </Link>
    </li>
  );
}

function NavGroupBlock({
  group,
  onNavigate,
  chatUnread,
}: {
  group: NavGroup;
  onNavigate?: () => void;
  chatUnread: number;
}) {
  const [open, setOpen] = useState(!group.collapsed);

  const badgeOf = (item: NavItem) => (item.badge === "chat" ? chatUnread : 0);

  if (group.standalone) {
    return (
      <ul className="space-y-0.5">
        {group.items.map((item) => (
          <NavLinkItem
            key={item.href}
            item={item}
            onNavigate={onNavigate}
            badgeCount={badgeOf(item)}
          />
        ))}
      </ul>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="t-section-label flex w-full items-center justify-between"
      >
        <span>{group.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open ? "rotate-0" : "-rotate-90",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <ul className="space-y-0.5">
          {group.items.map((item) => (
            <NavLinkItem
              key={item.href}
              item={item}
              onNavigate={onNavigate}
              badgeCount={badgeOf(item)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function SidebarNav({
  onNavigate,
  chatUnread = 0,
}: {
  onNavigate?: () => void;
  /** Tổng tin chưa đọc — `AppShell` tính MỘT lần rồi truyền xuống cả hai bản sidebar. */
  chatUnread?: number;
}) {
  return (
    <nav aria-label="Điều hướng giáo viên" className="space-y-1 px-3 pb-6">
      {navGroups.map((group) => (
        <NavGroupBlock
          key={group.label}
          group={group}
          onNavigate={onNavigate}
          chatUnread={chatUnread}
        />
      ))}
    </nav>
  );
}
