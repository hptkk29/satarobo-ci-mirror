"use client";

// R7-07 (PR2) — nút "Hoàn tất buổi" + form dữ liệu thực tế (GV/phòng/giờ thực dạy)
// + nhận xét lớp (classComment — mọi PH lớp thấy). Thiếu điểm danh → action trả
// needsConfirm → hỏi lại rồi gọi với confirmNoAttendance.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { completeSessionAction } from "../_actions";

type Option = { id: string; label: string };

export function CompleteSession({
  sessionId,
  teachers,
  rooms,
}: {
  sessionId: string;
  teachers: Option[];
  rooms: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [actualTeacherId, setActualTeacherId] = useState("");
  const [actualRoomId, setActualRoomId] = useState("");
  const [actualStartAt, setActualStartAt] = useState("");
  const [actualEndAt, setActualEndAt] = useState("");
  const [classComment, setClassComment] = useState("");
  // R7-14 — cách giao bài kèm: NOW (hạn mặc định) / CUSTOM_DUE (hạn chọn) / DEFER (giao sau).
  const [assignMode, setAssignMode] = useState<"NOW" | "DEFER" | "CUSTOM_DUE">("NOW");
  const [assignDueAt, setAssignDueAt] = useState("");

  function submit(confirmNoAttendance = false) {
    startTransition(async () => {
      const res = await completeSessionAction(sessionId, {
        actualTeacherId: actualTeacherId || null,
        actualRoomId: actualRoomId || null,
        actualStartAt: actualStartAt || null,
        actualEndAt: actualEndAt || null,
        classComment: classComment || null,
        confirmNoAttendance,
        assignMode,
        assignDueAt: assignMode === "CUSTOM_DUE" ? assignDueAt || null : null,
      });
      if (res.ok) {
        toast.success(
          res.alreadyCompleted
            ? "Buổi đã hoàn tất từ trước"
            : "Đã hoàn tất buổi" + (res.warning ? ` — ${res.warning}` : ""),
        );
        setOpen(false);
        router.refresh();
        return;
      }
      if (res.needsConfirm) {
        const ok = window.confirm(res.warning ?? "Chưa điểm danh. Vẫn hoàn tất?");
        if (ok) submit(true);
        return;
      }
      toast.error(res.error ?? "Không hoàn tất được buổi");
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-state-success px-2 py-1 text-xs font-semibold text-state-success-ink hover:bg-state-success-soft"
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> Hoàn tất buổi
      </button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-lg bg-state-success-soft p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">
            GV thực dạy
          </span>
          <select
            value={actualTeacherId}
            onChange={(e) => setActualTeacherId(e.target.value)}
            className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-state-success focus:outline-none"
          >
            <option value="">— Theo GV lớp —</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">
            Phòng thực tế
          </span>
          <select
            value={actualRoomId}
            onChange={(e) => setActualRoomId(e.target.value)}
            className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-state-success focus:outline-none"
          >
            <option value="">— Theo phòng lớp —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">
            Bắt đầu thực tế
          </span>
          <input
            type="datetime-local"
            value={actualStartAt}
            onChange={(e) => setActualStartAt(e.target.value)}
            className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-state-success focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">
            Kết thúc thực tế
          </span>
          <input
            type="datetime-local"
            value={actualEndAt}
            onChange={(e) => setActualEndAt(e.target.value)}
            className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-state-success focus:outline-none"
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">
          Nhận xét lớp (mọi phụ huynh trong lớp đều thấy)
        </span>
        <textarea
          value={classComment}
          onChange={(e) => setClassComment(e.target.value)}
          rows={2}
          placeholder="Nhận xét chung cho cả lớp buổi này…"
          className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-state-success focus:outline-none"
        />
      </label>

      {/* R7-14 — giao bài tự động (exam gắn lesson của buổi) cho HV đang học. */}
      <div className="rounded-lg border border-state-success-soft bg-card p-2">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">
          Giao bài kiểm tra/bài tập của buổi
        </span>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground">
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              name={`assignMode-${sessionId}`}
              checked={assignMode === "NOW"}
              onChange={() => setAssignMode("NOW")}
            />
            Giao ngay (hạn mặc định)
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              name={`assignMode-${sessionId}`}
              checked={assignMode === "CUSTOM_DUE"}
              onChange={() => setAssignMode("CUSTOM_DUE")}
            />
            Giao ngay, hạn khác
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              name={`assignMode-${sessionId}`}
              checked={assignMode === "DEFER"}
              onChange={() => setAssignMode("DEFER")}
            />
            Giao sau
          </label>
        </div>
        {assignMode === "CUSTOM_DUE" && (
          <input
            type="datetime-local"
            value={assignDueAt}
            onChange={(e) => setAssignDueAt(e.target.value)}
            className="mt-2 w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-state-success focus:outline-none"
          />
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={pending}
          className="rounded-lg bg-state-success-ink px-4 py-2 text-sm font-semibold text-white hover:bg-state-success-ink-hover disabled:opacity-50"
        >
          {pending ? "Đang lưu…" : "Xác nhận hoàn tất"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </div>
  );
}
