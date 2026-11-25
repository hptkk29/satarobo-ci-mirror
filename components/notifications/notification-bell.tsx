"use client";

// components/notifications/notification-bell.tsx — ĐIỂM VÀO DUY NHẤT của hệ thông báo.
//
// Dùng chung cho site admin và site giáo viên. Trước đây là hai bản chép tay gần y hệt nhau, khác
// đúng chỗ đổi href — sửa một bên quên bên kia là chuyện đã xảy ra. Nay khác biệt đó là một prop.
//
// BA LUẬT KHÔNG ĐƯỢC PHÁ (mỗi luật ứng với một rủi ro PRD tự xếp hạng "chặn phát hành"):
//  1. MỞ PANEL KHÔNG LÀM BADGE VỀ 0. Mở panel chỉ đặt "đã nhìn thấy" (`seen`); "đã đọc" (`read`)
//     chỉ xảy ra khi người dùng bấm vào mục hoặc bấm nút đánh dấu. Lướt panel lúc đang bận mà
//     badge bay sạch thì đúng những việc chưa kịp đọc là những việc biến mất — chính là vấn đề
//     mà cả tính năng này sinh ra để giải.
//  2. CON SỐ CHỈ ĐẾN TỪ SERVER. `badge.label` do backend tính; ở đây chỉ vẽ lại. Frontend tự đếm
//     là có ngày chuông, tiêu đề tab và mobile lệch nhau mà không ai biết bên nào đúng.
//  3. MÀU KHÔNG BAO GIỜ ĐỨNG MỘT MÌNH. Mỗi nhóm luôn có nhãn chữ đi kèm vạch màu.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Check, Inbox, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { NOTI_GROUPS, type NotiGroupKey } from "@/lib/notifications/catalog";
import type { NotificationItem } from "@/lib/notifications/service";
import { useNotificationSummary } from "./use-notification-summary";
import { useTabBadge } from "./use-tab-badge";

const MAU_NHOM: Record<string, string> = Object.fromEntries(
  NOTI_GROUPS.map((g) => [g.key, g.color]),
);

/** Cửa sổ Hoàn tác của PRD §7.9 — đủ để nhận ra mình bấm nhầm, không đủ để quên mất. */
const UNDO_MS = 10_000;

type Chip = { key: NotiGroupKey | "all"; label: string; unread: number };

export interface NotificationBellProps {
  /** `User.id` — topic realtime của chính người này. Rỗng = không mở kênh, chỉ hỏi định kỳ. */
  userId: string;
  /**
   * Đổi href (đường admin clean-URL) sang đường của site đang chạy.
   * Site admin: bỏ trống (đi thẳng). Site giáo viên: truyền `teacherHref`.
   * Trả `null` = site này không có màn tương ứng → hiện chữ, KHÔNG gắn link chết.
   */
  resolveHref?: (href: string | null) => string | null;
  /** Đường tới trang "Tất cả thông báo" trên site đang chạy. */
  viewAllHref?: string;
}

function thoiGianTuongDoi(iso: string, now: number): string {
  const phut = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (phut < 1) return "vừa xong";
  if (phut < 60) return `${phut} phút`;
  const gio = Math.round(phut / 60);
  if (gio < 24) return `${gio} giờ`;
  const ngay = Math.round(gio / 24);
  return ngay === 1 ? "hôm qua" : `${ngay} ngày`;
}

export function NotificationBell({
  userId,
  resolveHref,
  viewAllHref = "/thong-bao",
}: NotificationBellProps) {
  const router = useRouter();
  const { summary, refresh } = useNotificationSummary(userId);

  const [open, setOpen] = useState(false);
  const [nhom, setNhom] = useState<NotiGroupKey | "all">("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [conLai, setConLai] = useState(0);
  const [dangTai, setDangTai] = useState(false);
  const [loi, setLoi] = useState(false);
  const [conTro, setConTro] = useState(-1);

  const boc = useRef<HTMLDivElement>(null);
  const nutChuong = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dsRef = useRef<HTMLDivElement>(null);

  useTabBadge(summary.totalUnread);

  const badge = summary.badge;

  const chips: Chip[] = useMemo(
    () => [
      { key: "all", label: "Tất cả", unread: summary.totalUnread },
      ...summary.groups.map((g) => ({ key: g.key, label: g.label, unread: g.unread })),
    ],
    [summary],
  );

  // Số thứ tự lượt tải. Đổi chip trên mạng chậm thì phản hồi của chip CŨ có thể về SAU chip mới;
  // không có mốc này thì panel hiện danh sách nhóm A dưới nhãn nhóm B — và tệ hơn, `seen` được
  // ghi cho đúng những mục hiển thị dưới nhãn sai (mốc đó chỉ ghi một lần, không sửa lại được).
  const luot = useRef(0);

  const tai = useCallback(
    async (g: NotiGroupKey | "all") => {
      const cua = ++luot.current;
      setDangTai(true);
      setLoi(false);
      try {
        const qs = new URLSearchParams({ mode: "panel" });
        if (g !== "all") qs.set("group", g);
        const res = await fetch(`/api/notifications?${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { items: NotificationItem[]; remaining: number };
        if (cua !== luot.current) return; // lượt cũ về muộn — bỏ
        setItems(data.items);
        setConLai(data.remaining);

        // Đặt "đã nhìn thấy" cho đúng những mục vừa hiện ra. KHÔNG đụng "đã đọc" — luật 1.
        const chuaThay = data.items.filter((i) => !i.seenAt).map((i) => i.id);
        if (chuaThay.length > 0) {
          void fetch("/api/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "seen", ids: chuaThay }),
          });
        }
      } catch {
        if (cua === luot.current) setLoi(true);
      } finally {
        if (cua === luot.current) setDangTai(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (open) void tai(nhom);
  }, [open, nhom, tai]);

  // Mở panel thì DỜI TIÊU ĐIỂM vào panel. Thiếu bước này, người dùng bàn phím mở panel bằng Enter
  // xong thì tiêu điểm vẫn nằm ở nút chuông — nút là ANH EM của panel, nên Esc/↑↓/R phát ra ở đó
  // không bao giờ đi qua `onKeyDown` của panel: mọi phím tắt chết ngay lúc cần nhất.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Đóng khi bấm ra ngoài.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boc.current && !boc.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const dong = useCallback(() => {
    setOpen(false);
    setConTro(-1);
    // Trả tiêu điểm về chuông — người dùng bàn phím không bị rơi ra đầu trang.
    nutChuong.current?.focus();
  }, []);

  async function danhDauDoc(item: NotificationItem, dieuHuong: boolean) {
    // Cập nhật lạc quan để bấm thấy phản hồi ngay; sai thì lượt `refresh()` kéo về đúng.
    setItems((cur) =>
      cur.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)),
    );

    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", id: item.id }),
    }).catch(() => null);

    if (!res?.ok) {
      setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, readAt: item.readAt } : i)));
      toast.error("Không đánh dấu được. Thử lại.");
      return;
    }
    refresh();

    if (!dieuHuong) {
      toast("Đã đánh dấu đã đọc", {
        duration: UNDO_MS,
        action: {
          label: "Hoàn tác",
          onClick: () => {
            void fetch("/api/notifications", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "unread", id: item.id }),
            }).then(() => {
              setItems((cur) =>
                cur.map((i) => (i.id === item.id ? { ...i, readAt: null } : i)),
              );
              refresh();
            });
          },
        },
      });
      return;
    }

    const dich = resolveHref ? resolveHref(item.href) : item.href;
    if (dich) {
      dong();
      router.push(dich);
    }
  }

  async function danhDauTatCa() {
    const nhanNhom = nhom === "all" ? "" : ` (${chips.find((c) => c.key === nhom)?.label})`;
    const res = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read-all", ...(nhom === "all" ? {} : { group: nhom }) }),
    }).catch(() => null);

    if (!res?.ok) {
      toast.error("Không đánh dấu được. Thử lại.");
      return;
    }
    toast.success(`Đã đánh dấu đã đọc${nhanNhom}`);
    void tai(nhom);
    refresh();
  }

  // Bàn phím trong panel: ↑↓ di chuyển, Enter mở, R đánh dấu đã đọc, Esc đóng.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      dong();
      return;
    }
    if (items.length === 0) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const buoc = e.key === "ArrowDown" ? 1 : -1;
      const tiep = Math.min(items.length - 1, Math.max(0, conTro + buoc));
      setConTro(tiep);
      dsRef.current?.querySelectorAll<HTMLElement>("[data-noti-item]")[tiep]?.focus();
      return;
    }
    const item = items[conTro];
    if (!item) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void danhDauDoc(item, true);
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      if (!item.readAt) void danhDauDoc(item, false);
    }
  }

  const [loiNhacDoc, setLoiNhacDoc] = useState("");
  const soCu = useRef<number | null>(null);
  const dangCho = useRef(false);
  useEffect(() => {
    const moi = summary.totalUnread;
    const cu = soCu.current;
    soCu.current = moi;
    // Lần đầu (cu === null) không phát: người dùng vừa mở trang, chưa có gì "mới".
    if (cu === null || moi <= cu || dangCho.current) return;
    setLoiNhacDoc(`Bạn có ${moi} thông báo chưa đọc`);
    dangCho.current = true;
    const t = setTimeout(() => {
      dangCho.current = false;
      setLoiNhacDoc("");
    }, 10_000);
    return () => clearTimeout(t);
  }, [summary.totalUnread]);

  const now = Date.now();

  return (
    <div
      className="relative"
      ref={boc}
      onKeyDown={(e) => {
        // Lưới thứ hai cho Esc: kể cả khi tiêu điểm còn nằm ở nút chuông (hoặc vừa rời khỏi panel),
        // Esc vẫn phải đóng và trả tiêu điểm về chuông — PRD §7.15.
        if (e.key === "Escape" && open) {
          e.preventDefault();
          dong();
        }
      }}
    >
      {/* Vùng đọc cho trình đọc màn hình. CHỈ phát khi số TĂNG và tối đa 1 lần/10 giây (PRD §7.15):
          phát cả khi giảm thì người dùng bấm dọn 5 mục là bị cắt ngang câu đang đọc 5 lần. */}
      <span aria-live="polite" className="sr-only">
        {loiNhacDoc}
      </span>

      <button
        ref={nutChuong}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={badge.ariaLabel}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {badge.showDot && (
          <span
            aria-hidden
            className={
              badge.label
                ? `absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${
                    badge.hasPriority1
                      ? "bg-[#B3261E] ring-2 ring-[#B3261E]/30"
                      : // Chip CÓ SỐ phải đạt tương phản 4,5:1 với chữ trắng 10px (PRD §7.15).
                        // `bg-state-danger` (#ef4444) chỉ ~3,8:1 — đủ cho chấm trơn, không đủ cho chữ.
                        "bg-[#B91C1C]"
                  }`
                : `absolute right-1 top-1 h-2 w-2 rounded-full ${
                    badge.hasPriority1 ? "bg-[#B3261E] ring-2 ring-[#B3261E]/30" : "bg-state-danger"
                  }`
            }
          >
            {badge.label}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Thông báo"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] rounded-t-2xl border border-border bg-card shadow-lg lg:absolute lg:inset-auto lg:right-0 lg:top-full lg:mt-2 lg:max-h-[560px] lg:w-[420px] lg:rounded-xl"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <h2 className="text-sm font-bold text-foreground">Thông báo</h2>
            <div className="flex-1" />
            {summary.totalUnread > 0 && (
              <button
                type="button"
                onClick={danhDauTatCa}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                {/* Ghi rõ tên nhóm: nút này TÔN TRỌNG chip đang lọc, người dùng phải biết
                    mình vừa đọc hết cái gì. */}
                Đánh dấu đã đọc
                {nhom !== "all" && ` (${chips.find((c) => c.key === nhom)?.label})`}
              </button>
            )}
          </div>

          <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setNhom(c.key)}
                aria-pressed={nhom === c.key}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${
                  nhom === c.key
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.label}
                {c.unread > 0 && ` ${c.unread}`}
              </button>
            ))}
          </div>

          <div ref={dsRef} className="max-h-[60vh] overflow-y-auto lg:max-h-[380px]">
            {dangTai && items.length === 0 ? (
              // Skeleton chứ không phải spinner giữa panel: spinner làm panel "nhảy" khi
              // danh sách hiện ra, skeleton giữ nguyên chiều cao.
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : loi ? (
              <div className="px-4 py-8 text-center">
                <AlertTriangle className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
                {/* Lỗi không xin lỗi — nói chuyện gì xảy ra và làm gì tiếp. */}
                <p className="mt-2 text-sm text-foreground">Không tải được thông báo.</p>
                <button
                  type="button"
                  onClick={() => void tai(nhom)}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Thử lại
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Inbox className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
                <p className="mt-2 text-sm text-foreground">
                  {nhom === "all"
                    ? "Đã xử lý hết. Không còn gì chờ bạn."
                    : `Không có thông báo nào trong nhóm ${chips.find((c) => c.key === nhom)?.label}.`}
                </p>
              </div>
            ) : (
              items.map((i, idx) => {
                const dich = resolveHref ? resolveHref(i.href) : i.href;
                return (
                  <div
                    key={i.id}
                    data-noti-item
                    tabIndex={0}
                    onFocus={() => setConTro(idx)}
                    onClick={() => void danhDauDoc(i, true)}
                    onKeyDown={(e) => {
                      if (e.key === " ") {
                        e.preventDefault();
                        void danhDauDoc(i, true);
                      }
                    }}
                    role="button"
                    className={`group flex w-full cursor-pointer gap-2 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-muted focus:bg-muted focus:outline-none ${
                      i.readAt ? "opacity-60" : ""
                    }`}
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: MAU_NHOM[i.groupKey] ?? "#5B6472" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {i.priority === 1 && "KHẨN · "}
                          {i.groupLabel}
                        </span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                          {thoiGianTuongDoi(i.createdAt, now)}
                        </span>
                      </div>
                      <p className="truncate text-sm font-semibold text-foreground">{i.title}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{i.body}</p>
                      {!dich && i.href && (
                        // Thà nói thẳng còn hơn để người dùng bấm vào một chỗ không phản ứng.
                        <p className="mt-0.5 text-[11px] italic text-muted-foreground">
                          Xem chi tiết trên trang quản trị
                        </p>
                      )}
                    </div>
                    {!i.readAt && (
                      <button
                        type="button"
                        title="Đánh dấu đã đọc"
                        aria-label={`Đánh dấu đã đọc: ${i.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void danhDauDoc(i, false);
                        }}
                        className="mt-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground group-hover:flex group-focus:flex"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                    {!i.readAt && (
                      <span
                        aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary group-hover:hidden"
                      />
                    )}
                  </div>
                );
              })
            )}

            {conLai > 0 && (
              <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                … {conLai} mục nữa
              </p>
            )}
          </div>

          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={() => {
                dong();
                router.push(viewAllHref);
              }}
              className="w-full rounded-lg py-2 text-center text-sm font-medium text-primary hover:bg-muted"
            >
              Xem tất cả thông báo →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
