// components/chat/staff/chat-ui.tsx — mảnh giao diện dùng chung của màn chat nhân viên.
//
// ⚠️ Màn chat được DÙNG CHUNG với site giáo viên (`/teacher/tin-nhan`) — nơi KHÔNG có khung
// `.admin-scope`. Vì vậy chỉ dùng token có sẵn ở `:root`: `primary`, `muted`, `border`, `card`
// và thang `state-*` (DESIGN.md §1, §6 "components/cham-cong/ui/** … cấm primary-soft/primary-ink").
// Cấm hex rời và cấm lớp màu Tailwind thô (`orange-*`, `amber-*`) — chính chúng là lý do cùng một
// màn từng ra bốn tông cam khác nhau.
import { MessageSquare, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bốn tông cho avatar người — chọn theo hash của id để một người luôn ra MỘT màu ở mọi nơi. */
const AVATAR_TONES = [
  "bg-state-info-soft text-state-info-ink",
  "bg-state-success-soft text-state-success-ink",
  "bg-state-warning-soft text-state-warning-ink",
  "bg-muted text-foreground",
] as const;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** "Tô Thị Thuý Vân" → "TV": chữ đầu của họ + chữ đầu của tên (tên người Việt đứng cuối). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const pick = (w: string) => Array.from(w)[0]?.toLocaleUpperCase("vi-VN") ?? "";
  return parts.length === 1 ? pick(first) : pick(first) + pick(last);
}

const SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const;

/** Avatar chữ cái đầu của một người. Không dùng ảnh: màn chat không tải ảnh người dùng. */
export function PersonAvatar({
  name,
  id,
  size = "md",
  className,
}: {
  name: string;
  id: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        SIZES[size],
        AVATAR_TONES[hash(id) % AVATAR_TONES.length],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Ô biểu tượng của một hội thoại: nhóm lớp (nhiều người) hay nhắn riêng. */
export function ConversationTile({
  type,
  archived = false,
  size = "md",
  className,
}: {
  type: string;
  archived?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const Icon = type === "CLASS_GROUP" ? Users : MessageSquare;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl",
        size === "lg" ? "size-11" : size === "md" ? "size-10" : "size-8",
        archived ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-4" : "size-5"} />
    </span>
  );
}

/** Nhãn nhỏ (vai, "Thêm tay", "Đã lưu trữ"…). Nhãn LUÔN có chữ — không mã hoá chỉ bằng màu. */
export function Chip({
  tone = "muted",
  className,
  children,
}: {
  tone?: "muted" | "info" | "success" | "warning" | "danger";
  className?: string;
  children: React.ReactNode;
}) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    info: "bg-state-info-soft text-state-info-ink",
    success: "bg-state-success-soft text-state-success-ink",
    warning: "bg-state-warning-soft text-state-warning-ink",
    danger: "bg-state-danger-soft text-state-danger-ink",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const vnDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const vnDayLabel = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const vnTime = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
});

/** Khoá ngày theo GIỜ VIỆT NAM (yyyy-mm-dd) — gom tin theo ngày không lệch múi giờ máy khách. */
export function vnDayKey(d: Date): string {
  return vnDay.format(d);
}

/** "Hôm nay" / "Hôm qua" / dd/mm/yyyy. `now = 0` (chưa hydrate) ⇒ luôn dạng ngày đầy đủ. */
export function dayLabel(d: Date, now: number): string {
  if (now > 0) {
    const today = vnDayKey(new Date(now));
    if (vnDayKey(d) === today) return "Hôm nay";
    if (vnDayKey(d) === vnDayKey(new Date(now - 86_400_000))) return "Hôm qua";
  }
  return vnDayLabel.format(d);
}

export function clockLabel(d: Date): string {
  return vnTime.format(d);
}

/** Giờ ở danh sách hội thoại: hôm nay → HH:mm, còn lại → dd/mm. */
export function listTimeLabel(d: Date, now: number): string {
  if (now > 0 && vnDayKey(d) === vnDayKey(new Date(now))) return vnTime.format(d);
  return vnDayLabel.format(d).slice(0, 5);
}
