"use client";

// R7-14 — nút "Giao bài" cho buổi đã hoàn tất khi GV chọn DEFER lúc hoàn tất.
// Gọi assignSessionHomeworkAction (gác: GV phụ trách lớp / quản lý). Hạn để trống
// → dùng hạn mặc định theo Exam.defaultDueDays; nhập hạn → CUSTOM_DUE.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { assignSessionHomeworkAction } from "../_actions";

export function GiveHomework({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [dueAt, setDueAt] = useState("");

  function submit() {
    startTransition(async () => {
      const res = await assignSessionHomeworkAction(sessionId, { dueAt: dueAt || null });
      if (res.ok) {
        if (res.error) toast.warning(res.error);
        else toast.success(`Đã giao bài cho ${res.created ?? 0} lượt học viên`);
        setOpen(false);
        router.refresh();
        return;
      }
      toast.error(res.error ?? "Không giao được bài");
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-primary px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
      >
        <ClipboardCheck className="h-3.5 w-3.5" /> Giao bài
      </button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-lg bg-primary-soft p-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">
          Hạn nộp (để trống = hạn mặc định theo cấu hình bài)
        </span>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Đang giao…" : "Xác nhận giao bài"}
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
