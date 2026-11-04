"use client";

// "Kế hoạch lịch học" của lớp ĐÃ TỒN TẠI — planner (`SchedulePhasesEditor`) + hai việc chỉ
// làm được khi đã có `classId`: LƯU kế hoạch, và DỘI lịch mới xuống các buổi ĐÃ SINH.
//
// 08/08 — khối này chuyển vào tab "Thông tin" (chỗ cũ của "Lịch học trong tuần"); phần gõ
// tay đã tách sang `_components/schedule-phases-editor.tsx` để form TẠO LỚP dùng lại.
//
// ⚠️ "Áp dụng" gửi CHÍNH kế hoạch đang gõ (không phải bản đã lưu): admin duyệt bảng nào thì
// hệ thống ghi bảng đó. Đừng tách planner khỏi nút áp dụng.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Save } from "lucide-react";
import {
  toPhaseInputs,
  type PhaseFormValue,
  type SchedulePhaseInput,
} from "@/lib/classes/phase-form";
import { SchedulePhasesEditor } from "../../_components/schedule-phases-editor";
import {
  applyScheduleAction,
  previewApplyScheduleAction,
  saveSchedulePhasesAction,
} from "../_schedule-actions";

export type { PhaseFormValue };

type PreviewRow = {
  id: string;
  topic: string | null;
  oldDate: string;
  newDate: string | null;
  keepReason: string | null;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export function ClassSchedulePhases({
  classId,
  canEdit,
  initialPhases,
  isDerived,
  defaultApplyFrom,
}: {
  classId: string;
  canEdit: boolean;
  initialPhases: PhaseFormValue[];
  /** true = chưa lưu kế hoạch, đây là giai đoạn suy từ lịch hiện tại của lớp. */
  isDerived: boolean;
  /** "YYYY-MM-DD" — mặc định ngày mai. */
  defaultApplyFrom: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phases, setPhases] = useState<PhaseFormValue[]>(
    initialPhases.length > 0 ? initialPhases : [{ from: "", to: "", note: "", days: {} }],
  );
  const [reason, setReason] = useState("");
  const [applyFrom, setApplyFrom] = useState(defaultApplyFrom);
  const [preview, setPreview] = useState<{
    rows: PreviewRow[];
    changedCount: number;
    keptCount: number;
    conflicts: { date: string; messages: string[] }[];
    newEndDate: string | null;
  } | null>(null);

  const payload: SchedulePhaseInput[] = useMemo(() => toPhaseInputs(phases), [phases]);

  /** Mọi sửa đổi kế hoạch làm bản xem trước cũ hết giá trị — bỏ ngay, đừng để lệch. */
  function updatePhases(next: PhaseFormValue[]) {
    setPhases(next);
    setPreview(null);
  }

  function save() {
    startTransition(async () => {
      const res = await saveSchedulePhasesAction(classId, payload, reason);
      if (res.ok) {
        toast.success("Đã lưu kế hoạch lịch học");
        if (res.warning) toast.warning(res.warning);
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi lưu kế hoạch");
      }
    });
  }

  function doPreview() {
    startTransition(async () => {
      // Gửi kèm kế hoạch đang gõ trên form → xem trước được TRƯỚC khi lưu.
      const res = await previewApplyScheduleAction(classId, applyFrom, payload);
      if (res.ok) {
        setPreview({
          rows: res.rows,
          changedCount: res.changedCount,
          keptCount: res.keptCount,
          conflicts: res.conflicts,
          newEndDate: res.newEndDate,
        });
        if (res.changedCount === 0) toast.info("Không có buổi nào phải đổi ngày");
        else if (res.conflicts.length > 0) {
          toast.warning(`${res.conflicts.length} buổi ở lịch mới bị trùng phòng/GV`);
        }
      } else {
        setPreview(null);
        toast.error(res.error);
      }
    });
  }

  function apply() {
    startTransition(async () => {
      // Gửi CHÍNH kế hoạch vừa xem trước: action lưu kế hoạch + dời buổi trong 1 giao
      // dịch. Trước đây áp dụng chạy trên bản ĐÃ LƯU nên admin duyệt một bảng, hệ thống
      // ghi một bảng khác.
      const res = await applyScheduleAction(classId, applyFrom, payload, reason);
      if (res.ok) {
        toast.success(
          `Đã lưu kế hoạch và áp lịch: dời ${res.moved ?? 0} buổi, giữ nguyên ${res.kept ?? 0} buổi đã có dữ liệu`,
        );
        setPreview(null);
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi áp lịch");
      }
    });
  }

  if (!canEdit) {
    return (
      <section className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Bạn không có quyền sửa lịch lớp.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-5">
        <SchedulePhasesEditor
          phases={phases}
          onChange={updatePhases}
          disabled={pending}
          isDerived={isDerived}
        />

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <label className="min-w-[16rem] flex-1">
            <span className="mb-1 block text-xs font-semibold text-foreground">Lý do thay đổi</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={pending}
              placeholder="Ghi vào nhật ký thay đổi của lớp"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {pending ? "Đang lưu…" : "Lưu kế hoạch"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Áp lịch mới cho các buổi đã sinh
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Buổi TRƯỚC ngày áp dụng giữ nguyên. Buổi từ ngày áp dụng trở đi mà{" "}
          <b>đã có dữ liệu</b> (đã điểm danh, đã nhận xét, đã giao bài tập, đã có ảnh, đã hoàn
          tất hoặc đã huỷ) cũng <b>giữ nguyên ngày</b> — chỉ buổi còn trống mới được dời. Tổng
          số buổi của khoá không đổi; ngày bế giảng tự dịch theo.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-foreground">Áp dụng từ ngày</span>
            <input
              type="date"
              value={applyFrom}
              onChange={(e) => {
                setApplyFrom(e.target.value);
                setPreview(null);
              }}
              disabled={pending}
              className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            onClick={doPreview}
            disabled={pending || !applyFrom}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Xem trước
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={pending || !preview || preview.conflicts.length > 0 || preview.changedCount === 0}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
            title={!preview ? "Bấm Xem trước đã" : undefined}
          >
            {pending ? "Đang áp dụng…" : "Áp dụng"}
          </button>
        </div>

        {preview && (
          <div className="mt-3">
            <p className="mb-2 text-sm text-muted-foreground">
              <b className="text-foreground">{preview.changedCount}</b> buổi đổi ngày ·{" "}
              <b className="text-foreground">{preview.keptCount}</b> buổi giữ nguyên vì đã có dữ liệu
              {preview.newEndDate && (
                <> · ngày bế giảng mới: <b className="text-foreground">{fmt(preview.newEndDate)}</b></>
              )}
            </p>

            {preview.conflicts.length > 0 && (
              <div className="mb-2 rounded-lg border border-state-danger-soft bg-state-danger-soft p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-state-danger-ink">
                  <AlertTriangle className="h-4 w-4" /> Lịch mới trùng phòng/giáo viên — không áp
                  dụng được
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-state-danger-ink">
                  {preview.conflicts.map((c) => (
                    <li key={c.date}>
                      {fmt(c.date)} — {c.messages.join("; ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border p-2 text-sm">
              {preview.rows.map((r) => {
                const moved = r.newDate !== null && fmt(r.oldDate) + fmtTime(r.oldDate) !== fmt(r.newDate) + fmtTime(r.newDate);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-muted-foreground">{r.topic ?? "Buổi học"}</span>
                    {r.keepReason ? (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {fmt(r.oldDate)} · giữ nguyên ({r.keepReason})
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 tabular-nums ${moved ? "font-semibold text-state-warning-ink" : "text-muted-foreground"}`}
                      >
                        {fmt(r.oldDate)} {fmtTime(r.oldDate)}
                        {moved && r.newDate ? ` → ${fmt(r.newDate)} ${fmtTime(r.newDate)}` : ""}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
