"use client";

// Cột danh sách hội thoại của màn Tin nhắn (nhân viên).
//
// Gộp HAI nguồn vào MỘT ô tìm, vì với người dùng chúng là một câu hỏi duy nhất — "tôi muốn
// nhắn cho ai":
//   1. HỘI THOẠI ĐÃ CÓ (nhóm lớp + nhắn riêng) — lọc theo tên hiển thị;
//   2. PHỤ HUYNH MÌNH ĐƯỢC GÁN nhưng CHƯA có kênh — chọn là mở kênh mới ngay.
//
// ⚠️ Lọc ở CLIENT, không gọi server mỗi lần gõ. Hai danh sách đã nằm sẵn trong payload RSC của
// trang (hội thoại vốn phải tải để vẽ danh sách; phụ huynh được gán trần 500 dòng). Gõ tới đâu
// thấy tới đó, không có trạng thái "đang tìm…", và không thêm một endpoint nào phải đi bảo vệ.
//
// ⚠️ Nhóm lớp LUÔN được xếp lên TRƯỚC khi không tìm kiếm gì: đây chính là yêu cầu "tránh tin
// nhắn nhiều phụ huynh làm trôi mất nhóm lớp".
//
// Màn dùng chung với site giáo viên ⇒ chỉ token `:root` (xem `chat-ui.tsx`).

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Search, X, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { OpenDmButton } from "../open-dm-button";
import { Chip, ConversationTile, listTimeLabel } from "./chat-ui";

export type SearchConversation = {
  conversationId: string;
  displayName: string;
  type: string;
  preview: string | null;
  unreadCount: number;
  isArchived: boolean;
  lastMessageAt: Date | null;
};

export type SearchParent = {
  parentUserId: string;
  parentName: string | null;
  childLabels: string[];
};

type Filter = "all" | "groups" | "direct" | "unread";

/** Bỏ dấu để gõ "an" ra "Bé Ân" — người dùng không gõ dấu khi tìm nhanh. */
function chuanHoa(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
}

const subscribeNever = () => () => {};
/** `Date.now()` chỉ có từ phía client — server trả 0 để HTML ban đầu không lệch lúc hydrate. */
function useNow(): number {
  return useSyncExternalStore(
    subscribeNever,
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => 0,
  );
}

export function ConversationSearch({
  conversations,
  parents,
  basePath,
  selectedId,
  headerAction,
}: {
  conversations: SearchConversation[];
  /** Rỗng với vai không mở được kênh mới (GV/QLCS) — khi đó ô chỉ lọc hội thoại. */
  parents: SearchParent[];
  basePath: string;
  selectedId: string | null;
  /** Nút hành động đứng cạnh tiêu đề cột (vd "Thêm đồng loạt" — chỉ Admin). */
  headerAction?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const now = useNow();
  const tuKhoa = chuanHoa(q);

  const unreadTotal = useMemo(
    () => conversations.reduce((s, c) => s + (c.unreadCount > 0 ? 1 : 0), 0),
    [conversations],
  );

  const { nhomLop, nhanRieng, phMoi } = useMemo(() => {
    const khop = (s: string | null | undefined) => !tuKhoa || chuanHoa(s ?? "").includes(tuKhoa);
    const hopLe = conversations.filter(
      (c) =>
        (khop(c.displayName) || khop(c.preview)) &&
        (filter !== "unread" || c.unreadCount > 0) &&
        (filter !== "groups" || c.type === "CLASS_GROUP") &&
        (filter !== "direct" || c.type !== "CLASS_GROUP"),
    );
    // Phụ huynh ĐÃ có kênh riêng thì không hiện lại ở khối "mở kênh mới" — trùng lặp làm
    // người dùng phân vân không biết bấm cái nào.
    const daCoKenh = new Set(
      conversations.filter((c) => c.type !== "CLASS_GROUP").map((c) => chuanHoa(c.displayName)),
    );
    return {
      nhomLop: hopLe.filter((c) => c.type === "CLASS_GROUP"),
      nhanRieng: hopLe.filter((c) => c.type !== "CLASS_GROUP"),
      phMoi:
        tuKhoa && (filter === "all" || filter === "direct")
          ? parents.filter(
              (p) =>
                !daCoKenh.has(chuanHoa(p.parentName ?? "")) &&
                (khop(p.parentName) || p.childLabels.some((l) => khop(l))),
            )
          : [],
    };
  }, [conversations, parents, tuKhoa, filter]);

  const tong = nhomLop.length + nhanRieng.length + phMoi.length;

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "Tất cả" },
    { key: "groups", label: "Nhóm lớp" },
    { key: "direct", label: "Riêng" },
    { key: "unread", label: unreadTotal > 0 ? `Chưa đọc (${unreadTotal})` : "Chưa đọc" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="space-y-3 border-b border-border p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold text-foreground">Tin nhắn</h1>
          {headerAction}
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm nhóm lớp, phụ huynh, học viên…"
            aria-label="Tìm hội thoại hoặc phụ huynh"
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-9 text-sm outline-none focus:border-primary"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Xoá từ khoá"
              className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc hội thoại">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                "h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors",
                filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tong === 0 && (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">
            {tuKhoa
              ? `Không có kết quả cho “${q}”.`
              : filter === "unread"
                ? "Không có tin chưa đọc."
                : "Chưa có hội thoại nào."}
          </p>
        )}

        <Khoi tieuDe="Nhóm lớp" so={nhomLop.length}>
          {nhomLop.map((c) => (
            <DongHoiThoai key={c.conversationId} c={c} basePath={basePath} selectedId={selectedId} now={now} />
          ))}
        </Khoi>

        <Khoi tieuDe="Nhắn riêng" so={nhanRieng.length}>
          {nhanRieng.map((c) => (
            <DongHoiThoai key={c.conversationId} c={c} basePath={basePath} selectedId={selectedId} now={now} />
          ))}
        </Khoi>

        <Khoi tieuDe="Phụ huynh bạn phụ trách — chưa có kênh" so={phMoi.length}>
          {phMoi.map((p) => (
            <li key={p.parentUserId} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
              <span
                aria-hidden
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
              >
                <UserPlus className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{p.parentName ?? "Phụ huynh"}</p>
                {p.childLabels.length > 0 && (
                  <p className="truncate text-xs text-muted-foreground">{p.childLabels.join(" · ")}</p>
                )}
              </div>
              <OpenDmButton
                peerUserId={p.parentUserId}
                kind="SALE_PARENT"
                hrefTemplate={`${basePath}?c=:id`}
                label="Mở kênh"
              />
            </li>
          ))}
        </Khoi>
      </div>
    </div>
  );
}

function Khoi({
  tieuDe,
  so,
  children,
}: {
  tieuDe: string;
  so: number;
  children: React.ReactNode;
}) {
  if (so === 0) return null;
  return (
    <section>
      <h2 className="sticky top-0 z-10 flex items-center gap-1.5 bg-card/95 px-4 pb-1.5 pt-3 text-xs font-semibold text-muted-foreground backdrop-blur-sm">
        {tieuDe}
        <span className="font-normal">{so}</span>
      </h2>
      <ul>{children}</ul>
    </section>
  );
}

function DongHoiThoai({
  c,
  basePath,
  selectedId,
  now,
}: {
  c: SearchConversation;
  basePath: string;
  selectedId: string | null;
  now: number;
}) {
  const dangChon = c.conversationId === selectedId;
  const chuaDoc = c.unreadCount > 0;
  return (
    <li>
      <Link
        href={`${basePath}?c=${c.conversationId}`}
        aria-current={dangChon ? "page" : undefined}
        className={cn(
          "relative flex min-h-[4.25rem] items-center gap-3 px-3 py-2.5 transition-colors sm:px-4",
          dangChon ? "bg-primary/10" : "hover:bg-muted/70",
        )}
      >
        {dangChon && <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />}
        <ConversationTile type={c.type} archived={c.isArchived} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn("truncate text-sm text-foreground", chuaDoc ? "font-semibold" : "font-medium")}>
              {c.displayName}
            </p>
            {c.lastMessageAt && (
              <time
                dateTime={c.lastMessageAt.toISOString()}
                suppressHydrationWarning
                className="shrink-0 text-[11px] text-muted-foreground"
              >
                {listTimeLabel(c.lastMessageAt, now)}
              </time>
            )}
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className={cn("truncate text-xs", chuaDoc ? "text-foreground" : "text-muted-foreground")}>
              {c.preview ?? "Chưa có tin nhắn"}
            </p>
            {c.isArchived && <Chip className="shrink-0">Đã lưu trữ</Chip>}
            {chuaDoc && (
              <span
                className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground"
                aria-label={`${c.unreadCount} tin chưa đọc`}
              >
                {c.unreadCount > 99 ? "99+" : c.unreadCount}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
