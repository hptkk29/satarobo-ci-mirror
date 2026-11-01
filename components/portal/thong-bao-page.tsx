"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bell,
  MessageSquare,
  CalendarDays,
  CalendarPlus,
  Wallet,
  GraduationCap,
  ClipboardList,
  Inbox,
  Megaphone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  FeedItem,
  FeedCategory,
  NotificationFeed,
} from "@/lib/portal/notification-feed";
import { PageHero } from "@/components/portal/page-header";

// KHÔNG có mục "Bài tập" — feed chưa nối nguồn Assignment (thêm lại khi có dữ liệu).
const CAT: Record<
  FeedCategory,
  { label: string; icon: LucideIcon; tone: string }
> = {
  NHAN_XET: {
    label: "Nhận xét",
    icon: MessageSquare,
    tone: "bg-quiz/10 text-quiz",
  },
  LICH_HOC: {
    label: "Lịch học",
    icon: CalendarDays,
    tone: "bg-info/10 text-info",
  },
  HOC_BU: {
    label: "Học bù",
    icon: CalendarPlus,
    tone: "bg-caution/10 text-caution",
  },
  HOC_PHI: {
    label: "Học phí",
    icon: Wallet,
    tone: "bg-primary/10 text-primary",
  },
  HOC_BA: {
    label: "Học bạ",
    icon: GraduationCap,
    tone: "bg-accent-soft text-accent",
  },
  KHAO_SAT: {
    label: "Khảo sát",
    icon: ClipboardList,
    tone: "bg-success/10 text-success",
  },
  // Notification trung tâm/cơ sở/lớp — nội dung tự do, không gán nhãn "Lịch học".
  THONG_BAO: {
    label: "Trung tâm",
    icon: Megaphone,
    tone: "bg-info/10 text-info",
  },
};
const ORDER: FeedCategory[] = [
  "NHAN_XET",
  "THONG_BAO",
  "LICH_HOC",
  "HOC_BU",
  "HOC_PHI",
  "HOC_BA",
  "KHAO_SAT",
];

// Đích điều hướng theo danh mục — thẻ bấm được để dẫn phụ huynh tới trang hành
// động tiếp theo. THONG_BAO (nội dung tự do, không có trang đích) → KHÔNG link,
// giữ thẻ tĩnh thay vì link chết.
const CAT_HREF: Partial<Record<FeedCategory, string>> = {
  NHAN_XET: "/portal/nhan-xet",
  LICH_HOC: "/portal/lich",
  HOC_BU: "/portal/yeu-cau",
  HOC_PHI: "/portal/hoc-phi",
  HOC_BA: "/portal/hoc-ba",
  KHAO_SAT: "/portal/khao-sat",
};

function timeAgo(iso: string): string {
  // Clamp ≥ 0: mốc tương lai (dữ liệu lệch giờ) không được ra số âm.
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const h = Math.round(diff / 3_600_000);
  if (h < 1) return "Vừa xong";
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  return `${d} ngày trước`;
}

export function ThongBaoPageV2({
  feed,
  overline = "Cổng phụ huynh",
  subtitle = "Cập nhật về học tập, lịch học, học phí, học bù và khảo sát của các con.",
}: {
  feed: NotificationFeed;
  overline?: string;
  subtitle?: string;
}) {
  const [sel, setSel] = useState<FeedCategory | "ALL">("ALL");
  const shown =
    sel === "ALL" ? feed.items : feed.items.filter((i) => i.category === sel);
  const unread = shown.filter((i) => !i.read);
  const read = shown.filter((i) => i.read);

  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      {/* 04/09 — trạng thái đã-đọc nay CÓ THẬT (`PortalFeedRead`), đánh dấu tự động khi
          mở trang (`DanhDauDaDoc` dựng từ page.tsx). Chưa làm nút "Đọc tất cả" vì mở
          trang đã là đọc — thêm nút là bắt bấm cho việc vừa xảy ra. */}
      <PageHero
        icon={Bell}
        overline={overline}
        title="Thông báo"
        subtitle={subtitle}
      />

      {/* Mobile (<lg): bộ lọc = dải chip cuộn ngang 1 dòng — aside dọc 8 dòng chiếm
          nguyên màn hình 375px, đẩy thông báo mới xuống dưới fold. */}
      <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
        <FilterChip
          label="Tất cả"
          count={feed.unreadTotal}
          active={sel === "ALL"}
          onClick={() => setSel("ALL")}
        />
        {ORDER.map((k) => (
          <FilterChip
            key={k}
            label={CAT[k].label}
            count={feed.unreadByCategory[k]}
            active={sel === k}
            onClick={() => setSel(k)}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_1fr]">
        {/* Bộ lọc danh mục — sidebar dọc chỉ từ lg trở lên */}
        <aside className="hidden space-y-1 rounded-2xl border border-border bg-card p-2 lg:block">
          <FilterRow
            icon={Inbox}
            label="Tất cả"
            count={feed.unreadTotal}
            active={sel === "ALL"}
            onClick={() => setSel("ALL")}
          />
          {ORDER.map((k) => (
            <FilterRow
              key={k}
              icon={CAT[k].icon}
              label={CAT[k].label}
              count={feed.unreadByCategory[k]}
              active={sel === k}
              onClick={() => setSel(k)}
            />
          ))}
        </aside>

        {/* Danh sách — nhãn "Mới"/"Trước đó" (heuristic 2 ngày), KHÔNG tự nhận
            "chưa đọc/đã đọc" khi hệ thống chưa lưu trạng thái đọc theo phụ huynh. */}
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Mới ({unread.length})
            </h2>
            {unread.length === 0 ? (
              <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                Không có thông báo mới.
              </p>
            ) : (
              unread.map((n) => <Card key={n.id} n={n} unread />)
            )}
          </section>

          {read.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Trước đó
              </h2>
              {read.map((n) => (
                <Card key={n.id} n={n} />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// Chip lọc cho mobile — h-10 (40px) đủ vùng bấm, shrink-0 + whitespace-nowrap để
// cuộn ngang trong container overflow-x-auto (không gây scroll ngang cả trang).
function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors ${active ? "border-accent bg-accent-soft text-accent" : "border-border bg-card text-muted-foreground"}`}
    >
      {label}
      {count > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${active ? "bg-accent text-accent-foreground" : "bg-primary/10 text-primary"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function FilterRow({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${active ? "bg-accent-soft text-accent" : "text-muted-foreground hover:bg-muted"}`}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {count > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${active ? "bg-accent text-accent-foreground" : "bg-primary/10 text-primary"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function Card({ n, unread }: { n: FeedItem; unread?: boolean }) {
  const c = CAT[n.category];
  const Icon = c.icon;
  const href = CAT_HREF[n.category];
  const cls = `block rounded-2xl border bg-card p-4 ${unread ? "border-l-4 border-l-primary border-y-border border-r-border" : "border-border"}`;
  const inner = (
    <div className="flex items-start gap-3">
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-xl ${c.tone}`}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3
            className={`text-sm ${unread ? "font-bold text-foreground" : "font-semibold text-foreground/90"}`}
          >
            {n.title}
          </h3>
          {n.childName && (
            <span className="shrink-0 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
              {n.childName.split(" ").slice(-2).join(" ")}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
        <p className="mt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
          {c.label} · <span className="normal-case">{timeAgo(n.at)}</span>
        </p>
      </div>
    </div>
  );

  // Nguyên thẻ = vùng bấm dẫn tới trang hành động (học phí/học bù/học bạ/khảo sát…).
  if (href) {
    return (
      <Link
        href={href}
        className={`${cls} transition-colors hover:border-accent/60`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}
