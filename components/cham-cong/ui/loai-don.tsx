"use client";

// components/cham-cong/ui/loai-don.tsx — biểu tượng + nhãn + chữ "i" của MỘT loại đơn.
//
// Dùng chung ba nơi: thẻ chọn loại ở form nộp (`request-form.tsx`, admin + site GV), nhãn loại ở
// màn duyệt của QLCS (`/don-tu`) và danh sách đơn của tôi. Chữ giải thích đọc từ MỘT bảng
// (`WR_KIND_GIAI_THICH`, `lib/work-request.ts`) — đừng viết lời giải thích tại chỗ.
//
// DỄ VỠ: thư mục dùng chung với site GV ⇒ KHÔNG import `components/admin/**`, CHỈ token `:root`
// (cấm `primary-soft`/`primary-ink`/`primary-dark`).
import {
  ArrowLeftRight,
  Briefcase,
  TimerReset,
  CalendarClock,
  CalendarOff,
  CalendarX2,
  Clock,
  FilePen,
  Home,
  MapPin,
  Repeat,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WR_KIND_GIAI_THICH,
  WR_KIND_LABEL,
  WR_LUU_Y_CHUNG,
  wrCategoryOf,
  type WorkRequestKindV,
} from "@/lib/work-request";
import { ChuI } from "./chu-i";

export const ICON_LOAI_DON: Record<WorkRequestKindV, LucideIcon> = {
  CLASS_CHANGE: ArrowLeftRight,
  SUB_TEACH: Users,
  CLASS_OFF: CalendarX2,
  SHIFT_SWAP: Repeat,
  OT: Timer,
  LATE_EARLY: Clock,
  TIMESHEET_FIX: FilePen,
  LEAVE: CalendarOff,
  REMOTE: Home,
  BUSINESS_TRIP: Briefcase,
  COMP_LEAVE: TimerReset,
  HOLIDAY_WORK: CalendarClock,
  OUTSIDE_ATTENDANCE: MapPin,
};

/** Nền biểu tượng theo NHÓM — chỉ token `:root` (state-* có ở cả admin lẫn site GV). */
const NEN_NHOM = {
  class: "bg-state-info-soft text-state-info-ink",
  shift: "bg-state-warning-soft text-state-warning-ink",
  leave: "bg-state-success-soft text-state-success-ink",
} as const;

export function IconLoaiDon({ kind, size = "md" }: { kind: WorkRequestKindV; size?: "sm" | "md" }) {
  const Icon = ICON_LOAI_DON[kind];
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        size === "sm" ? "size-7" : "size-9",
        NEN_NHOM[wrCategoryOf(kind).key],
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} />
    </span>
  );
}

/** Nội dung bên trong chữ "i" — bốn mục, cùng thứ tự ở mọi nơi. */
export function GiaiThichLoaiDon({ kind }: { kind: WorkRequestKindV }) {
  const g = WR_KIND_GIAI_THICH[kind];
  return (
    <>
      <span className="block text-sm font-bold">{WR_KIND_LABEL[kind]}</span>
      <span className="block">
        <b>Dùng khi:</b> {g.dungKhi}
      </span>
      <span className="block">
        <b>Cần điền:</b> {g.canDien}
      </span>
      <span className="block">
        <b>Khi quản lý duyệt:</b> {g.khiDuyet}
      </span>
      <span className="block">
        <b>Lưu ý:</b> {[...g.luuY, WR_LUU_Y_CHUNG].join(" ")}
      </span>
    </>
  );
}

/** Chữ "i" của một loại đơn. */
export function ChuILoaiDon({
  kind,
  side,
  className,
}: {
  kind: WorkRequestKindV;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <ChuI label={`Giải thích loại đơn: ${WR_KIND_LABEL[kind]}`} side={side} className={className}>
      <GiaiThichLoaiDon kind={kind} />
    </ChuI>
  );
}

/** Biểu tượng + nhãn + "i" — nhãn loại đơn ở bảng và panel. */
export function NhanLoaiDon({
  kind,
  size = "sm",
  className,
}: {
  kind: WorkRequestKindV;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <IconLoaiDon kind={kind} size={size} />
      <span className="whitespace-nowrap">{WR_KIND_LABEL[kind]}</span>
      <ChuILoaiDon kind={kind} />
    </span>
  );
}
