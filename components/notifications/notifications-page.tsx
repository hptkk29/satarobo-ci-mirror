"use client";

// components/notifications/notifications-page.tsx — trang "Tất cả thông báo", dùng chung 2 site.
//
// ⚠️ RÀNG BUỘC CỐT LÕI CỦA PRD: trang này KHÔNG ĐƯỢC XUẤT HIỆN TRÊN SIDEBAR. Chỉ vào được từ chân
// panel chuông hoặc gõ URL thẳng. Sidebar đã chật; thêm một mục nữa là loãng cấu trúc điều hướng,
// và cả thiết kế này dựng trên tiền đề "chuông là điểm vào DUY NHẤT". Nếu nghiệm thu cho thấy
// người dùng không tìm ra trang, cách chữa là onboarding hoặc thêm mục trong menu avatar —
// TUYỆT ĐỐI không phải thêm sidebar.
//
// Thứ tự ở đây là THỜI GIAN, khác panel (sắp theo độ khẩn). Cố ý: panel để biết "giờ làm gì
// trước", trang này để TRA LẠI ("tuần trước ai giao việc cho tôi") — mà tra lại thì mốc thời gian
// là trục duy nhất người ta nhớ.

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ArrowLeft, CheckCheck, Inbox, Search } from "lucide-react";
import { toast } from "sonner";
import { NOTI_GROUPS } from "@/lib/notifications/catalog";
import type { NotificationItem } from "@/lib/notifications/service";

const MAU_NHOM: Record<string, string> = Object.fromEntries(
  NOTI_GROUPS.map((g) => [g.key, g.color]),
);

const KHOANG = [
  { key: "", label: "Toàn bộ" },
  { key: "today", label: "Hôm nay" },
  { key: "7d", label: "7 ngày" },
  { key: "30d", label: "30 ngày" },
] as const;

export interface NotificationsPageProps {
  /** Trang đầu do RSC nạp sẵn — vào là thấy nội dung, không chớp màn trống. */
  initialItems: NotificationItem[];
  initialCursor: string | null;
  /** Số chưa đọc từng nhóm, để rail trái hiện số ngay. */
  groupCounts: { key: string; label: string; unread: number }[];
  resolveHref?: (href: string | null) => string | null;
}

/** Gộp theo ngày giờ VN — "Hôm nay" / "Hôm qua" / "dd/MM/yyyy". */
function nhanNgay(iso: string, now: Date): string {
  const d = new Date(iso);
  const key = (x: Date) => new Date(x.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const k = key(d);
  if (k === key(now)) return "Hôm nay";
  if (k === key(new Date(now.getTime() - 86_400_000))) return "Hôm qua";
  const [y, m, day] = k.split("-");
  return `${day}/${m}/${y}`;
}

export function NotificationsPage({
  initialItems,
  initialCursor,
  groupCounts,
  resolveHref,
}: NotificationsPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [dangTai, setDangTai] = useState(false);
  const [q, setQ] = useState(sp.get("q") ?? "");

  // Bộ lọc đổi ⇒ URL đổi ⇒ RSC nạp lại ⇒ prop đổi. Đồng bộ state theo prop, KHÔNG fetch lại ở đây.
  useEffect(() => {
    setItems(initialItems);
    setCursor(initialCursor);
  }, [initialItems, initialCursor]);

  const nhom = sp.get("group") ?? "";
  const trangThai = sp.get("status") ?? "all";
  const khoang = sp.get("range") ?? "";

  /** Bộ lọc phản ánh vào URL để chia sẻ được và tải lại vẫn giữ nguyên (PRD US-05 AC4). */
  const doiLoc = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(sp.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      // GIỮ NGUYÊN TRANG — chỉ đổi tham số truy vấn của chính `pathname` này. Thiếu
      // `scroll: false` thì ScrollAndFocusHandler của App Router cuộn về đầu sau mỗi
      // lần bấm nhóm/trạng thái/khoảng thời gian, đang đọc giữa danh sách thì mất chỗ.
      router.push(`${pathname}?${next}`, { scroll: false });
    },
    [router, pathname, sp],
  );

  async function taiThem() {
    if (!cursor || dangTai) return;
    setDangTai(true);
    try {
      const qs = new URLSearchParams(sp.toString());
      qs.set("cursor", cursor);
      const res = await fetch(`/api/notifications?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items: NotificationItem[]; nextCursor: string | null };
      setItems((cur) => [...cur, ...data.items]);
      setCursor(data.nextCursor);
    } catch {
      toast.error("Không tải thêm được. Thử lại.");
    } finally {
      setDangTai(false);
    }
  }

  async function moMuc(item: NotificationItem) {
    setItems((cur) =>
      cur.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)),
    );
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", id: item.id }),
    }).catch(() => null);

    // PHẢI hoàn nguyên khi ghi hỏng: nếu không, mục mờ đi như đã xử lý trong khi badge chuông
    // (đọc từ /summary) vẫn đếm nó — hai chỗ trên cùng màn hình nói hai điều khác nhau, và người
    // dùng không hề được báo là chưa ghi được gì.
    if (!res?.ok) {
      setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, readAt: item.readAt } : i)));
      toast.error("Không đánh dấu được. Thử lại.");
      return;
    }

    const dich = resolveHref ? resolveHref(item.href) : item.href;
    if (dich) router.push(dich);
  }

  /** Mô tả bộ lọc đang áp — để nút và toast nói đúng phạm vi thao tác, không nói "tất cả" chung chung. */
  const moTaLoc = [
    nhom ? groupCounts.find((g) => g.key === nhom)?.label : null,
    KHOANG.find((k) => k.key && k.key === khoang)?.label,
    q.trim() ? `"${q.trim()}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  async function docHet() {
    // Gửi kèm ĐỦ bộ lọc đang hiển thị — nhóm, khoảng thời gian, từ khoá. Chỉ gửi nhóm là bấm nút
    // trên màn đang lọc "Hôm nay" mà đọc luôn cả ba tháng trước, và không có Hoàn tác để lùi.
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "read-all",
        ...(nhom ? { group: nhom } : {}),
        ...(khoang ? { range: khoang } : {}),
        ...(q.trim() ? { q: q.trim() } : {}),
      }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error("Không đánh dấu được. Thử lại.");
      return;
    }
    const data = (await res.json().catch(() => null)) as { count?: number } | null;
    toast.success(
      `Đã đánh dấu đã đọc${data?.count ? ` ${data.count} mục` : ""}${moTaLoc ? ` (${moTaLoc})` : ""}`,
    );
    router.refresh();
  }

  const now = new Date();
  let ngayTruoc = "";

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Quay lại
        </button>
        <h1 className="text-lg font-bold text-foreground">Tất cả thông báo</h1>
        <div className="flex-1" />
        <button
          type="button"
          onClick={docHet}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <CheckCheck className="h-4 w-4" aria-hidden /> Đánh dấu đã đọc
          {moTaLoc && ` (${moTaLoc})`}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* Rail lọc — trên mobile nằm trên danh sách, cuộn ngang được */}
        <aside className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Nhóm
            </p>
            <div className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              <button
                type="button"
                onClick={() => doiLoc("group", "")}
                aria-pressed={!nhom}
                className={`shrink-0 rounded-lg px-2 py-1.5 text-left text-sm ${
                  !nhom ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                Tất cả
              </button>
              {groupCounts.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => doiLoc("group", g.key)}
                  aria-pressed={nhom === g.key}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                    nhom === g.key
                      ? "bg-muted font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: MAU_NHOM[g.key] ?? "#5B6472" }}
                  />
                  {g.label}
                  {g.unread > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">{g.unread}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Trạng thái
            </p>
            <div className="flex gap-1">
              {[
                { key: "all", label: "Tất cả" },
                { key: "unread", label: "Chưa đọc" },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => doiLoc("status", t.key === "all" ? "" : t.key)}
                  aria-pressed={trangThai === t.key}
                  className={`rounded-lg px-2 py-1 text-sm ${
                    trangThai === t.key
                      ? "bg-muted font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Thời gian
            </p>
            <div className="flex flex-wrap gap-1">
              {KHOANG.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => doiLoc("range", k.key)}
                  aria-pressed={khoang === k.key}
                  className={`rounded-lg px-2 py-1 text-sm ${
                    khoang === k.key
                      ? "bg-muted font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              doiLoc("q", q.trim());
            }}
          >
            <label htmlFor="noti-q" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tìm kiếm
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                id="noti-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tiêu đề hoặc nội dung…"
                className="w-full rounded-lg border border-border bg-muted py-1.5 pl-7 pr-2 text-sm focus:border-primary focus:bg-card focus:outline-none"
              />
            </div>
          </form>
        </aside>

        <div className="rounded-xl border border-border bg-card">
          {items.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <Inbox className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm text-foreground">Không có thông báo nào khớp bộ lọc.</p>
            </div>
          ) : (
            items.map((i) => {
              const nhan = nhanNgay(i.createdAt, now);
              const dauNgay = nhan !== ngayTruoc;
              ngayTruoc = nhan;
              const dich = resolveHref ? resolveHref(i.href) : i.href;
              return (
                <div key={i.id}>
                  {dauNgay && (
                    <p className="border-b border-border bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {nhan}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void moMuc(i)}
                    className={`flex w-full gap-2 border-b border-border px-3 py-3 text-left hover:bg-muted ${
                      i.readAt ? "opacity-60" : ""
                    }`}
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: MAU_NHOM[i.groupKey] ?? "#5B6472" }}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {i.priority === 1 && "KHẨN · "}
                        {i.groupLabel}
                      </span>
                      <p className="truncate text-sm font-semibold text-foreground">{i.title}</p>
                      <p className="text-xs text-muted-foreground">{i.body}</p>
                      {!dich && i.href && (
                        <p className="mt-0.5 text-[11px] italic text-muted-foreground">
                          Xem chi tiết trên trang quản trị
                        </p>
                      )}
                    </div>
                    {!i.readAt && (
                      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                </div>
              );
            })
          )}

          {cursor && (
            <div className="p-3 text-center">
              <button
                type="button"
                onClick={taiThem}
                disabled={dangTai}
                className="rounded-lg px-3 py-1.5 text-sm text-primary hover:bg-muted disabled:opacity-50"
              >
                {dangTai ? "Đang tải…" : "Tải thêm"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
