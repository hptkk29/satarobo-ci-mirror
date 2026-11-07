"use client";

// PLANNER "Kế hoạch lịch học" — phần GÕ TAY thuần, không biết gì về server.
//
// Tách ra khỏi `class-schedule-phases.tsx` (08/08) vì nay có HAI người dùng:
//   • lớp ĐÃ TỒN TẠI — bọc trong `<ClassSchedulePhases>` (tự lưu + áp lịch cho buổi đã sinh);
//   • lớp ĐANG TẠO — nhúng thẳng vào `<ClassForm>`, gửi kèm form (chưa có classId để gọi action).
//
// Chọn ngày/giờ bằng `<input type="date">` / `type="time"` native — đúng idiom admin của
// repo và trình duyệt tự mở lịch khi bấm. Không thêm thư viện UI.

import { CalendarRange, Info, Plus, Trash2 } from "lucide-react";
import {
  emptyPhase,
  nextYmd,
  WEEK_LABEL,
  WEEK_ORDER,
  type PhaseFormValue,
} from "@/lib/classes/phase-form";

export function SchedulePhasesEditor({
  phases,
  onChange,
  disabled = false,
  isDerived = false,
  /** Ẩn tiêu đề khi component cha đã có tiêu đề riêng. */
  heading = true,
}: {
  phases: PhaseFormValue[];
  onChange: (next: PhaseFormValue[]) => void;
  disabled?: boolean;
  /** true = chưa lưu kế hoạch, đây là giai đoạn suy từ lịch hiện tại của lớp. */
  isDerived?: boolean;
  heading?: boolean;
}) {
  function patch(i: number, next: Partial<PhaseFormValue>) {
    onChange(phases.map((p, idx) => (idx === i ? { ...p, ...next } : p)));
  }

  function toggleDay(i: number, w: number) {
    onChange(
      phases.map((p, idx) => {
        if (idx !== i) return p;
        const days = { ...p.days };
        if (days[w]) delete days[w];
        // Giờ mặc định lấy từ thứ đã khai trong CÙNG giai đoạn — bớt gõ lại.
        else {
          const any = WEEK_ORDER.map((x) => p.days[x]).find(Boolean);
          days[w] = { start: any?.start ?? "17:30", end: any?.end ?? "19:00" };
        }
        return { ...p, days };
      }),
    );
  }

  function setDayTime(i: number, w: number, field: "start" | "end", value: string) {
    onChange(
      phases.map((p, idx) =>
        idx === i ? { ...p, days: { ...p.days, [w]: { ...p.days[w], [field]: value } } } : p,
      ),
    );
  }

  function addPhase() {
    const last = phases[phases.length - 1];
    // Giai đoạn mới nối ngay sau giai đoạn trước; giai đoạn trước phải có ngày kết thúc.
    onChange([...phases, emptyPhase(last?.to ? nextYmd(last.to) : "")]);
  }

  function removePhase(i: number) {
    if (phases.length <= 1) return;
    onChange(phases.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      {heading && (
        <>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <CalendarRange className="h-4 w-4" /> Kế hoạch lịch học
            <span className="text-state-danger-ink">*</span>
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Một lớp có thể đổi nhịp học giữa khoá — ví dụ tháng 7 học 2 buổi/tuần, tháng 8 còn
            1 buổi/tuần. Mỗi giai đoạn khai khoảng ngày + các thứ trong tuần + giờ của từng thứ.
            Giai đoạn cuối bỏ trống ô &quot;đến ngày&quot; để kéo dài tới khi học đủ số buổi.
          </p>
        </>
      )}

      {isDerived && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-state-info-soft bg-state-info-soft p-3 text-xs text-state-info-ink">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Lớp chưa có kế hoạch. Giai đoạn dưới đây được suy từ lịch hiện tại của lớp — kiểm
            lại rồi bấm <b>Lưu kế hoạch</b> để chốt. Trước khi lưu, lớp vẫn chạy theo lịch cũ.
          </span>
        </p>
      )}

      <div className="space-y-3">
        {phases.map((p, i) => {
          const isLast = i === phases.length - 1;
          return (
            <div key={i} className="rounded-lg border border-border bg-muted/60 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-foreground">Giai đoạn {i + 1}</span>
                {phases.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePhase(i)}
                    disabled={disabled}
                    className="inline-flex items-center gap-1 rounded-md border border-state-danger-soft px-2 py-1 text-xs font-semibold text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Xoá
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-foreground">
                    Từ ngày <span className="text-state-danger-ink">*</span>
                  </span>
                  <input
                    type="date"
                    value={p.from}
                    onChange={(e) => patch(i, { from: e.target.value })}
                    disabled={disabled}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-foreground">
                    Đến ngày{" "}
                    {isLast && (
                      <span className="font-normal text-muted-foreground">(để trống = đến hết khoá)</span>
                    )}
                  </span>
                  <input
                    type="date"
                    value={p.to}
                    onChange={(e) => patch(i, { to: e.target.value })}
                    disabled={disabled}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                  />
                </label>
              </div>

              <div className="mt-3">
                <span className="mb-1.5 block text-xs font-semibold text-foreground">
                  Học thứ mấy, mấy giờ <span className="text-state-danger-ink">*</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {WEEK_ORDER.map((w) => {
                    const on = Boolean(p.days[w]);
                    return (
                      <button
                        key={w}
                        type="button"
                        onClick={() => toggleDay(i, w)}
                        disabled={disabled}
                        aria-pressed={on}
                        aria-label={`Giai đoạn ${i + 1} — học ${WEEK_LABEL[w]}`}
                        className={`rounded-md border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${ on ? "border-primary bg-primary text-white" : "border-border bg-card text-muted-foreground hover:bg-muted" }`}
                      >
                        {WEEK_LABEL[w]}
                      </button>
                    );
                  })}
                </div>

                {WEEK_ORDER.filter((w) => p.days[w]).length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {WEEK_ORDER.filter((w) => p.days[w]).map((w) => (
                      <div key={w} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-8 font-semibold text-foreground">{WEEK_LABEL[w]}</span>
                        <input
                          type="time"
                          value={p.days[w].start}
                          onChange={(e) => setDayTime(i, w, "start", e.target.value)}
                          disabled={disabled}
                          aria-label={`Giờ bắt đầu ${WEEK_LABEL[w]} — giai đoạn ${i + 1}`}
                          className="rounded-lg border border-border px-2 py-1 text-sm outline-none focus:border-primary disabled:opacity-50"
                        />
                        <span className="text-muted-foreground">→</span>
                        <input
                          type="time"
                          value={p.days[w].end}
                          onChange={(e) => setDayTime(i, w, "end", e.target.value)}
                          disabled={disabled}
                          aria-label={`Giờ kết thúc ${WEEK_LABEL[w]} — giai đoạn ${i + 1}`}
                          className="rounded-lg border border-border px-2 py-1 text-sm outline-none focus:border-primary disabled:opacity-50"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-semibold text-foreground">Ghi chú</span>
                <input
                  type="text"
                  value={p.note}
                  onChange={(e) => patch(i, { note: e.target.value })}
                  disabled={disabled}
                  placeholder="vd: nghỉ hè, chuyển sang 1 buổi/tuần"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </label>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addPhase}
        disabled={disabled}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> Thêm kế hoạch lịch
      </button>
    </div>
  );
}
