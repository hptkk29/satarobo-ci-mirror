"use client";

// week-calendar.tsx — lịch tuần của một kỳ đối soát: mỗi ô là MỘT NGÀY, số trong ô là số ô lệch.
//
// Vì sao có: dải 31 ô phẳng của bản cũ không cho biết ngày nào là thứ mấy, mà lệch của module này
// gần như luôn bám thứ (T7/CN, ngày đổi ca). Xếp theo cột thứ là nhìn ra ngay "cứ thứ Bảy là lệch".
//
// Ô là `<button aria-pressed>` chứ không phải div: bấm để LỌC bảng lệch bên dưới xuống đúng ngày
// đó, và bàn phím phải đi tới được. Bấm lại ô đang chọn = bỏ lọc.
import { cn } from "@/lib/utils";

const WD = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** Cột của một ngày (0 = T2 … 6 = CN). Tính bằng UTC nên không lệch theo múi giờ máy chạy. */
function colOf(periodKey: string, day: number): number {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) return 0;
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, day)).getUTCDay(); // 0 = CN
  return (dow + 6) % 7;
}

export function WeekCalendar({
  periodKey,
  perDay,
  selected,
  onSelect,
}: {
  periodKey: string;
  perDay: { day: number; diffs: number }[];
  selected: number | null;
  onSelect: (day: number | null) => void;
}) {
  if (perDay.length === 0) return null;
  const lead = colOf(periodKey, perDay[0].day);

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {WD.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden />
        ))}
        {perDay.map((d) => {
          const active = selected === d.day;
          const bad = d.diffs > 0;
          return (
            <button
              key={d.day}
              type="button"
              aria-pressed={active}
              aria-label={`Ngày ${d.day}: ${bad ? `${d.diffs} ô lệch` : "không lệch"}`}
              onClick={() => onSelect(active ? null : d.day)}
              className={cn(
                "flex h-12 flex-col items-center justify-center rounded-lg border text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                bad
                  ? "border-state-danger-soft bg-state-danger-soft text-state-danger-ink"
                  : "border-state-success-soft bg-state-success-soft text-state-success-ink",
                active && "border-primary ring-2 ring-primary",
              )}
            >
              <span className="font-semibold">{d.day}</span>
              {/* Số ô lệch là NỘI DUNG chính của lịch, không phải chú thích: giữ `text-xs`
                  (ô đã cao 48px nên vẫn dư chỗ), đừng hạ xuống dưới 12px. */}
              <span className="text-xs">{bad ? d.diffs : "—"}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {selected
          ? `Đang lọc bảng theo ngày ${selected}. `
          : "Bấm một ngày để lọc bảng lệch bên dưới. "}
        Số trong ô là số ô lệch của ngày đó.
        {selected && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="ml-1 font-semibold text-primary-ink underline underline-offset-2"
          >
            Bỏ lọc
          </button>
        )}
      </p>
    </div>
  );
}
