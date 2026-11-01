// components/cham-cong/ui/day-type-pill.tsx — vì sao một ngày KHÔNG có công.
//
// Vì sao file này tồn tại: ô công trống đọc giống nhau ở 3 nguyên nhân rất khác (nghỉ tuần, nghỉ
// phép, ngày lễ) và ở ca "ngoài lịch" — người rà phải mở từng dòng mới biết có phải việc cần xử lý
// không. Pill này nói thẳng loại ngày ngay trên bảng; ngày làm bình thường thì KHÔNG in gì để
// không đẻ nhiễu trên mọi dòng.
import { cn } from "@/lib/utils";
import { PILL } from "./flag-chip";

export type DayType = "WORK" | "WEEKLY_OFF" | "LEAVE" | "HOLIDAY" | "UNSCHEDULED";

const DAY_TYPE: Record<Exclude<DayType, "WORK">, { text: string; cls: string }> = {
  WEEKLY_OFF: { text: "Nghỉ tuần", cls: "bg-muted text-muted-foreground" },
  LEAVE: { text: "Phép", cls: "bg-state-success-soft text-state-success-ink" },
  HOLIDAY: { text: "Lễ", cls: "bg-state-danger-soft text-state-danger-ink" },
  UNSCHEDULED: { text: "Ngoài lịch", cls: "bg-state-warning-soft text-state-warning-ink" },
};

export function DayTypePill({
  type,
  className,
}: {
  type: DayType | null | undefined;
  className?: string;
}) {
  if (!type || type === "WORK") return null;
  const d = DAY_TYPE[type];
  if (!d) return null; // giá trị lạ từ DB: im lặng bỏ qua, không vẽ pill rỗng
  return <span className={cn(PILL, d.cls, className)}>{d.text}</span>;
}
