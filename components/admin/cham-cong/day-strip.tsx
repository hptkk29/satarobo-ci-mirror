// components/admin/cham-cong/day-strip.tsx — dải ngày của tháng, mang theo SỐ CỜ từng ngày.
//
// Vì sao file này tồn tại: việc thật của quản lý cơ sở là "tháng này ngày nào có chuyện" chứ không
// phải "hôm nay có chuyện gì". Ô lịch cũ chỉ là con số nên phải mở từng ngày mới biết; ở đây số
// người có cờ nằm ngay trên ô, bấm là khoan thẳng vào ngày đó mà vẫn giữ khối đang xem.
//
// KHÔNG dùng lưới 31 cột cứng: ở 375px mỗi ô còn ~10px. Mobile là 7 cột (đúng hình tuần), từ `sm`
// mới rải thành hàng cuộn.
import Link from "next/link";
import { cn } from "@/lib/utils";

/** 0 = Chủ nhật, khớp `Date#getUTCDay()` mà cả module đang dùng. */
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export type DayStripDay = {
  ymd: string;
  day: number;
  wd: number;
  flagCount: number;
  type: "WORK" | "WEEKLY_OFF" | "HOLIDAY";
  href: string;
};

export function DayStrip({
  days,
  selected,
  today,
}: {
  days: DayStripDay[];
  /** `ymd` đang xem. */
  selected: string;
  /** `ymd` hôm nay theo giờ VN — tính ở server, đừng gọi `new Date()` trong component. */
  today: string;
}) {
  return (
    <nav aria-label="Ngày trong tháng" className="mb-4 grid grid-cols-7 gap-1 sm:flex sm:flex-wrap">
      {days.map((d) => {
        const isSelected = d.ymd === selected;
        const isToday = d.ymd === today;
        const rest = d.type === "WORK" ? "border-border bg-card hover:bg-muted" : "border-border bg-muted text-muted-foreground";
        const label =
          `${WD[d.wd] ?? ""} ${d.ymd.slice(8, 10)}/${d.ymd.slice(5, 7)}`.trim() +
          (d.flagCount > 0 ? `, ${d.flagCount} người có cờ` : "");
        return (
          <Link
            key={d.ymd}
            href={d.href}
            aria-label={label}
            aria-current={isSelected ? "date" : undefined}
            className={cn(
              "flex h-11 w-11 flex-col items-center justify-center rounded-lg border text-xs tabular-nums transition-colors",
              rest,
              // Hôm nay chỉ đổi VIỀN — nó là mốc thời gian, không phải lựa chọn đang xem.
              isToday && "border-primary",
              isSelected && "border-primary bg-primary-soft font-semibold text-primary-ink",
            )}
          >
            <span>{d.day}</span>
            {d.flagCount > 0 && (
              <span className="rounded-full bg-state-danger-soft px-1 text-[11px] font-semibold text-state-danger-ink">
                {d.flagCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
